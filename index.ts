#!/usr/bin/env node

import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import express from "express";
import { FEEDBACK_HTML } from "./feedback-html.js";
import { SessionStateStore, type ImageAttachment } from "./session-state-store.js";
import { InMemoryStreamEventStore } from "./stream-event-store.js";
import {
  SessionManager,
  type FeedbackChannelState,
  type StreamableSessionEntry,
  type PendingFeedbackResult,
  type PendingWaiter,
} from "./session-manager.js";
import { ChannelManager, type ChannelManagerConfig } from "./channels.js";

const DEFAULT_TIMEOUT = 3_600_000; // safety-net timeout (1 hour); SSE keepalive prevents idle disconnects, this is the absolute max wait

const args = process.argv.slice(2);
const noUI = args.includes("--no-ui");
const mcpPort = parseInt(args.find((arg) => arg.startsWith("--port="))?.split("=")[1] || "3011", 10);
const uiPortArg = args.find((arg) => arg.startsWith("--ui-port="));
const uiPort = parseInt(uiPortArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456", 10);
const heartbeat = args.includes("--heartbeat"); // opt-in: return [WAITING] on timeout (legacy short-poll mode)
const timeoutArg = args.find((arg) => arg.startsWith("--timeout="));
const parsedTimeout = timeoutArg ? parseInt(timeoutArg.split("=")[1], 10) : NaN;
const feedbackTimeout = heartbeat
  ? (Number.isNaN(parsedTimeout) ? DEFAULT_TIMEOUT : parsedTimeout)
  : 0; // heartbeat=false → no timeout, wait indefinitely (keepalive keeps connection alive)
const logLevel = (process.env.TASKSYNC_LOG_LEVEL || "info").toLowerCase();
const logFilePath = process.env.TASKSYNC_LOG_FILE?.trim() || "";

// Channel config — Telegram bot token from env or CLI
const telegramBotToken = process.env.TASKSYNC_TELEGRAM_BOT_TOKEN?.trim()
  || args.find((arg) => arg.startsWith("--telegram-token="))?.split("=")[1]?.trim()
  || "";
const telegramAllowedChatIds = (process.env.TASKSYNC_TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));

const DEFAULT_FEEDBACK_SESSION = "__default__";
const STREAM_RETRY_INTERVAL_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 30000; // 30s SSE comment keepalive to prevent HTTP connection timeout
const AUTO_PRUNE_INTERVAL_MS = 60 * 1000; // check for auto-prune every 1 minute
const DEFAULT_DISCONNECT_AFTER_MINUTES = 20; // prune sessions inactive for >20 minutes by default
const MIN_DISCONNECT_AFTER_MINUTES = 1;
const MAX_DISCONNECT_AFTER_MINUTES = 24 * 60; // 1 day
const DEBUG_BODY_MAX_CHARS = 2000; // truncate debug-logged bodies to this length

// Registry of active SSE plugin connections — used for graceful shutdown notification
const activeSSEClients = new Map<string, import("express").Response>();

// NOTE: FeedbackChannelState, StreamableSessionEntry, PendingFeedbackResult
// are now imported from session-manager.ts

const sessionStateStore = new SessionStateStore();
const streamEventStore = new InMemoryStreamEventStore();
const requestContext = new AsyncLocalStorage<{ requestId: string; res?: express.Response }>();
type UiEventClient = { res: express.Response; targetSessionId: string };
const uiEventClients = new Set<UiEventClient>();

// Session Manager - single source of truth for session state
let sessionManager: SessionManager;

// Channel Manager - notification channels (Telegram, etc.)
let channelManager: ChannelManager = new ChannelManager(logEvent);

// ==========================================================================
// FACADE ACCESSORS - For gradual migration from inline maps to SessionManager
// ==========================================================================

function getActiveUiSessionId(): string {
  return sessionManager.getActiveUiSessionId();
}

function setActiveUiSessionId(sessionId: string): Promise<void> {
  return sessionManager.setActiveUiSession(sessionId);
}

function getFeedbackState(sessionId: string): FeedbackChannelState {
  return sessionManager.getFeedbackState(sessionId);
}

function getSessionAlias(sessionId: string): string {
  return sessionManager.getSessionAlias(sessionId);
}

function hasSession(sessionId: string): boolean {
  return sessionManager.hasSession(sessionId);
}

function getSession(sessionId: string): StreamableSessionEntry | undefined {
  return sessionManager.getSession(sessionId);
}

function getAllSessions(): Map<string, StreamableSessionEntry> {
  return sessionManager.getAllSessions();
}

function resolveUiSessionTarget(rawSessionId?: string): string | null {
  const requestedSessionId = rawSessionId && rawSessionId.trim().length > 0
    ? getSessionId(rawSessionId)
    : undefined;
  return sessionManager.resolveTargetSession(requestedSessionId);
}

