import express from "express";
import { spawn } from "child_process";
import type http from "node:http";
import { FEEDBACK_HTML } from "./feedback-html.js";
import type { SessionManager } from "./session-manager.js";
import type { ImageAttachment } from "./session-state-store.js";
import type { Logger } from "./logging.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UiEventClient = { res: express.Response; targetSessionId: string };

export interface FeedbackUIServerOptions {
  port: number;
  openBrowser?: boolean;
}

export interface UiStatePayload {
  activeUiSessionId: string;
  sessionId: string;
  latestFeedback: string;
  history: { role: "user"; content: string; images?: ImageAttachment[]; createdAt: string }[];
  sessions: {
    sessionId: string;
    alias: string;
    sessionUrl: string;
    createdAt: string;
    lastActivityAt: string;
    waitingForFeedback: boolean;
    waitStartedAt: string | null;
    hasQueuedFeedback: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Utilities (transport-agnostic)
// ---------------------------------------------------------------------------

export function normalizeAlias(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

export function formatFeedbackResponse(
  content: string,
  images?: ImageAttachment[],
): {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
} {
  const blocks: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[] = [];
  blocks.push({ type: "text", text: content });
  if (images && images.length > 0) {
    for (const img of images) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  return { content: blocks };
}

// ---------------------------------------------------------------------------
// FeedbackUIServer
// ---------------------------------------------------------------------------

export class FeedbackUIServer {
  private readonly sessionManager: SessionManager;
  private readonly logger: Logger;
  private port: number;
  private readonly openBrowser: boolean;
  private readonly uiEventClients = new Set<UiEventClient>();
  private httpServer: http.Server | undefined;
  readonly app: express.Express;

  constructor(
    sessionManager: SessionManager,
    logger: Logger,
    options: FeedbackUIServerOptions,
  ) {
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.port = options.port;
    this.openBrowser = options.openBrowser ?? true;
    this.app = this.createApp();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** SSE-push current state to all connected UI clients. */
  broadcastState(_triggerSessionId?: string): void {
    if (this.uiEventClients.size === 0) return;
    for (const client of this.uiEventClients) {
      const payload = JSON.stringify(this.buildStatePayload(client.targetSessionId));
      client.res.write(`event: state\ndata: ${payload}\n\n`);
    }
  }

  /** Build the JSON state payload that drives the UI. */
  buildStatePayload(targetSessionId?: string): UiStatePayload {
    const activeUiSessionId = this.sessionManager.getActiveUiSessionId();
    const normalizedSessionId =
      this.resolveTarget(targetSessionId) ?? activeUiSessionId;

    const sessions = Array.from(this.sessionManager.getAllSessions().entries()).map(
      ([sessionId, entry]) => {
        const state = this.sessionManager.getFeedbackState(sessionId);
        const alias = this.sessionManager.getSessionAlias(sessionId);
        return {
          sessionId,
          alias,
          sessionUrl: `http://localhost:${this.port}/session/${encodeURIComponent(sessionId)}`,
          createdAt: entry.createdAt,
          lastActivityAt: entry.lastActivityAt,
          waitingForFeedback: Boolean(state.pendingWaiter),
          waitStartedAt: state.pendingWaiter?.startedAt || null,
          hasQueuedFeedback: Boolean(state.queuedFeedback),
        };
      },
    );

    const state = this.sessionManager.getFeedbackState(normalizedSessionId);
    return {
      activeUiSessionId,
      sessionId: normalizedSessionId,
      latestFeedback: state?.latestFeedback || "",
      history: state?.history || [],
      sessions,
    };
  }

  /** Start listening. Returns when the server is ready. */
  start(): Promise<void> {
    const MAX_PORT_RETRIES = 10;
    const attemptListen = (port: number, attempt: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        const server = this.app.listen(port);
        server.on("listening", () => {
          this.httpServer = server;
          this.port = port;
          this.logger.log("info", "ui.started", { uiPort: port });
          resolve();
          if (this.openBrowser) {
            this.autoOpenBrowser();
          }
        });
        server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
            this.logger.log("warn", "ui.port_in_use", { port, nextPort: port + 1 });
            server.close();
            attemptListen(port + 1, attempt + 1).then(resolve, reject);
          } else {
            reject(err);
          }
        });
      });
    };
    return attemptListen(this.port, 0);
  }

