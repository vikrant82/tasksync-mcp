#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import express from "express";
import { FEEDBACK_HTML } from "./feedback-html.js";

const DEFAULT_TIMEOUT = 0; // 0 = block forever; >0 = return [WAITING] after N ms

const args = process.argv.slice(2);
const noUI = args.includes("--no-ui");
const mcpPort = parseInt(args.find((arg) => arg.startsWith("--port="))?.split("=")[1] || "3011", 10);
const uiPortArg = args.find((arg) => arg.startsWith("--ui-port="));
const uiPort = parseInt(uiPortArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456", 10);
const timeoutArg = args.find((arg) => arg.startsWith("--timeout="));
const parsedTimeout = timeoutArg ? parseInt(timeoutArg.split("=")[1], 10) : NaN;
const feedbackTimeout = Number.isNaN(parsedTimeout) ? DEFAULT_TIMEOUT : parsedTimeout;
const logLevel = (process.env.TASKSYNC_LOG_LEVEL || "info").toLowerCase();

const DEFAULT_FEEDBACK_SESSION = "__default__";

type FeedbackChannelState = {
  pendingWaiter: {
    waitId: string;
    startedAt: string;
    resolve: (content: string) => void;
  } | null;
  queuedFeedback: string | null;
  queuedAt: string | null;
  latestFeedback: string;
};

type StreamableSessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastActivityAt: string;
};

const feedbackStateBySession = new Map<string, FeedbackChannelState>();
const streamableSessions = new Map<string, StreamableSessionEntry>();
const manualAliasBySession = new Map<string, string>();
const inferredAliasBySession = new Map<string, string>();
const clientGenerationByAlias = new Map<string, number>();
let activeUiSessionId = DEFAULT_FEEDBACK_SESSION;

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel): boolean {
  const configured = (LOG_PRIORITY[logLevel as LogLevel] ?? LOG_PRIORITY.info);
  return LOG_PRIORITY[level] >= configured;
}

function logEvent(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  console.error(`[tasksync] ${JSON.stringify(payload)}`);
}

const AskReviewArgsSchema = z.object({
  path: z.string().optional().describe("Deprecated. Ignored in in-memory mode."),
  tail: z.number().optional().describe("Optional: last N lines of returned feedback text."),
  head: z.number().optional().describe("Optional: first N lines of returned feedback text."),
});

type ToolInput = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

function getSessionId(rawSessionId?: string): string {
  return rawSessionId && rawSessionId.trim().length > 0 ? rawSessionId : DEFAULT_FEEDBACK_SESSION;
}

function getFeedbackState(sessionId: string): FeedbackChannelState {
  const existing = feedbackStateBySession.get(sessionId);
  if (existing) return existing;

  const created: FeedbackChannelState = {
    pendingWaiter: null,
    queuedFeedback: null,
    queuedAt: null,
    latestFeedback: "",
  };
  feedbackStateBySession.set(sessionId, created);
  logEvent("debug", "feedback.state.created", { sessionId });
  return created;
}

function nextClientGeneration(alias: string): number {
  const nextGeneration = (clientGenerationByAlias.get(alias) ?? 0) + 1;
  clientGenerationByAlias.set(alias, nextGeneration);
  return nextGeneration;
}

function formatResponseWithHeadTail(content: string, head?: number, tail?: number): { content: { type: "text"; text: string }[] } {
  if (head && tail) {
    throw new Error("Cannot specify both head and tail parameters simultaneously");
  }

  const lines = content.split("\n");
  const selected = tail ? lines.slice(-tail) : head ? lines.slice(0, head) : lines;
  return { content: [{ type: "text", text: selected.join("\n") }] };
}

function normalizeAlias(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

function getSessionAlias(sessionId: string): string {
  return manualAliasBySession.get(sessionId) || inferredAliasBySession.get(sessionId) || "";
}

function inferAliasFromInitializeBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") return "";
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") return "";

  const name = normalizeAlias((clientInfo as { name?: unknown }).name);
  const version = normalizeAlias((clientInfo as { version?: unknown }).version);
  if (!name) return "";
  return version ? `${name} ${version}` : name;
}