function markSessionActivity(sessionId: string, reason: string): void {
  sessionManager.markActivity(sessionId, reason);
}

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
  const line = `[tasksync] ${JSON.stringify(payload)}`;
  console.error(line);
  if (logFilePath) {
    void appendLogLine(line);
  }
}

async function appendLogLine(line: string) {
  if (!logFilePath) return;
  await mkdir(path.dirname(logFilePath), { recursive: true });
  await appendFile(logFilePath, `${line}\n`, "utf8");
}

function maybeParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

function parseSseDebugBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const blocks = trimmed.split(/\n\n+/);
  const events = blocks
    .map((block) => {
      const event: Record<string, unknown> = {};
      const dataLines: string[] = [];

      for (const rawLine of block.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (!line || line.startsWith(":")) continue;
        const separatorIndex = line.indexOf(":");
        const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
        let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
        if (value.startsWith(" ")) value = value.slice(1);

        if (field === "data") {
          dataLines.push(value);
          continue;
        }

        if (field === "retry") {
          const parsedRetry = Number(value);
          event.retry = Number.isFinite(parsedRetry) ? parsedRetry : value;
          continue;
        }

        event[field] = value;
      }

      if (dataLines.length > 0) {
        const dataText = dataLines.join("\n");
        event.data = maybeParseJson(dataText);
      }

      return Object.keys(event).length > 0 ? event : null;
    })
    .filter((event): event is Record<string, unknown> => event !== null);

  if (events.length === 0) {
    return text;
  }

  return {
    sseEvents: events,
  };
}

function normalizeDebugBody(body: unknown, contentType?: string): unknown {
  if (Buffer.isBuffer(body)) {
    return normalizeDebugBody(body.toString("utf8"), contentType);
  }
  if (body instanceof Uint8Array) {
    return normalizeDebugBody(Buffer.from(body).toString("utf8"), contentType);
  }
  if (Array.isArray(body) && body.every((item) => typeof item === "number")) {
    return normalizeDebugBody(Buffer.from(body).toString("utf8"), contentType);
  }
  if (typeof body === "string") {
    if (contentType?.includes("text/html")) {
      return `[HTML content omitted, ${body.length} chars]`;
    }
    if (contentType?.includes("text/event-stream")) {
      return parseSseDebugBody(body);
    }
    if (body.length > DEBUG_BODY_MAX_CHARS) {
      return maybeParseJson(body.slice(0, DEBUG_BODY_MAX_CHARS) + `... [truncated, ${body.length} total chars]`);
    }
    return maybeParseJson(body);
  }
  if (body === undefined) {
    return null;
  }
  return body;
}

function extractMcpDebugMeta(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : undefined;
  const id = typeof record.id === "string" || typeof record.id === "number" ? record.id : undefined;
  const params = record.params && typeof record.params === "object" && !Array.isArray(record.params)
    ? (record.params as Record<string, unknown>)
    : undefined;
  const result = record.result && typeof record.result === "object" && !Array.isArray(record.result)
    ? (record.result as Record<string, unknown>)
    : undefined;

  const meta: Record<string, unknown> = {};
  if (id !== undefined) meta.jsonRpcId = id;
  if (method) {
    meta.mcpMethod = method;
    if (method === "tools/call") {
      const toolName = typeof params?.name === "string" ? params.name : undefined;
      if (toolName) meta.mcpToolName = toolName;
    }
  }

  if (result) {
    if (Array.isArray(result.tools)) {
      meta.mcpResponseKind = "tools/list";
      meta.mcpToolCount = result.tools.length;
    } else if (Array.isArray(result.content)) {
      meta.mcpResponseKind = "tools/call";
      meta.mcpContentCount = result.content.length;
    }
  }

  return meta;
}

function logDebugPretty(label: string, payload: unknown) {
  if (!shouldLog("debug")) return;
  const formatted = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const line = `[tasksync][debug] ${label}\n${formatted}`;
  console.error(line);
  if (logFilePath) {
    void appendLogLine(line);
  }
}

function buildUiStatePayload(targetSessionId?: string) {
  const activeUiSessionId = getActiveUiSessionId();
  const normalizedSessionId = resolveUiSessionTarget(targetSessionId) ?? activeUiSessionId;
  const sessions = Array.from(getAllSessions().entries()).map(([sessionId, entry]) => {
    const state = getFeedbackState(sessionId);
    const alias = getSessionAlias(sessionId);
    return {
      sessionId,
      alias,
      sessionUrl: `http://localhost:${uiPort}/session/${encodeURIComponent(sessionId)}`,
      createdAt: entry.createdAt,
      lastActivityAt: entry.lastActivityAt,
      waitingForFeedback: Boolean(state.pendingWaiter),
      waitStartedAt: state.pendingWaiter?.startedAt || null,
      hasQueuedFeedback: Boolean(state.queuedFeedback),
      remoteEnabled: state.remoteEnabled,
    };
  });
  const state = sessionManager.getFeedbackState(normalizedSessionId);
  return {
    activeUiSessionId,
    sessionId: normalizedSessionId,
    latestFeedback: state?.latestFeedback || "",
    history: state?.history || [],
    sessions,
    channelsAvailable: channelManager?.hasChannels ?? false,
    agentContext: state?.agentContext || null,
  };
}

