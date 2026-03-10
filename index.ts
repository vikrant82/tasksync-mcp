#!/usr/bin/env node

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
import { SessionStateStore } from "./session-state-store.js";
import { InMemoryStreamEventStore } from "./stream-event-store.js";

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

const DEFAULT_FEEDBACK_SESSION = "__default__";
const STREAM_RETRY_INTERVAL_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 30000; // 30s SSE comment keepalive to prevent HTTP connection timeout
const AUTO_PRUNE_INTERVAL_MS = 5 * 60 * 1000; // check for auto-prune every 5 minutes
const AUTO_PRUNE_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // auto-prune sessions inactive for >4 hours
const DEBUG_BODY_MAX_CHARS = 2000; // truncate debug-logged bodies to this length

type FeedbackChannelState = {
  pendingWaiter: {
    waitId: string;
    startedAt: string;
    requestId: string;
    resolve: (result: PendingFeedbackResult) => void;
  } | null;
  queuedFeedback: string | null;
  queuedAt: string | null;
  latestFeedback: string;
  history: {
    role: "user";
    content: string;
    createdAt: string;
  }[];
};

const MAX_SESSION_HISTORY = 50;

type StreamableSessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  transportId: string;
  clientAlias: string;
  clientGeneration: number | null;
  createdAt: string;
  lastActivityAt: string;
};

type PendingFeedbackResult =
  | { type: "feedback"; content: string }
  | { type: "closed"; reason: string };

const feedbackStateBySession = new Map<string, FeedbackChannelState>();
const streamableSessions = new Map<string, StreamableSessionEntry>();
const manualAliasBySession = new Map<string, string>();
const inferredAliasBySession = new Map<string, string>();
const clientGenerationByAlias = new Map<string, number>();
const sessionStateStore = new SessionStateStore();
const streamEventStore = new InMemoryStreamEventStore();
const requestContext = new AsyncLocalStorage<{ requestId: string; res?: express.Response }>();
let activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
type UiEventClient = { res: express.Response; targetSessionId: string };
const uiEventClients = new Set<UiEventClient>();

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

function resolveUiSessionTarget(rawSessionId?: string): string {
  const requestedSessionId = getSessionId(rawSessionId || activeUiSessionId);
  if (streamableSessions.has(requestedSessionId)) {
    return requestedSessionId;
  }
  if (streamableSessions.has(activeUiSessionId)) {
    return activeUiSessionId;
  }
  const firstLiveSessionId = streamableSessions.keys().next().value;
  return typeof firstLiveSessionId === "string" ? firstLiveSessionId : DEFAULT_FEEDBACK_SESSION;
}