function resolvePendingFeedback(content: string, rawSessionId?: string): boolean {
  const sessionId = getSessionId(rawSessionId);
  const state = getFeedbackState(sessionId);
  const queuedAt = new Date().toISOString();
  state.latestFeedback = content;
  logEvent("debug", "feedback.received", {
    sessionId,
    contentLength: content.length,
    hasPendingWaiter: Boolean(state.pendingWaiter),
    pendingWaitId: state.pendingWaiter?.waitId,
  });

  if (state.pendingWaiter) {
    const waiter = state.pendingWaiter;
    state.pendingWaiter = null;
    state.queuedAt = null;
    waiter.resolve(content);
    logEvent("info", "feedback.delivered.to_waiter", {
      sessionId,
      waitId: waiter.waitId,
      waitStartedAt: waiter.startedAt,
      waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
      contentLength: content.length,
    });
    return true;
  }

  state.queuedFeedback = content;
  state.queuedAt = queuedAt;
  logEvent("info", "feedback.queued", {
    sessionId,
    queuedAt,
    contentLength: content.length,
  });
  return false;
}

function clearPendingWaiter(sessionId: string, reason: string) {
  const state = feedbackStateBySession.get(sessionId);
  if (!state || !state.pendingWaiter) return;
  const waiter = state.pendingWaiter;
  state.pendingWaiter = null;
  logEvent("warn", "feedback.waiter.cleared", {
    sessionId,
    reason,
    waitId: waiter.waitId,
    waitStartedAt: waiter.startedAt,
    waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
  });
}

function registerServerHandlers(targetServer: Server) {
  targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_feedback",
          description:
            "Wait for human feedback in a session-scoped in-memory queue. " +
            "This call blocks until feedback is submitted from the TaskSync UI or timeout is reached.",
          inputSchema: zodToJsonSchema(AskReviewArgsSchema, { target: "openApi3" }) as ToolInput,
        },
      ],
    };
  });

  targetServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const { name, arguments: args } = request.params;
      const sessionId = getSessionId(extra?.sessionId);
      activeUiSessionId = sessionId;
      const feedbackState = getFeedbackState(sessionId);
      logEvent("debug", "mcp.tool.call", { tool: name, sessionId });

      switch (name) {
        case "get_feedback": {
          const parsed = AskReviewArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
          }

          if (feedbackState.queuedFeedback !== null) {
            const content = feedbackState.queuedFeedback;
            const queuedAt = feedbackState.queuedAt;
            feedbackState.queuedFeedback = null;
            feedbackState.queuedAt = null;
            logEvent("info", "feedback.return.queued", {
              sessionId,
              queuedAt,
              queuedDurationMs: queuedAt ? Date.now() - Date.parse(queuedAt) : undefined,
              contentLength: content.length,
            });
            return formatResponseWithHeadTail(content, parsed.data.head, parsed.data.tail);
          }

          const waitId = randomUUID();
          const waitStartedAt = new Date().toISOString();
          const feedbackPromise = new Promise<string>((resolve) => {
            feedbackState.pendingWaiter = {
              waitId,
              startedAt: waitStartedAt,
              resolve,
            };
          });
          logEvent("info", "feedback.waiting", {
            sessionId,
            waitId,
            waitStartedAt,
            timeoutMs: feedbackTimeout,
          });

          let result: string | null;
          if (feedbackTimeout > 0) {
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), feedbackTimeout)
            );
            result = await Promise.race([feedbackPromise, timeoutPromise]);
          } else {
            result = await feedbackPromise;
          }

          if (result === null) {
            const timedOutWaiter = feedbackState.pendingWaiter;
            if (timedOutWaiter?.waitId === waitId) {
              feedbackState.pendingWaiter = null;
            }
            logEvent("info", "feedback.wait.timeout", {
              sessionId,
              waitId,
              waitStartedAt,
              waitDurationMs: Date.now() - Date.parse(waitStartedAt),
              timeoutMs: feedbackTimeout,
            });
            return {
              content: [{ type: "text", text: "[WAITING] No new feedback yet. Call get_feedback again to continue waiting." }],
            };
          }

          logEvent("info", "feedback.return.live", {
            sessionId,
            waitId,
            waitStartedAt,
            waitDurationMs: Date.now() - Date.parse(waitStartedAt),
            contentLength: result.length,
          });
          return formatResponseWithHeadTail(result, parsed.data.head, parsed.data.tail);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logEvent("error", "mcp.tool.error", { error: errorMessage });
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  targetServer.oninitialized = async () => {
    // Intentionally no MCP roots/path handling in feedback-only mode.
  };
}