function broadcastUiState(_triggerSessionId?: string) {
  if (uiEventClients.size === 0) return;
  for (const client of uiEventClients) {
    const payload = JSON.stringify(buildUiStatePayload(client.targetSessionId));
    client.res.write(`event: state\ndata: ${payload}\n\n`);
  }
}

function installDebugHttpLogging(app: express.Express, scope: string) {
  app.use((req, res, next) => {
    if (!shouldLog("debug")) {
      next();
      return;
    }

    const startedAt = Date.now();
    const requestId = randomUUID();
    const responseChunks: Buffer[] = [];
    let totalResponseBytes = 0;
    const MAX_RESPONSE_LOG_BYTES = 50_000;
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    function toLoggedBuffer(chunk: unknown): Buffer | null {
      if (chunk === undefined || chunk === null) return null;
      if (Buffer.isBuffer(chunk)) return chunk;
      if (chunk instanceof Uint8Array) return Buffer.from(chunk);
      if (Array.isArray(chunk) && chunk.every((item) => typeof item === "number")) {
        return Buffer.from(chunk);
      }
      return Buffer.from(String(chunk), "utf8");
    }

    function shouldCapture(chunk: Buffer): boolean {
      // Skip SSE keepalive comments from debug accumulation
      const text = chunk.toString("utf8");
      if (text === ": keepalive\n\n") return false;
      // Stop accumulating after threshold
      if (totalResponseBytes >= MAX_RESPONSE_LOG_BYTES) return false;
      return true;
    }

    res.write = ((chunk: unknown, ...args: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk && shouldCapture(loggedChunk)) {
        responseChunks.push(loggedChunk);
        totalResponseBytes += loggedChunk.length;
      }
      return originalWrite(chunk as never, ...(args as Parameters<typeof originalWrite> extends [unknown, ...infer Rest] ? Rest : never));
    }) as typeof res.write;

    res.end = ((chunk?: unknown, ...args: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk) {
        responseChunks.push(loggedChunk);
      }
      return originalEnd(chunk as never, ...(args as Parameters<typeof originalEnd> extends [unknown?, ...infer Rest] ? Rest : never));
    }) as typeof res.end;

    logDebugPretty(`${scope}.request`, {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      ...extractMcpDebugMeta(normalizeDebugBody(req.body, String(req.headers["content-type"] || ""))),
      body: normalizeDebugBody(req.body, String(req.headers["content-type"] || "")),
    });

    res.on("finish", () => {
      const rawBody = Buffer.concat(responseChunks).toString("utf8");
      const responseContentType = String(res.getHeader("content-type") || "");
      const normalizedResponseBody = normalizeDebugBody(rawBody, responseContentType);
      logDebugPretty(`${scope}.response`, {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        headers: res.getHeaders(),
        ...extractMcpDebugMeta(normalizedResponseBody),
        body: normalizedResponseBody,
      });
    });

    next();
  });
}

const GetFeedbackArgsSchema = z.object({}).strict();

type ToolInput = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

function getSessionId(rawSessionId?: string): string {
  return rawSessionId && rawSessionId.trim().length > 0 ? rawSessionId : DEFAULT_FEEDBACK_SESSION;
}

// NOTE: getFeedbackState, toPersistedFeedbackState, appendFeedbackHistory, persistFeedbackState,
// persistActiveUiSession, persistSessionMetadata are now handled by SessionManager

function persistAsync(task: string, work: Promise<void>) {
  void work.catch((error) => {
    logEvent("error", task, { error: String(error) });
  });
}

// NOTE: reassociatePersistedStateForAlias, hydratePersistedState, nextClientGeneration
// are now handled internally by SessionManager.initialize() and SessionManager methods

/**
 * Mark a session as having meaningful activity.
 * This should be called on:
 * - get_feedback tool calls
 * - Feedback delivery/queueing
 * NOT on:
 * - MCP polling/keep-alive requests
 */
// NOTE: markSessionActivity is now handled by SessionManager (see facade function at top)