  /** Gracefully shut down the HTTP server. */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** The port this server is configured on. */
  getPort(): number {
    return this.port;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolveTarget(rawSessionId?: string): string | null {
    const requestedSessionId =
      rawSessionId && rawSessionId.trim().length > 0 ? rawSessionId : undefined;
    return this.sessionManager.resolveTargetSession(requestedSessionId);
  }

  private renderHtml(viewSessionId?: string): string {
    const displaySessionId =
      viewSessionId || this.sessionManager.getActiveUiSessionId();
    const displayAlias = this.sessionManager.getSessionAlias(displaySessionId);
    const displayLabel = displayAlias
      ? `${displayAlias} (${displaySessionId})`
      : displaySessionId;
    return FEEDBACK_HTML.replace(
      "ACTIVE_SESSION_INFO",
      `Active session: ${displayLabel} | Known sessions: ${this.sessionManager.getAllSessions().size}`,
    );
  }

  private createApp(): express.Express {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json({ limit: "50mb" }));

    // HTML pages
    app.get("/", (_req, res) => {
      res.type("html").send(this.renderHtml());
    });

    app.get("/session/:sessionId", (req, res) => {
      res.type("html").send(this.renderHtml(req.params.sessionId));
    });

    // SSE event stream
    app.get("/events", (req, res) => {
      const targetSessionId =
        typeof req.query.sessionId === "string"
          ? req.query.sessionId.trim()
          : "";
      const resolvedSessionId =
        this.resolveTarget(targetSessionId) ??
        this.sessionManager.getActiveUiSessionId();

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const client: UiEventClient = {
        res,
        targetSessionId: resolvedSessionId,
      };
      this.uiEventClients.add(client);
      res.write(
        `event: state\ndata: ${JSON.stringify(this.buildStatePayload(resolvedSessionId))}\n\n`,
      );

      req.on("close", () => {
        this.uiEventClients.delete(client);
      });
    });

    // Feedback history
    app.get("/feedback/history", (req, res) => {
      const querySession =
        typeof req.query.sessionId === "string" ? req.query.sessionId : "";
      const normalizedSessionId =
        this.resolveTarget(querySession.trim()) ??
        this.sessionManager.getActiveUiSessionId();
      const state = this.sessionManager.getFeedbackState(normalizedSessionId);
      res.json({ sessionId: normalizedSessionId, history: state?.history || [] });
    });

    // Session list
    app.get("/sessions", (_req, res) => {
      const payload = this.buildStatePayload();
      res.json({
        defaultUiSessionId: payload.activeUiSessionId,
        activeUiSessionId: payload.activeUiSessionId,
        sessions: payload.sessions,
      });
    });

    // Set active session
    const setActiveHandler = async (
      req: express.Request,
      res: express.Response,
    ) => {
      const sessionId =
        typeof req.body?.sessionId === "string"
          ? req.body.sessionId.trim()
          : "";
      if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
        this.logger.log("warn", "ui.sessions.active.invalid", { sessionId });
        res.status(400).json({ error: "Unknown sessionId" });
        return;
      }

      await this.sessionManager.setActiveUiSession(sessionId);
      this.logger.log("info", "ui.sessions.active.set", { sessionId });
      const currentActiveId = this.sessionManager.getActiveUiSessionId();
      res.json({
        ok: true,
        defaultUiSessionId: currentActiveId,
        activeUiSessionId: currentActiveId,
      });
    };

    app.post("/sessions/default", setActiveHandler);
    app.post("/sessions/active", setActiveHandler);

    // Set alias
    app.post("/sessions/:sessionId/alias", async (req, res) => {
      const sessionId = req.params.sessionId;
      if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
        this.logger.log("warn", "ui.sessions.alias.invalid", { sessionId });
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const alias = normalizeAlias(req.body?.alias);
      if (alias) {
        this.sessionManager.setManualAlias(sessionId, alias);
        this.logger.log("info", "ui.sessions.alias.set", { sessionId, alias });
      } else {
        this.sessionManager.setManualAlias(sessionId, "");
        this.logger.log("info", "ui.sessions.alias.cleared", { sessionId });
      }

      res.json({
        ok: true,
        sessionId,
        alias: this.sessionManager.getSessionAlias(sessionId),
      });
    });

    // Delete session
    app.delete("/sessions/:sessionId", async (req, res) => {
      const sessionId = req.params.sessionId;
      if (!this.sessionManager.getSession(sessionId)) {
        this.logger.log("warn", "ui.sessions.delete.missing", { sessionId });
        res.status(404).json({ error: "Session not found" });
        return;
      }

      try {
        await this.sessionManager.deleteSession(sessionId, "ui_delete");
        this.logger.log("info", "ui.sessions.delete.ok", { sessionId });
        res.json({ ok: true });
      } catch (error) {
        this.logger.log("error", "ui.sessions.delete.error", {
          sessionId,
          error: String(error),
        });
        res.status(500).json({ error: String(error) });
      }
    });