function createSessionServer(): Server {
  const sessionServer = new Server(
    { name: "tasksync-server", version: "1.0.0" },
    { capabilities: { tools: {}, logging: {} } }
  );
  registerServerHandlers(sessionServer);
  return sessionServer;
}

function startFeedbackUI() {
  const uiBaseUrl = `http://localhost:${uiPort}`;
  const feedbackApp = express();
  feedbackApp.use(express.urlencoded({ extended: true }));
  feedbackApp.use(express.json());

  function renderHtml(): string {
    const activeAlias = getSessionAlias(activeUiSessionId);
    const activeLabel = activeAlias ? `${activeAlias} (${activeUiSessionId})` : activeUiSessionId;
    return FEEDBACK_HTML
      .replace("FEEDBACK_PATH", "in-memory feedback queue (non-persistent)")
      .replace("ACTIVE_SESSION_INFO", `Active session: ${activeLabel} | Known sessions: ${streamableSessions.size}`);
  }

  feedbackApp.get("/", (_req, res) => {
    res.type("html").send(renderHtml());
  });

  feedbackApp.get("/session/:sessionId", (_req, res) => {
    res.type("html").send(renderHtml());
  });

  feedbackApp.get("/feedback", (req, res) => {
    const querySession = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    const targetSessionId = querySession.trim() || activeUiSessionId;
    const normalizedSessionId = getSessionId(targetSessionId);
    const state = feedbackStateBySession.get(normalizedSessionId);
    res.type("text").send(state?.latestFeedback || "");
  });

  feedbackApp.get("/sessions", (_req, res) => {
    const sessions = Array.from(streamableSessions.entries()).map(([sessionId, entry]) => {
      const state = getFeedbackState(sessionId);
      const alias = getSessionAlias(sessionId);
      return {
        sessionId,
        alias,
        sessionUrl: `${uiBaseUrl}/session/${encodeURIComponent(sessionId)}`,
        createdAt: entry.createdAt,
        lastActivityAt: entry.lastActivityAt,
        waitingForFeedback: Boolean(state.pendingWaiter),
        hasQueuedFeedback: Boolean(state.queuedFeedback),
      };
    });

    res.json({
      defaultUiSessionId: activeUiSessionId,
      activeUiSessionId,
      sessions,
    });
  });

  const setDefaultSessionHandler = (req: express.Request, res: express.Response) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
    if (!sessionId || !streamableSessions.has(sessionId)) {
      logEvent("warn", "ui.sessions.active.invalid", { sessionId });
      res.status(400).json({ error: "Unknown sessionId" });
      return;
    }

    activeUiSessionId = sessionId;
    logEvent("info", "ui.sessions.active.set", { sessionId });
    res.json({
      ok: true,
      defaultUiSessionId: activeUiSessionId,
      activeUiSessionId,
    });
  };

  feedbackApp.post("/sessions/default", setDefaultSessionHandler);
  feedbackApp.post("/sessions/active", setDefaultSessionHandler);

  feedbackApp.post("/sessions/:sessionId/alias", (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !streamableSessions.has(sessionId)) {
      logEvent("warn", "ui.sessions.alias.invalid", { sessionId });
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const alias = normalizeAlias(req.body?.alias);
    if (alias) {
      manualAliasBySession.set(sessionId, alias);
      logEvent("info", "ui.sessions.alias.set", { sessionId, alias });
    } else {
      manualAliasBySession.delete(sessionId);
      logEvent("info", "ui.sessions.alias.cleared", { sessionId });
    }

    res.json({ ok: true, sessionId, alias: getSessionAlias(sessionId) });
  });

  feedbackApp.delete("/sessions/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = streamableSessions.get(sessionId);
    if (!session) {
      logEvent("warn", "ui.sessions.delete.missing", { sessionId });
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      await session.transport.close();
      streamableSessions.delete(sessionId);
      feedbackStateBySession.delete(sessionId);
      manualAliasBySession.delete(sessionId);
      inferredAliasBySession.delete(sessionId);
      if (activeUiSessionId === sessionId) {
        activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
      }
      logEvent("info", "ui.sessions.delete.ok", { sessionId });
      res.json({ ok: true });
    } catch (error) {
      logEvent("error", "ui.sessions.delete.error", { sessionId, error: String(error) });
      res.status(500).json({ error: String(error) });
    }
  });

  feedbackApp.post("/feedback", (req, res) => {
    try {
      const content = typeof req.body === "string" ? req.body : req.body.content ?? "";
      const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      const targetSessionId = requestedSessionId || activeUiSessionId;
      const normalizedSessionId = getSessionId(targetSessionId);

      const state = getFeedbackState(normalizedSessionId);
      state.latestFeedback = content;
      logEvent("info", "ui.feedback.post", {
        requestedSessionId,
        targetSessionId: normalizedSessionId,
        contentLength: content.length,
      });
      if (content.trim().length > 0) {
        resolvePendingFeedback(content, normalizedSessionId);
      }

      res.json({ ok: true, sessionId: normalizedSessionId });
    } catch (err) {
      logEvent("error", "ui.feedback.post.error", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  feedbackApp.listen(uiPort, () => {
    logEvent("info", "ui.started", { uiPort });
    console.error(`Feedback UI running at http://localhost:${uiPort}`);
  });

  setTimeout(() => {
    const url = `http://localhost:${uiPort}`;
    if (process.platform === "linux") {
      const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
      if (!hasDisplay) {
        console.error(`No display detected (SSH/headless). Open manually: ${url}`);
        return;
      }
    }

    if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore" }).on("error", () => {
        console.error(`Failed to open browser. Open manually: ${url}`);
      });
      return;
    }

    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore" }).on("error", () => {
        console.error(`Failed to open browser. Open manually: ${url}`);
      });
      return;
    }

    spawn("xdg-open", [url], { stdio: "ignore" }).on("error", () => {
      console.error(`Failed to open browser. Open manually: ${url}`);
    });
  }, 1000);
}