function formatFeedbackResponse(content: string, images?: ImageAttachment[]): { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] } {
  const blocks: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  blocks.push({ type: "text", text: content });
  if (images && images.length > 0) {
    for (const img of images) {
      blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }
  return { content: blocks };
}

function normalizeAlias(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

// NOTE: getSessionAlias is now handled by SessionManager (see facade function at top)

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

/** Converts an inferred client alias (e.g., "opencode 1.2.24") into a short, URL-safe session ID prefix (e.g., "opencode"). */
function slugifyForSessionId(clientAlias: string): string {
  const namePart = clientAlias.split(/\s+/)[0] || "session";
  return namePart.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "session";
}

async function resolvePendingFeedback(content: string, rawSessionId?: string, images?: ImageAttachment[]): Promise<boolean> {
  const sessionId = getSessionId(rawSessionId);
  const result = await sessionManager.deliverFeedback(sessionId, content, images);
  return result.delivered;
}

async function clearPendingWaiter(sessionId: string, reason: string, expectedRequestId?: string) {
  await sessionManager.clearPendingWaiter(sessionId, reason, expectedRequestId);
}

function attachPendingWaiterCleanup(
  req: express.Request,
  res: express.Response,
  sessionId: string,
  requestId: string
) {
  let handled = false;

  const clearIfOwned = (reason: string) => {
    if (handled) return;
    handled = true;
    persistAsync(
      "session.persistence.request_closed",
      clearPendingWaiter(sessionId, reason, requestId)
    );
  };

  req.once("aborted", () => {
    logEvent("warn", "mcp.request.aborted", { sessionId, requestId, method: req.method });
    clearIfOwned("request_aborted");
  });

  res.once("close", () => {
    logEvent("debug", "mcp.request.closed", {
      sessionId,
      requestId,
      method: req.method,
      writableEnded: res.writableEnded,
    });
    clearIfOwned(res.writableEnded ? "response_closed" : "response_disconnected");
  });
}

function registerServerHandlers(targetServer: Server) {
  targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_feedback",
          description:
            "Wait for human feedback for the current session. " +
            "This call blocks until feedback is submitted from the TaskSync UI or timeout is reached.",
          inputSchema: zodToJsonSchema(GetFeedbackArgsSchema, { target: "openApi3" }) as ToolInput,
        },
      ],
    };
  });

  targetServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    try {
      const { name, arguments: args } = request.params;
      const sessionId = getSessionId(extra?.sessionId);
      await setActiveUiSessionId(sessionId);
      const feedbackState = getFeedbackState(sessionId);
      logEvent("debug", "mcp.tool.call", { tool: name, sessionId });

      switch (name) {
        case "get_feedback": {
          const parsed = GetFeedbackArgsSchema.safeParse(args ?? {});
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
          }

          // Mark meaningful activity - get_feedback is a signal that the agent is active
          markSessionActivity(sessionId, "get_feedback");

          // Check for queued feedback
          const queued = sessionManager.consumeQueuedFeedback(sessionId);
          if (queued !== null) {
            logEvent("info", "feedback.return.queued", {
              sessionId,
              contentLength: queued.content.length,
              imageCount: queued.images?.length ?? 0,
            });
            return formatFeedbackResponse(queued.content, queued.images);
          }

          const waitId = randomUUID();
          const waitStartedAt = new Date().toISOString();
          const requestId = requestContext.getStore()?.requestId ?? randomUUID();
          const feedbackPromise = new Promise<PendingFeedbackResult>((resolve) => {
            sessionManager.setWaiter(sessionId, {
              waitId,
              startedAt: waitStartedAt,
              requestId,
              resolve,
            });
          });
          logEvent("info", "feedback.waiting", {
            sessionId,
            requestId,
            waitId,
            waitStartedAt,
            heartbeat,
            timeoutMs: feedbackTimeout,
          });

          // Trigger remote notification for MCP sessions
          if (sessionManager.isRemoteEnabled(sessionId) && channelManager?.hasChannels) {
            const context = sessionManager.getAgentContext(sessionId);
            channelManager.notify({
              sessionId,
              sessionAlias: sessionManager.getSessionAlias(sessionId),
              context: context ?? undefined,
            }).catch((err) => {
              logEvent("error", "feedback.notify.error", { sessionId, error: String(err) });
            });
          }

          // --- SSE keepalive: write SSE comments to prevent HTTP connection timeout ---
          const httpRes = requestContext.getStore()?.res;
          let keepaliveSentCount = 0;
          const clearKeepalive = (reason: string) => {
            if (keepaliveInterval) {
              clearInterval(keepaliveInterval);
              keepaliveInterval = null;
              logEvent("debug", "feedback.keepalive.stopped", {
                sessionId, requestId, waitId, reason, totalSent: keepaliveSentCount,
              });
            }
          };
          if (httpRes && !httpRes.writableEnded) {
            logEvent("debug", "feedback.keepalive.started", {
              sessionId, requestId, waitId, intervalMs: KEEPALIVE_INTERVAL_MS,
            });
            keepaliveInterval = setInterval(() => {
              if (!httpRes.writableEnded) {
                try {
                  httpRes.write(": keepalive\n\n");
                  keepaliveSentCount++;
                  if (keepaliveSentCount % 10 === 0) {
                    logEvent("debug", "feedback.keepalive.sent", {
                      sessionId, requestId, waitId, count: keepaliveSentCount,
                    });
                  }
                } catch {
                  clearKeepalive("write_error");
                }
              } else {
                clearKeepalive("stream_ended");
              }
            }, KEEPALIVE_INTERVAL_MS);
          }

          let result: PendingFeedbackResult | null;
          if (feedbackTimeout > 0) {
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), feedbackTimeout)
            );
            result = await Promise.race([feedbackPromise, timeoutPromise]);
          } else {
            result = await feedbackPromise;
          }

          if (result === null) {
            clearKeepalive("timeout");
            // Clear the waiter if it's still ours
            if (sessionManager.isWaiting(sessionId)) {
              await sessionManager.clearPendingWaiter(sessionId, "timeout", requestId);
            }
            logEvent("info", "feedback.wait.timeout", {
              sessionId,
              requestId,
              waitId,
              waitStartedAt,
              waitDurationMs: Date.now() - Date.parse(waitStartedAt),
              timeoutMs: feedbackTimeout,
              keepalivesSent: keepaliveSentCount,
            });
            return {
              content: [{ type: "text", text: "[WAITING] No new feedback yet. Call get_feedback again to continue waiting." }],
            };
          }

          if (result.type === "closed") {
            clearKeepalive("connection_closed");
            logEvent("warn", "feedback.wait.interrupted", {
              sessionId,
              requestId,
              waitId,
              waitStartedAt,
              waitDurationMs: Date.now() - Date.parse(waitStartedAt),
              reason: result.reason,
              keepalivesSent: keepaliveSentCount,
            });
            return {
              content: [{ type: "text", text: "[WAITING] Feedback wait interrupted. Call get_feedback again to continue waiting." }],
            };
          }

          clearKeepalive("feedback_received");
          logEvent("debug", "feedback.return.live", {
            sessionId,
            requestId,
            waitId,
            waitStartedAt,
            waitDurationMs: Date.now() - Date.parse(waitStartedAt),
            contentLength: result.content.length,
            imageCount: result.images?.length ?? 0,
            keepalivesSent: keepaliveSentCount,
          });
          return formatFeedbackResponse(result.content, result.images);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
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
  feedbackApp.use(express.json({ limit: "50mb" }));
  installDebugHttpLogging(feedbackApp, "ui.http");

  function renderHtml(viewSessionId?: string): string {
    const displaySessionId = viewSessionId || getActiveUiSessionId();
    const displayAlias = getSessionAlias(displaySessionId);
    const displayLabel = displayAlias ? `${displayAlias} (${displaySessionId})` : displaySessionId;
    return FEEDBACK_HTML
      .replace("ACTIVE_SESSION_INFO", `Active session: ${displayLabel} | Known sessions: ${getAllSessions().size}`);
  }

  feedbackApp.get("/", (_req, res) => {
    res.type("html").send(renderHtml());
  });

  feedbackApp.get("/session/:sessionId", (req, res) => {
    res.type("html").send(renderHtml(req.params.sessionId));
  });

  feedbackApp.get("/events", (req, res) => {
    const targetSessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    const resolvedSessionId = resolveUiSessionTarget(targetSessionId) ?? getActiveUiSessionId();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const client = { res, targetSessionId: resolvedSessionId };
    uiEventClients.add(client);
    res.write(`event: state\ndata: ${JSON.stringify(buildUiStatePayload(resolvedSessionId))}\n\n`);
    req.on("close", () => {
      uiEventClients.delete(client);
    });
  });

  feedbackApp.get("/feedback/history", (req, res) => {
    const querySession = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    const normalizedSessionId = resolveUiSessionTarget(querySession.trim()) ?? getActiveUiSessionId();
    const state = getFeedbackState(normalizedSessionId);
    res.json({ sessionId: normalizedSessionId, history: state?.history || [] });
  });

  feedbackApp.get("/sessions", (_req, res) => {
    const payload = buildUiStatePayload();
    res.json({
      defaultUiSessionId: payload.activeUiSessionId,
      activeUiSessionId: payload.activeUiSessionId,
      sessions: payload.sessions,
    });
  });

  const setDefaultSessionHandler = async (req: express.Request, res: express.Response) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
    if (!sessionId || !hasSession(sessionId)) {
      logEvent("warn", "ui.sessions.active.invalid", { sessionId });
      res.status(400).json({ error: "Unknown sessionId" });
      return;
    }

    await setActiveUiSessionId(sessionId);
    logEvent("info", "ui.sessions.active.set", { sessionId });
    const currentActiveId = getActiveUiSessionId();
    res.json({
      ok: true,
      defaultUiSessionId: currentActiveId,
      activeUiSessionId: currentActiveId,
    });
  };

  feedbackApp.post("/sessions/default", setDefaultSessionHandler);
  feedbackApp.post("/sessions/active", setDefaultSessionHandler);

  feedbackApp.post("/sessions/:sessionId/alias", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !hasSession(sessionId)) {
      logEvent("warn", "ui.sessions.alias.invalid", { sessionId });
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const alias = normalizeAlias(req.body?.alias);
    if (alias) {
      sessionManager.setManualAlias(sessionId, alias);
      logEvent("info", "ui.sessions.alias.set", { sessionId, alias });
    } else {
      sessionManager.setManualAlias(sessionId, "");
      logEvent("info", "ui.sessions.alias.cleared", { sessionId });
    }

    res.json({ ok: true, sessionId, alias: getSessionAlias(sessionId) });
  });

  feedbackApp.delete("/sessions/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = getSession(sessionId);
    if (!session) {
      logEvent("warn", "ui.sessions.delete.missing", { sessionId });
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      await sessionManager.deleteSession(sessionId, "ui_delete");
      logEvent("info", "ui.sessions.delete.ok", { sessionId });
      res.json({ ok: true });
    } catch (error) {
      logEvent("error", "ui.sessions.delete.error", { sessionId, error: String(error) });
      res.status(500).json({ error: String(error) });
    }
  });

  feedbackApp.post("/sessions/prune", async (req, res) => {
    const maxAgeMs = typeof req.body?.maxAgeMs === "number" ? req.body.maxAgeMs : 60 * 60 * 1000;
    const forceIncludeWaiting = req.body?.forceIncludeWaiting === true;
    
    try {
      const result = await sessionManager.manualPrune(maxAgeMs, forceIncludeWaiting);
      logEvent("info", "ui.sessions.prune.complete", {
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
      logEvent("error", "ui.sessions.prune.error", { error: String(error) });
      res.status(500).json({ error: String(error) });
    }
  });

  // Settings endpoints
  feedbackApp.get("/settings", (_req, res) => {
    res.json({
      disconnectAfterMinutes: sessionManager.getDisconnectAfterMinutes(),
    });
  });

  feedbackApp.post("/settings/disconnect-after", async (req, res) => {
    const minutes = typeof req.body?.minutes === "number" ? req.body.minutes : DEFAULT_DISCONNECT_AFTER_MINUTES;
    await sessionManager.setDisconnectAfterMinutes(minutes);
    res.json({ ok: true, disconnectAfterMinutes: sessionManager.getDisconnectAfterMinutes() });
  });

  // Remote mode endpoints
  feedbackApp.post("/sessions/:sessionId/remote", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !hasSession(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const enabled = req.body?.enabled === true;
    sessionManager.setRemoteEnabled(sessionId, enabled);
    res.json({ ok: true, sessionId, remoteEnabled: enabled });
  });

  feedbackApp.get("/channels", (_req, res) => {
    res.json({
      available: channelManager.hasChannels,
      channels: channelManager.hasChannels ? ["telegram"] : [],
    });
  });

  feedbackApp.post("/api/status/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !hasSession(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (!sessionManager.isRemoteEnabled(sessionId)) {
      res.status(200).json({ ok: true, skipped: true, reason: "remote_not_enabled" });
      return;
    }
    const context = typeof req.body?.context === "string" ? req.body.context : "";
    if (!context) {
      res.status(400).json({ error: "Missing context" });
      return;
    }
    sessionManager.setAgentContext(sessionId, context);

    logEvent("info", "api.status.fyi", { sessionId, contextLength: context.length });

    await channelManager.sendFYI({ sessionId, sessionAlias: sessionManager.getSessionAlias(sessionId), context });
    res.json({ ok: true, sessionId });
  });

  feedbackApp.post("/feedback", async (req, res) => {
    try {
      const content = typeof req.body === "string" ? req.body : req.body.content ?? "";
      const rawImages = Array.isArray(req.body?.images) ? req.body.images : [];
      const images: ImageAttachment[] = rawImages
        .filter((img: unknown): img is Record<string, unknown> => img !== null && typeof img === "object")
        .filter((img: Record<string, unknown>) => typeof img.data === "string" && typeof img.mimeType === "string")
        .map((img: Record<string, unknown>) => ({ data: img.data as string, mimeType: img.mimeType as string }));
      const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      const normalizedSessionId = resolveUiSessionTarget(requestedSessionId);

      // Strict session targeting: fail if session doesn't exist
      if (!normalizedSessionId) {
        logEvent("warn", "ui.feedback.post.no_session", {
          requestedSessionId,
          availableSessions: Array.from(getAllSessions().keys()),
        });
        res.status(400).json({
          error: requestedSessionId
            ? `Session "${requestedSessionId}" not found`
            : "No active session to receive feedback"
        });
        return;
      }

      const hasContent = content.trim().length > 0 || images.length > 0;
      logEvent("info", "ui.feedback.post", {
        requestedSessionId,
        targetSessionId: normalizedSessionId,
        contentLength: content.length,
        imageCount: images.length,
      });
      if (hasContent) {
        sessionManager.appendHistory(normalizedSessionId, content, images.length > 0 ? images : undefined);
        await resolvePendingFeedback(content, normalizedSessionId, images.length > 0 ? images : undefined);
      }

      res.json({ ok: true, sessionId: normalizedSessionId });
    } catch (err) {
      logEvent("error", "ui.feedback.post.error", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Plugin API endpoints ──────────────────────────────────────────
  // These endpoints allow external clients (e.g. OpenCode plugin) to
  // register sessions and long-poll for feedback without MCP transport.

  feedbackApp.post("/api/sessions", async (req, res) => {
    try {
      const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      // Idempotent: if session already exists, just return ok
      if (hasSession(sessionId)) {
        res.json({ ok: true, sessionId, existing: true });
        return;
      }

      const alias = typeof req.body?.alias === "string" ? normalizeAlias(req.body.alias) : "";
      const transportId = `plugin-${sessionId}`;

      sessionManager.createSession(
        sessionId,
        undefined, // no MCP transport
        undefined, // no MCP server
        transportId,
        alias || sessionId,
        null
      );

      if (alias) {
        sessionManager.setInferredAlias(sessionId, alias);
      }

      logEvent("info", "api.session.registered", { sessionId, alias: alias || undefined });
      res.json({ ok: true, sessionId, existing: false });
    } catch (err) {
      logEvent("error", "api.session.register.error", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // SSE stream endpoint for plugin wait — keepalives prevent client timeout
  feedbackApp.get("/api/stream/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId?.trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    // Auto-register session if not exists (idempotent)
    if (!hasSession(sessionId)) {
      const transportId = `plugin-${sessionId}`;
      sessionManager.createSession(sessionId, undefined, undefined, transportId, sessionId, null);
      logEvent("info", "api.stream.auto_registered", { sessionId });
    }

    // Check queued feedback first — return immediately as SSE event
    const queued = sessionManager.consumeQueuedFeedback(sessionId);
    if (queued) {
      logEvent("info", "api.stream.queued", { sessionId, contentLength: queued.content.length });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: feedback\ndata: ${JSON.stringify({ type: "feedback", content: queued.content, images: queued.images || null })}\n\n`);
      res.end();
      return;
    }

    // Set up waiter
    const waitId = crypto.randomUUID();
    const { promise, resolve } = Promise.withResolvers<PendingFeedbackResult>();

    sessionManager.setWaiter(sessionId, {
      waitId,
      startedAt: new Date().toISOString(),
      requestId: waitId,
      resolve,
    });

    logEvent("info", "api.stream.started", { sessionId, waitId });

    // Capture agent context from plugin header (base64-encoded to handle newlines in HTTP headers)
    const rawAgentContext = typeof req.headers["x-agent-context"] === "string"
      ? req.headers["x-agent-context"]
      : null;
    const agentContext = rawAgentContext
      ? Buffer.from(rawAgentContext, "base64").toString("utf-8")
      : null;
    if (agentContext) {
      sessionManager.setAgentContext(sessionId, agentContext);
    }

    // Trigger remote notification if remote mode is enabled for this session
    if (sessionManager.isRemoteEnabled(sessionId) && channelManager?.hasChannels) {
      const context = agentContext || sessionManager.getAgentContext(sessionId);
      channelManager.notify({
        sessionId,
        sessionAlias: sessionManager.getSessionAlias(sessionId),
        context: context ?? undefined,
      }).catch((err) => {
        logEvent("error", "api.stream.notify.error", { sessionId, error: String(err) });
      });
    }

    // SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Track this SSE connection for graceful shutdown notification
    activeSSEClients.set(waitId, res);

    // Keepalive to prevent client timeout (Bun default ~4.5min)
    const keepaliveTimer = setInterval(() => {
      res.write(": keepalive\n\n");
    }, KEEPALIVE_INTERVAL_MS);

    const cleanupSSE = () => {
      clearInterval(keepaliveTimer);
      activeSSEClients.delete(waitId);
    };

    // Clean up on client disconnect (plugin abort signal cancels fetch)
    let resolved = false;
    res.on("close", () => {
      cleanupSSE();
      if (!resolved) {
        sessionManager.clearPendingWaiter(sessionId, "client_disconnected", waitId);
        logEvent("info", "api.stream.client_disconnected", { sessionId, waitId });
      }
    });

    try {
      const result = await promise;
      resolved = true;
      cleanupSSE();

      const eventType = result.type === "feedback" ? "feedback" : "closed";
      logEvent("info", "api.stream.resolved", {
        sessionId,
        waitId,
        type: result.type,
        contentLength: result.type === "feedback" ? result.content.length : 0,
      });

      res.write(`event: ${eventType}\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (err) {
      resolved = true;
      cleanupSSE();
      logEvent("error", "api.stream.error", { sessionId, waitId, error: String(err) });
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`);
      res.end();
    }
  });

  feedbackApp.listen(uiPort, () => {
    logEvent("info", "ui.started", { uiPort });
    console.error(`Feedback UI running at http://localhost:${uiPort}`);
  });

  // Auto-prune stale sessions periodically
  // NOTE: Auto-prune is now handled by SessionManager.startAutoPrune()
  // The SessionManager runs prune on interval and broadcasts state changes via events

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
  // Initialize SessionManager - this is the single source of truth for session state
  sessionManager = new SessionManager(sessionStateStore, {
    onStateChange: (sessionId?: string) => {
      broadcastUiState(sessionId);
    },
    onLog: (level, event, details) => {
      logEvent(level, event, details);
    },
  });
  await sessionManager.initialize();

  // Initialize Channel Manager — start Telegram bot if configured
  const channelConfig: ChannelManagerConfig = {};
  if (telegramBotToken) {
    channelConfig.telegram = {
      botToken: telegramBotToken,
      allowedChatIds: telegramAllowedChatIds.length > 0 ? telegramAllowedChatIds : undefined,
    };
  }
  await channelManager.initialize(channelConfig);

  // Route feedback from notification channels (e.g. Telegram replies) to sessions
  channelManager.onFeedback((sessionId, content) => {
    resolvePendingFeedback(content, sessionId).catch((err) => {
      logEvent("error", "channels.feedback.delivery_error", { sessionId, error: String(err) });
    });
  });
  
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
  installDebugHttpLogging(app, "mcp.http");

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
        entry = getSession(sessionId);
        if (!entry) {
          logEvent("warn", "mcp.session.invalid", { sessionId, method: req.method });
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found" },
            id: null,
          });
          return;
        }
        // Note: lastActivityAt is NOT updated here on every request.
        // It's only updated on meaningful activity (get_feedback calls, feedback delivery).
        // This prevents MCP polling from keeping stale sessions alive.
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
        const clientGeneration = sessionManager.getNextClientGeneration(clientAlias);
        const sessionSlug = slugifyForSessionId(clientAlias);
        const transportId = randomUUID();
        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => `${sessionSlug}-${clientGeneration}`,
          eventStore: streamEventStore as never,
          retryInterval: STREAM_RETRY_INTERVAL_MS,
          onsessioninitialized: (initializedSessionId) => {
            if (inferredAlias) {
              sessionManager.setInferredAlias(initializedSessionId, inferredAlias);
            }
            sessionManager.createSession(
              initializedSessionId,
              createdTransport,
              sessionServer,
              transportId,
              clientAlias,
              clientGeneration
            );
            logEvent("info", "mcp.session.created", {
              sessionId: initializedSessionId,
              transportId,
              clientAlias,
              clientGeneration,
              inferredAlias: inferredAlias || undefined,
              activeSessions: getAllSessions().size,
            });
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          persistAsync("session.persistence.stream_closed", clearPendingWaiter(closedSessionId, "stream_closed"));
          const closedEntry = getSession(closedSessionId);
          // Stream closures can be transient (for example SSE reconnects).
          // Keep session state unless an explicit DELETE/session disconnect occurs.
          logEvent("warn", "mcp.session.stream.closed", {
            sessionId: closedSessionId,
            transportId: closedEntry?.transportId ?? transportId,
            clientAlias: closedEntry?.clientAlias || clientAlias,
            clientGeneration: closedEntry?.clientGeneration ?? clientGeneration,
            activeSessions: getAllSessions().size,
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
          status: "active",
        };
        }

      if (!entry) {
        throw new Error("No session entry available to handle MCP request");
      }

      const requestId = randomUUID();
      if (sessionId) {
        attachPendingWaiterCleanup(req, res, sessionId, requestId);
      }

      await requestContext.run({ requestId, res }, async () => {
        await entry.transport!.handleRequest(req, res, req.body);
      });

      if (req.method === "DELETE" && sessionId) {
        await sessionManager.deleteSession(sessionId, "explicit_delete");
        logEvent("info", "mcp.session.closed", {
          sessionId,
          transportId: entry.transportId,
          clientAlias: entry.clientAlias || undefined,
          clientGeneration: entry.clientGeneration ?? undefined,
          activeSessions: getAllSessions().size,
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
      sessions: getAllSessions().size,
      persistence: "file-backed minimal session state; transient in-memory replay",
    });
  });

  app.listen(mcpPort, () => {
    logEvent("info", "server.started", {
      mcpPort,
      uiEnabled: !noUI,
      uiPort,
      heartbeat,
      timeoutMs: feedbackTimeout,
      keepaliveIntervalMs: KEEPALIVE_INTERVAL_MS,
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

  logEvent("info", "server.cleanup.start", { activeSessions: getAllSessions().size, activeSSEClients: activeSSEClients.size });
  console.error("\nShutting down server...");

  // Notify all active SSE plugin clients so they can reconnect gracefully
  for (const [waitId, res] of activeSSEClients) {
    try {
      res.write(`event: closed\ndata: ${JSON.stringify({ type: "closed", reason: "server_shutdown" })}\n\n`);
      res.end();
    } catch {
      // best-effort — client may already be gone
    }
    activeSSEClients.delete(waitId);
  }
  
  // Shutdown SessionManager (clears auto-prune interval)
  sessionManager.shutdown();

  // Shutdown notification channels (stops Telegram polling)
  channelManager.shutdown().catch(() => { /* best-effort */ });
  
  // Close all active sessions
  for (const [sessionId, session] of getAllSessions().entries()) {
    session.transport?.close().catch(() => {
      /* best-effort shutdown */
    });
  }
  logEvent("info", "server.cleanup.done", { activeSessions: getAllSessions().size });
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