    // Prune
    app.post("/sessions/prune", async (req, res) => {
      const maxAgeMs =
        typeof req.body?.maxAgeMs === "number"
          ? req.body.maxAgeMs
          : 60 * 60 * 1000;
      const forceIncludeWaiting = req.body?.forceIncludeWaiting === true;

      try {
        const result = await this.sessionManager.manualPrune(
          maxAgeMs,
          forceIncludeWaiting,
        );
        this.logger.log("info", "ui.sessions.prune.complete", {
          maxAgeMs,
          prunedCount: result.pruned.length,
          errorCount: result.errors.length,
        });
        res.json({
          ok: true,
          pruned: result.pruned,
          errors: result.errors,
        });
      } catch (error) {
        this.logger.log("error", "ui.sessions.prune.error", {
          error: String(error),
        });
        res.status(500).json({ error: String(error) });
      }
    });

    // Settings
    app.get("/settings", (_req, res) => {
      res.json({
        disconnectAfterMinutes:
          this.sessionManager.getDisconnectAfterMinutes(),
      });
    });

    app.post("/settings/disconnect-after", async (req, res) => {
      const minutes =
        typeof req.body?.minutes === "number" ? req.body.minutes : 10;
      await this.sessionManager.setDisconnectAfterMinutes(minutes);
      res.json({
        ok: true,
        disconnectAfterMinutes:
          this.sessionManager.getDisconnectAfterMinutes(),
      });
    });

    // Submit feedback
    app.post("/feedback", async (req, res) => {
      try {
        const content =
          typeof req.body === "string" ? req.body : req.body.content ?? "";
        const rawImages = Array.isArray(req.body?.images)
          ? req.body.images
          : [];
        const images: ImageAttachment[] = rawImages
          .filter(
            (img: unknown): img is Record<string, unknown> =>
              img !== null && typeof img === "object",
          )
          .filter(
            (img: Record<string, unknown>) =>
              typeof img.data === "string" && typeof img.mimeType === "string",
          )
          .map((img: Record<string, unknown>) => ({
            data: img.data as string,
            mimeType: img.mimeType as string,
          }));
        const requestedSessionId =
          typeof req.body?.sessionId === "string"
            ? req.body.sessionId.trim()
            : "";
        const normalizedSessionId = this.resolveTarget(requestedSessionId);

        if (!normalizedSessionId) {
          this.logger.log("warn", "ui.feedback.post.no_session", {
            requestedSessionId,
            availableSessions: Array.from(
              this.sessionManager.getAllSessions().keys(),
            ),
          });
          res.status(400).json({
            error: requestedSessionId
              ? `Session "${requestedSessionId}" not found`
              : "No active session to receive feedback",
          });
          return;
        }

        const hasContent = content.trim().length > 0 || images.length > 0;
        this.logger.log("info", "ui.feedback.post", {
          requestedSessionId,
          targetSessionId: normalizedSessionId,
          contentLength: content.length,
          imageCount: images.length,
        });

        if (hasContent) {
          this.sessionManager.appendHistory(
            normalizedSessionId,
            content,
            images.length > 0 ? images : undefined,
          );
          const result = await this.sessionManager.deliverFeedback(
            normalizedSessionId,
            content,
            images.length > 0 ? images : undefined,
          );
          this.logger.log("info", "ui.feedback.delivered", {
            sessionId: normalizedSessionId,
            delivered: result.delivered,
            queued: result.queued,
          });
        }

        res.json({ ok: true, sessionId: normalizedSessionId });
      } catch (err) {
        this.logger.log("error", "ui.feedback.post.error", {
          error: String(err),
        });
        res.status(500).json({ error: String(err) });
      }
    });

    return app;
  }

  private autoOpenBrowser(): void {
    setTimeout(() => {
      const url = `http://localhost:${this.port}`;
      if (process.platform === "linux") {
        const hasDisplay =
          process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
        if (!hasDisplay) {
          this.logger.log("info", "ui.browser.no_display", { url });
          return;
        }
      }

      const cmd =
        process.platform === "darwin"
          ? { bin: "open", args: [url] }
          : process.platform === "win32"
            ? { bin: "cmd", args: ["/c", "start", "", url] }
            : { bin: "xdg-open", args: [url] };

      spawn(cmd.bin, cmd.args, { stdio: "ignore" }).on("error", () => {
        this.logger.log("warn", "ui.browser.open_failed", { url });
      });
    }, 1000);
  }
}