async function runStreamableHTTPServer() {
  const app = express();

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id, last-event-id");
    res.header("Access-Control-Expose-Headers", "mcp-session-id");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json());

  const mcpHandler = async (req: express.Request, res: express.Response) => {
    try {
      logEvent("debug", "mcp.request", {
        method: req.method,
        path: req.path,
        hasSessionHeader: typeof req.headers["mcp-session-id"] === "string",
      });
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
      let entry: StreamableSessionEntry | undefined;

      if (sessionId) {
        entry = streamableSessions.get(sessionId);
        if (!entry) {
          if (req.method === "DELETE") {
            logEvent("info", "mcp.session.delete.missing", { sessionId });
            res.status(200).json({ jsonrpc: "2.0", result: {}, id: null });
            return;
          }

          logEvent("warn", "mcp.session.invalid", { sessionId, method: req.method });
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: Invalid session ID" },
            id: null,
          });
          return;
        }
        entry.lastActivityAt = new Date().toISOString();
        logEvent("debug", "mcp.session.reused", {
          sessionId,
          method: req.method,
          transportId: entry.transportId,
          clientAlias: entry.clientAlias || undefined,
          clientGeneration: entry.clientGeneration ?? undefined,
        });
      } else {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          logEvent("warn", "mcp.session.missing", { method: req.method });
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null,
          });
          return;
        }

        const sessionServer = createSessionServer();
        const inferredAlias = inferAliasFromInitializeBody(req.body);
        const clientAlias = inferredAlias || "unknown-client";
        const clientGeneration = nextClientGeneration(clientAlias);
        const transportId = randomUUID();
        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            if (inferredAlias) {
              inferredAliasBySession.set(initializedSessionId, inferredAlias);
            }
            streamableSessions.set(initializedSessionId, {
              transport: createdTransport,
              server: sessionServer,
              transportId,
              clientAlias,
              clientGeneration,
              createdAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            });
            // If this client alias had queued feedback on a previous session, migrate it
            try {
              const destState = getFeedbackState(initializedSessionId);
              for (const [otherId, otherEntry] of streamableSessions.entries()) {
                if (otherId === initializedSessionId) continue;
                if (otherEntry.clientAlias === clientAlias) {
                  const srcState = getFeedbackState(otherId);
                  if (srcState.queuedFeedback && !destState.queuedFeedback) {
                    destState.queuedFeedback = srcState.queuedFeedback;
                    destState.queuedAt = srcState.queuedAt;
                    srcState.queuedFeedback = null;
                    srcState.queuedAt = null;
                    logEvent("info", "feedback.migrated", {
                      fromSessionId: otherId,
                      toSessionId: initializedSessionId,
                      queuedAt: destState.queuedAt,
                      contentLength: destState.queuedFeedback.length,
                    });
                    break;
                  }
                }
              }
            } catch (e) {
              logEvent("warn", "feedback.migration.failed", { error: String(e), sessionId: initializedSessionId });
            }
            logEvent("info", "mcp.session.created", {
              sessionId: initializedSessionId,
              transportId,
              clientAlias,
              clientGeneration,
              inferredAlias: inferredAlias || undefined,
              activeSessions: streamableSessions.size,
            });
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          clearPendingWaiter(closedSessionId, "stream_closed");
          const closedEntry = streamableSessions.get(closedSessionId);
          // Stream closures can be transient (for example SSE reconnects).
          // Keep session state unless an explicit DELETE/session disconnect occurs.
          logEvent("warn", "mcp.session.stream.closed", {
            sessionId: closedSessionId,
            transportId: closedEntry?.transportId ?? transportId,
            clientAlias: closedEntry?.clientAlias || clientAlias,
            clientGeneration: closedEntry?.clientGeneration ?? clientGeneration,
            activeSessions: streamableSessions.size,
          });
        };

        await sessionServer.connect(createdTransport);
        entry = {
          transport: createdTransport,
          server: sessionServer,
          transportId,
          clientAlias,
          clientGeneration,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        };
      }

      if (!entry) {
        throw new Error("No session entry available to handle MCP request");
      }

      await entry.transport.handleRequest(req, res, req.body);

      if (req.method === "DELETE" && sessionId) {
        clearPendingWaiter(sessionId, "explicit_delete");
        streamableSessions.delete(sessionId);
        feedbackStateBySession.delete(sessionId);
        manualAliasBySession.delete(sessionId);
        inferredAliasBySession.delete(sessionId);
        if (activeUiSessionId === sessionId) {
          activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
        }
        logEvent("info", "mcp.session.closed", {
          sessionId,
          transportId: entry.transportId,
          clientAlias: entry.clientAlias || undefined,
          clientGeneration: entry.clientGeneration ?? undefined,
          activeSessions: streamableSessions.size,
          reason: "explicit_delete",
        });
      }
    } catch (error) {
      logEvent("error", "mcp.request.error", { error: String(error) });
      console.error("Error handling streamable HTTP MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", mcpHandler);
  app.get("/mcp", mcpHandler);
  app.delete("/mcp", mcpHandler);

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: "tasksync-mcp",
      version: "1.0.0",
      transport: "streamable-http",
      sessions: streamableSessions.size,
      persistence: "none",
    });
  });

  app.listen(mcpPort, () => {
    logEvent("info", "server.started", {
      mcpPort,
      uiEnabled: !noUI,
      uiPort,
      timeoutMs: feedbackTimeout,
      logLevel,
    });
    console.error(`TaskSync MCP Server running on Streamable HTTP at http://localhost:${mcpPort}`);
    console.error(`MCP endpoint: http://localhost:${mcpPort}/mcp`);
    console.error(`Health check: http://localhost:${mcpPort}/health`);
  });

  if (!noUI) {
    startFeedbackUI();
  }
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  logEvent("info", "server.cleanup.start", { activeSessions: streamableSessions.size });
  console.error("\nShutting down server...");
  for (const [sessionId, session] of streamableSessions.entries()) {
    session.transport.close().catch(() => {
      /* best-effort shutdown */
    });
    streamableSessions.delete(sessionId);
    feedbackStateBySession.delete(sessionId);
  }
  logEvent("info", "server.cleanup.done", { activeSessions: streamableSessions.size });
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

runStreamableHTTPServer().catch((error) => {
  console.error("Fatal error running TaskSync server:", error);
  process.exit(1);
});