function buildUiStatePayload(targetSessionId?: string) {
  const normalizedSessionId = resolveUiSessionTarget(targetSessionId);
  const sessions = Array.from(streamableSessions.entries()).map(([sessionId, entry]) => {
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
    };
  });
  const state = feedbackStateBySession.get(normalizedSessionId);
  return {
    activeUiSessionId,
    sessionId: normalizedSessionId,
    latestFeedback: state?.latestFeedback || "",
    history: state?.history || [],
    sessions,
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

function getFeedbackState(sessionId: string): FeedbackChannelState {
  const existing = feedbackStateBySession.get(sessionId);
  if (existing) return existing;

  const created: FeedbackChannelState = {
    pendingWaiter: null,
    queuedFeedback: null,
    queuedAt: null,
    latestFeedback: "",
    history: [],
  };
  feedbackStateBySession.set(sessionId, created);
  logEvent("debug", "feedback.state.created", { sessionId });
  return created;
}

function toPersistedFeedbackState(sessionId: string) {
  const state = getFeedbackState(sessionId);
  return {
    queuedFeedback: state.queuedFeedback,
    queuedAt: state.queuedAt,
    latestFeedback: state.latestFeedback,
    history: state.history,
  };
}

function appendFeedbackHistory(sessionId: string, content: string) {
  const state = getFeedbackState(sessionId);
  state.history.push({
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  });
  if (state.history.length > MAX_SESSION_HISTORY) {
    state.history.splice(0, state.history.length - MAX_SESSION_HISTORY);
  }
}

async function persistFeedbackState(sessionId: string) {
  await sessionStateStore.saveFeedbackState(sessionId, toPersistedFeedbackState(sessionId));
  logEvent("debug", "session.state.persisted", { sessionId, kind: "feedback" });
}

async function persistActiveUiSession() {
  await sessionStateStore.setActiveUiSessionId(activeUiSessionId);
  logEvent("debug", "session.state.persisted", {
    sessionId: activeUiSessionId,
    kind: "active_ui_session",
  });
}

async function persistSessionMetadata(sessionId: string, entry: StreamableSessionEntry) {
  await sessionStateStore.saveSessionMetadata(sessionId, {
    sessionId,
    transportId: entry.transportId,
    clientAlias: entry.clientAlias,
    clientGeneration: entry.clientGeneration,
    createdAt: entry.createdAt,
    lastActivityAt: entry.lastActivityAt,
    status: "active",
  });
  logEvent("debug", "session.state.persisted", {
    sessionId,
    kind: "session_metadata",
    transportId: entry.transportId,
  });
}

function persistAsync(task: string, work: Promise<void>) {
  void work.catch((error) => {
    logEvent("error", task, { error: String(error) });
  });
}

async function reassociatePersistedStateForAlias(sessionId: string, clientAlias: string) {
  const destState = getFeedbackState(sessionId);
  for (const [otherId, srcState] of feedbackStateBySession.entries()) {
    if (otherId === sessionId) continue;
    if (getSessionAlias(otherId) !== clientAlias) continue;
    if (!srcState.queuedFeedback || destState.queuedFeedback) continue;

    destState.queuedFeedback = srcState.queuedFeedback;
    destState.queuedAt = srcState.queuedAt;
    srcState.queuedFeedback = null;
    srcState.queuedAt = null;

    await persistFeedbackState(sessionId);
    await persistFeedbackState(otherId);

    logEvent("info", "session.reassociated", {
      fromSessionId: otherId,
      toSessionId: sessionId,
      clientAlias,
      queuedAt: destState.queuedAt,
      contentLength: destState.queuedFeedback.length,
    });
    return;
  }
}

async function hydratePersistedState() {
  const snapshot = await sessionStateStore.load();

  activeUiSessionId = getSessionId(snapshot.activeUiSessionId);

  for (const [sessionId, persistedState] of Object.entries(snapshot.feedbackBySession)) {
    feedbackStateBySession.set(sessionId, {
      pendingWaiter: null,
      queuedFeedback: persistedState.queuedFeedback,
      queuedAt: persistedState.queuedAt,
      latestFeedback: persistedState.latestFeedback,
      history: Array.isArray(persistedState.history) ? persistedState.history : [],
    });
  }

  for (const [sessionId, alias] of Object.entries(snapshot.manualAliasBySession)) {
    manualAliasBySession.set(sessionId, alias);
  }

  for (const [sessionId, alias] of Object.entries(snapshot.inferredAliasBySession)) {
    inferredAliasBySession.set(sessionId, alias);
  }

  for (const [alias, generation] of Object.entries(snapshot.clientGenerationByAlias)) {
    clientGenerationByAlias.set(alias, generation);
  }

  logEvent("info", "session.state.hydrated", {
    feedbackSessions: feedbackStateBySession.size,
    liveSessions: streamableSessions.size,
    persistedSessionMetadata: Object.keys(snapshot.sessionMetadataById).length,
    manualAliases: manualAliasBySession.size,
    inferredAliases: inferredAliasBySession.size,
    activeUiSessionId,
  });
}

async function nextClientGeneration(alias: string): Promise<number> {
  const nextGeneration = (clientGenerationByAlias.get(alias) ?? 0) + 1;
  clientGenerationByAlias.set(alias, nextGeneration);
  await sessionStateStore.setClientGeneration(alias, nextGeneration);
  return nextGeneration;
}

function formatFeedbackResponse(content: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: content }] };
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

/** Converts an inferred client alias (e.g., "opencode 1.2.24") into a short, URL-safe session ID prefix (e.g., "opencode"). */
function slugifyForSessionId(clientAlias: string): string {
  const namePart = clientAlias.split(/\s+/)[0] || "session";
  return namePart.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "session";
}

async function resolvePendingFeedback(content: string, rawSessionId?: string): Promise<boolean> {
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
    await persistFeedbackState(sessionId);
    broadcastUiState(sessionId);
    waiter.resolve({ type: "feedback", content });
    logEvent("info", "feedback.delivered.to_waiter", {
      sessionId,
      requestId: waiter.requestId,
      waitId: waiter.waitId,
      waitStartedAt: waiter.startedAt,
      waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
      contentLength: content.length,
    });
    return true;
  }

  state.queuedFeedback = content;
  state.queuedAt = queuedAt;
  await persistFeedbackState(sessionId);
  broadcastUiState(sessionId);
  logEvent("info", "feedback.queued", {
    sessionId,
    queuedAt,
    contentLength: content.length,
  });
  return false;
}

async function clearPendingWaiter(sessionId: string, reason: string, expectedRequestId?: string) {
  const state = feedbackStateBySession.get(sessionId);
  if (!state || !state.pendingWaiter) return;
  const waiter = state.pendingWaiter;
  if (expectedRequestId && waiter.requestId !== expectedRequestId) return;
  state.pendingWaiter = null;
  await persistFeedbackState(sessionId);
  broadcastUiState(sessionId);
  waiter.resolve({ type: "closed", reason });
  logEvent("warn", "feedback.waiter.cleared", {
    sessionId,
    reason,
    requestId: waiter.requestId,
    waitId: waiter.waitId,
    waitStartedAt: waiter.startedAt,
    waitDurationMs: Date.now() - Date.parse(waiter.startedAt),
  });
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
      activeUiSessionId = sessionId;
      await persistActiveUiSession();
      broadcastUiState(sessionId);
      const feedbackState = getFeedbackState(sessionId);
      logEvent("debug", "mcp.tool.call", { tool: name, sessionId });

      switch (name) {
        case "get_feedback": {
          const parsed = GetFeedbackArgsSchema.safeParse(args ?? {});
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
          }

          if (feedbackState.queuedFeedback !== null) {
            const content = feedbackState.queuedFeedback;
            const queuedAt = feedbackState.queuedAt;
            feedbackState.queuedFeedback = null;
            feedbackState.queuedAt = null;
            await persistFeedbackState(sessionId);
            broadcastUiState(sessionId);
            logEvent("info", "feedback.return.queued", {
              sessionId,
              queuedAt,
              queuedDurationMs: queuedAt ? Date.now() - Date.parse(queuedAt) : undefined,
              contentLength: content.length,
            });
            return formatFeedbackResponse(content);
          }

          const waitId = randomUUID();
          const waitStartedAt = new Date().toISOString();
          const requestId = requestContext.getStore()?.requestId ?? randomUUID();
          const feedbackPromise = new Promise<PendingFeedbackResult>((resolve) => {
            feedbackState.pendingWaiter = {
              waitId,
              startedAt: waitStartedAt,
              requestId,
              resolve,
            };
          });
          await persistFeedbackState(sessionId);
          broadcastUiState(sessionId);
          logEvent("info", "feedback.waiting", {
            sessionId,
            requestId,
            waitId,
            waitStartedAt,
            heartbeat,
            timeoutMs: feedbackTimeout,
          });

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
            const timedOutWaiter = feedbackState.pendingWaiter;
            if (timedOutWaiter?.waitId === waitId) {
              feedbackState.pendingWaiter = null;
              await persistFeedbackState(sessionId);
              broadcastUiState(sessionId);
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
            keepalivesSent: keepaliveSentCount,
          });
          return formatFeedbackResponse(result.content);
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
  feedbackApp.use(express.json());
  installDebugHttpLogging(feedbackApp, "ui.http");

  function renderHtml(viewSessionId?: string): string {
    const displaySessionId = viewSessionId || activeUiSessionId;
    const displayAlias = getSessionAlias(displaySessionId);
    const displayLabel = displayAlias ? `${displayAlias} (${displaySessionId})` : displaySessionId;
    return FEEDBACK_HTML
      .replace("ACTIVE_SESSION_INFO", `Active session: ${displayLabel} | Known sessions: ${streamableSessions.size}`);
  }

  feedbackApp.get("/", (_req, res) => {
    res.type("html").send(renderHtml());
  });

  feedbackApp.get("/session/:sessionId", (req, res) => {
    res.type("html").send(renderHtml(req.params.sessionId));
  });

  feedbackApp.get("/events", (req, res) => {
    const targetSessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    const resolvedSessionId = resolveUiSessionTarget(targetSessionId);
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
    const normalizedSessionId = resolveUiSessionTarget(querySession.trim());
    const state = feedbackStateBySession.get(normalizedSessionId);
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
    if (!sessionId || !streamableSessions.has(sessionId)) {
      logEvent("warn", "ui.sessions.active.invalid", { sessionId });
      res.status(400).json({ error: "Unknown sessionId" });
      return;
    }

    activeUiSessionId = sessionId;
    await persistActiveUiSession();
    broadcastUiState(sessionId);
    logEvent("info", "ui.sessions.active.set", { sessionId });
    res.json({
      ok: true,
      defaultUiSessionId: activeUiSessionId,
      activeUiSessionId,
    });
  };

  feedbackApp.post("/sessions/default", setDefaultSessionHandler);
  feedbackApp.post("/sessions/active", setDefaultSessionHandler);

  feedbackApp.post("/sessions/:sessionId/alias", async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!sessionId || !streamableSessions.has(sessionId)) {
      logEvent("warn", "ui.sessions.alias.invalid", { sessionId });
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const alias = normalizeAlias(req.body?.alias);
    if (alias) {
      manualAliasBySession.set(sessionId, alias);
      await sessionStateStore.setManualAlias(sessionId, alias);
      broadcastUiState(sessionId);
      logEvent("info", "ui.sessions.alias.set", { sessionId, alias });
    } else {
      manualAliasBySession.delete(sessionId);
      await sessionStateStore.setManualAlias(sessionId, null);
      broadcastUiState(sessionId);
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
      await clearPendingWaiter(sessionId, "ui_delete");
      streamableSessions.delete(sessionId);
      feedbackStateBySession.delete(sessionId);
      manualAliasBySession.delete(sessionId);
      inferredAliasBySession.delete(sessionId);
      if (activeUiSessionId === sessionId) {
        activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
        await persistActiveUiSession();
      }
      await sessionStateStore.deleteSession(sessionId);
      broadcastUiState();
      logEvent("info", "ui.sessions.delete.ok", { sessionId });
      res.json({ ok: true });
    } catch (error) {
      logEvent("error", "ui.sessions.delete.error", { sessionId, error: String(error) });
      res.status(500).json({ error: String(error) });
    }
  });

  feedbackApp.post("/sessions/prune", async (req, res) => {
    const maxAgeMs = typeof req.body?.maxAgeMs === "number" ? req.body.maxAgeMs : 60 * 60 * 1000;
    const now = Date.now();
    const pruned: string[] = [];
    const errors: string[] = [];

    for (const [sessionId, session] of streamableSessions.entries()) {
      const lastActivity = session.lastActivityAt ? new Date(session.lastActivityAt).getTime() : now;
      const age = now - lastActivity;
      if (age < maxAgeMs) continue;

      try {
        await session.transport.close();
        await clearPendingWaiter(sessionId, "ui_prune");
        streamableSessions.delete(sessionId);
        feedbackStateBySession.delete(sessionId);
        manualAliasBySession.delete(sessionId);
        inferredAliasBySession.delete(sessionId);
        if (activeUiSessionId === sessionId) {
          activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
          await persistActiveUiSession();
        }
        await sessionStateStore.deleteSession(sessionId);
        pruned.push(sessionId);
        logEvent("info", "ui.sessions.prune.ok", { sessionId, ageMs: age });
      } catch (error) {
        errors.push(sessionId);
        logEvent("error", "ui.sessions.prune.error", { sessionId, error: String(error) });
      }
    }

    broadcastUiState();
    res.json({ ok: true, pruned, errors, prunedCount: pruned.length });
  });

  feedbackApp.post("/feedback", async (req, res) => {
    try {
      const content = typeof req.body === "string" ? req.body : req.body.content ?? "";
      const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
      const normalizedSessionId = resolveUiSessionTarget(requestedSessionId);

      const state = getFeedbackState(normalizedSessionId);
      state.latestFeedback = content;
      if (content.trim().length > 0) {
        appendFeedbackHistory(normalizedSessionId, content);
      }
      await persistFeedbackState(normalizedSessionId);
      logEvent("info", "ui.feedback.post", {
        requestedSessionId,
        targetSessionId: normalizedSessionId,
        contentLength: content.length,
      });
      if (content.trim().length > 0) {
        await resolvePendingFeedback(content, normalizedSessionId);
      }
      broadcastUiState(normalizedSessionId);

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

  // Auto-prune very old stale sessions periodically
  setInterval(() => {
    const now = Date.now();
    let pruned = 0;
    for (const [sessionId, state] of feedbackStateBySession.entries()) {
      const meta = sessionStateStore.getSnapshot().sessionMetadataById[sessionId];
      const lastActivity = meta?.lastActivityAt ? new Date(meta.lastActivityAt).getTime() : 0;
      const isWaiting = Boolean(state.pendingWaiter);
      if (!isWaiting && lastActivity > 0 && (now - lastActivity) > AUTO_PRUNE_STALE_THRESHOLD_MS) {
        feedbackStateBySession.delete(sessionId);
        streamableSessions.delete(sessionId);
        sessionStateStore.deleteSession(sessionId);
        pruned++;
        logEvent("info", "session.auto-pruned", { sessionId, inactiveMs: now - lastActivity });
      }
    }
    // Also clean up orphaned persisted sessions that are no longer live
    const persistedSessions = sessionStateStore.getSnapshot().sessionMetadataById;
    for (const [sessionId, meta] of Object.entries(persistedSessions)) {
      if (streamableSessions.has(sessionId)) continue; // still live
      if (feedbackStateBySession.has(sessionId)) continue; // already handled above
      const lastActivity = meta?.lastActivityAt ? new Date(meta.lastActivityAt).getTime() : 0;
      if (lastActivity > 0 && (now - lastActivity) > AUTO_PRUNE_STALE_THRESHOLD_MS) {
        sessionStateStore.deleteSession(sessionId);
        pruned++;
        logEvent("info", "session.auto-pruned.orphaned", { sessionId, inactiveMs: now - lastActivity });
      }
    }
    if (pruned > 0) {
      broadcastUiState();
    }
  }, AUTO_PRUNE_INTERVAL_MS);

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
  await hydratePersistedState();
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
      let resurrectionSessionId: string | undefined;

      if (sessionId) {
        entry = streamableSessions.get(sessionId);
        if (!entry) {
          if (req.method === "DELETE") {
            logEvent("info", "mcp.session.delete.missing", { sessionId });
            res.status(200).json({ jsonrpc: "2.0", result: {}, id: null });
            return;
          }

          // Check for session resurrection: known old session ID + initialize request
          const persistedMeta = sessionStateStore.getSnapshot().sessionMetadataById[sessionId];
          if (req.method === "POST" && isInitializeRequest(req.body) && persistedMeta) {
            resurrectionSessionId = sessionId;
            logEvent("info", "mcp.session.resurrecting", {
              sessionId,
              clientAlias: persistedMeta.clientAlias,
              originalCreatedAt: persistedMeta.createdAt,
            });
            // Fall through to session creation below
          } else if (req.method === "GET" && persistedMeta) {
            // SSE reconnection for a session pending resurrection.
            // Return 503 instead of 404 so the client retries WITHOUT clearing its session ID.
            // (The MCP SDK clears sessionId on 404, preventing header-based resurrection.)
            logEvent("info", "mcp.session.sse.pending_resurrection", { sessionId });
            res.status(503).setHeader("Retry-After", "2").json({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Session is restarting, please retry" },
              id: null,
            });
            return;
          } else {
            logEvent("warn", "mcp.session.invalid", { sessionId, method: req.method });
            res.status(404).json({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: Invalid session ID" },
              id: null,
            });
            return;
          }
        } else {
          entry.lastActivityAt = new Date().toISOString();
          logEvent("debug", "mcp.session.reused", {
            sessionId,
            method: req.method,
            transportId: entry.transportId,
            clientAlias: entry.clientAlias || undefined,
            clientGeneration: entry.clientGeneration ?? undefined,
          });
        }
      }

      if (!entry) {
        if (!resurrectionSessionId && (req.method !== "POST" || !isInitializeRequest(req.body))) {
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
        const transportId = randomUUID();

        // Alias-based resurrection: find most recent orphaned session for this client
        if (!resurrectionSessionId && clientAlias !== "unknown-client") {
          const snapshot = sessionStateStore.getSnapshot();
          let bestCandidate: { sessionId: string; lastActivityAt: number } | undefined;
          for (const [sid, meta] of Object.entries(snapshot.sessionMetadataById)) {
            if (streamableSessions.has(sid)) continue; // still live, skip
            if (meta.clientAlias !== clientAlias) continue; // different client type
            const lastActivity = meta.lastActivityAt ? new Date(meta.lastActivityAt).getTime() : 0;
            if (!bestCandidate || lastActivity > bestCandidate.lastActivityAt) {
              bestCandidate = { sessionId: sid, lastActivityAt: lastActivity };
            }
          }
          if (bestCandidate) {
            resurrectionSessionId = bestCandidate.sessionId;
            logEvent("info", "mcp.session.resurrecting.by_alias", {
              sessionId: resurrectionSessionId,
              clientAlias,
              lastActivityAt: new Date(bestCandidate.lastActivityAt).toISOString(),
            });
          }
        }

        let effectiveGeneration: number;
        let sessionIdGeneratorFn: () => string;

        if (resurrectionSessionId) {
          // Resurrection: reuse old session ID, don't increment generation counter
          const oldMeta = sessionStateStore.getSnapshot().sessionMetadataById[resurrectionSessionId];
          effectiveGeneration = oldMeta?.clientGeneration ?? 0;
          sessionIdGeneratorFn = () => resurrectionSessionId!;
        } else {
          effectiveGeneration = await nextClientGeneration(clientAlias);
          const sessionSlug = slugifyForSessionId(clientAlias);
          sessionIdGeneratorFn = () => `${sessionSlug}-${effectiveGeneration}`;
        }

        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: sessionIdGeneratorFn,
          eventStore: streamEventStore as never,
          retryInterval: STREAM_RETRY_INTERVAL_MS,
          onsessioninitialized: (initializedSessionId) => {
            if (inferredAlias) {
              inferredAliasBySession.set(initializedSessionId, inferredAlias);
              persistAsync("session.persistence.inferred_alias", sessionStateStore.setInferredAlias(initializedSessionId, inferredAlias));
            }
            const sessionEntry: StreamableSessionEntry = {
              transport: createdTransport,
              server: sessionServer,
              transportId,
              clientAlias,
              clientGeneration: effectiveGeneration,
              createdAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            };
            streamableSessions.set(initializedSessionId, sessionEntry);
            broadcastUiState(initializedSessionId);

            if (resurrectionSessionId) {
              // Resurrection: update metadata but skip reassociation (state is already in place)
              persistAsync("session.persistence.resurrected", (async () => {
                await persistSessionMetadata(initializedSessionId, sessionEntry);
                await persistFeedbackState(initializedSessionId);
              })());
              logEvent("info", "mcp.session.resurrected", {
                sessionId: initializedSessionId,
                transportId,
                clientAlias,
                clientGeneration: effectiveGeneration,
                inferredAlias: inferredAlias || undefined,
                activeSessions: streamableSessions.size,
              });
            } else {
              persistAsync("session.persistence.created", (async () => {
                await persistSessionMetadata(initializedSessionId, sessionEntry);
                await persistFeedbackState(initializedSessionId);
                await reassociatePersistedStateForAlias(initializedSessionId, clientAlias);
              })());
              logEvent("info", "mcp.session.created", {
                sessionId: initializedSessionId,
                transportId,
                clientAlias,
                clientGeneration: effectiveGeneration,
                inferredAlias: inferredAlias || undefined,
                activeSessions: streamableSessions.size,
              });
            }
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          persistAsync("session.persistence.stream_closed", clearPendingWaiter(closedSessionId, "stream_closed"));
          broadcastUiState(closedSessionId);
          const closedEntry = streamableSessions.get(closedSessionId);
          // Stream closures can be transient (for example SSE reconnects).
          // Keep session state unless an explicit DELETE/session disconnect occurs.
          logEvent("warn", "mcp.session.stream.closed", {
            sessionId: closedSessionId,
            transportId: closedEntry?.transportId ?? transportId,
            clientAlias: closedEntry?.clientAlias || clientAlias,
            clientGeneration: closedEntry?.clientGeneration ?? effectiveGeneration,
            activeSessions: streamableSessions.size,
          });
        };

        await sessionServer.connect(createdTransport);
        entry = {
          transport: createdTransport,
          server: sessionServer,
          transportId,
          clientAlias,
          clientGeneration: effectiveGeneration,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
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
        await entry.transport.handleRequest(req, res, req.body);
      });
      await persistSessionMetadata(sessionId || entry.transport.sessionId || DEFAULT_FEEDBACK_SESSION, entry);

      if (req.method === "DELETE" && sessionId) {
        await clearPendingWaiter(sessionId, "explicit_delete");
        streamableSessions.delete(sessionId);
        feedbackStateBySession.delete(sessionId);
        manualAliasBySession.delete(sessionId);
        inferredAliasBySession.delete(sessionId);
        if (activeUiSessionId === sessionId) {
          activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
          await persistActiveUiSession();
        }
        await sessionStateStore.deleteSession(sessionId);
        broadcastUiState();
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
