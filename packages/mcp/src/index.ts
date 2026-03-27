#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import express from "express";

import {
  SessionManager,
  SessionStateStore,
  FeedbackUIServer,
  createLogger,
  formatFeedbackResponse,
  normalizeAlias,
  DEFAULT_SESSION_ID,
  DEFAULT_DISCONNECT_AFTER_MINUTES,
  type FeedbackChannelState,
  type SessionEntry,
  type PendingFeedbackResult,
  type PendingWaiter,
  type ImageAttachment,
  type Logger,
  type LogLevel,
} from "@tasksync/core";

import { InMemoryStreamEventStore } from "./stream-event-store.js";

// ---------------------------------------------------------------------------
// CLI Arguments & Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 3_600_000; // 1 hour safety-net timeout

const args = process.argv.slice(2);
const noUI = args.includes("--no-ui");
const mcpPort = parseInt(
  args.find((arg) => arg.startsWith("--port="))?.split("=")[1] || "3011",
  10,
);
const uiPortArg = args.find((arg) => arg.startsWith("--ui-port="));
const uiPort = parseInt(
  uiPortArg?.split("=")[1] || process.env.FEEDBACK_PORT || "3456",
  10,
);
const heartbeat = args.includes("--heartbeat");
const timeoutArg = args.find((arg) => arg.startsWith("--timeout="));
const parsedTimeout = timeoutArg
  ? parseInt(timeoutArg.split("=")[1], 10)
  : NaN;
const feedbackTimeout = heartbeat
  ? Number.isNaN(parsedTimeout)
    ? DEFAULT_TIMEOUT
    : parsedTimeout
  : 0;
const logLevel = (process.env.TASKSYNC_LOG_LEVEL || "info").toLowerCase();
const logFilePath = process.env.TASKSYNC_LOG_FILE?.trim() || "";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STREAM_RETRY_INTERVAL_MS = 2000;
const KEEPALIVE_INTERVAL_MS = 30_000;
const DEBUG_BODY_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// Logging (extends core Logger with MCP-specific debug features)
// ---------------------------------------------------------------------------

const logger = createLogger({ level: logLevel as LogLevel | undefined, filePath: logFilePath, prefix: "tasksync" });

function logEvent(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
) {
  logger.log(level, event, details);
}

async function appendLogLine(line: string) {
  if (!logFilePath) return;
  await mkdir(path.dirname(logFilePath), { recursive: true });
  await appendFile(logFilePath, `${line}\n`, "utf8");
}

function logDebugPretty(label: string, payload: unknown) {
  if (logLevel !== "debug") return;
  const formatted =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const line = `[tasksync][debug] ${label}\n${formatted}`;
  console.error(line);
  if (logFilePath) {
    void appendLogLine(line);
  }
}

// ---------------------------------------------------------------------------
// MCP-specific debug helpers
// ---------------------------------------------------------------------------

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
        const field =
          separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
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
    .filter(
      (event): event is Record<string, unknown> => event !== null,
    );

  if (events.length === 0) return text;
  return { sseEvents: events };
}

function normalizeDebugBody(body: unknown, contentType?: string): unknown {
  if (Buffer.isBuffer(body))
    return normalizeDebugBody(body.toString("utf8"), contentType);
  if (body instanceof Uint8Array)
    return normalizeDebugBody(
      Buffer.from(body).toString("utf8"),
      contentType,
    );
  if (
    Array.isArray(body) &&
    body.every((item) => typeof item === "number")
  )
    return normalizeDebugBody(
      Buffer.from(body).toString("utf8"),
      contentType,
    );
  if (typeof body === "string") {
    if (contentType?.includes("text/html"))
      return `[HTML content omitted, ${body.length} chars]`;
    if (contentType?.includes("text/event-stream"))
      return parseSseDebugBody(body);
    if (body.length > DEBUG_BODY_MAX_CHARS)
      return maybeParseJson(
        body.slice(0, DEBUG_BODY_MAX_CHARS) +
          `... [truncated, ${body.length} total chars]`,
      );
    return maybeParseJson(body);
  }
  if (body === undefined) return null;
  return body;
}

function extractMcpDebugMeta(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};

  const record = body as Record<string, unknown>;
  const method =
    typeof record.method === "string" ? record.method : undefined;
  const id =
    typeof record.id === "string" || typeof record.id === "number"
      ? record.id
      : undefined;
  const params =
    record.params &&
    typeof record.params === "object" &&
    !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : undefined;
  const result =
    record.result &&
    typeof record.result === "object" &&
    !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : undefined;

  const meta: Record<string, unknown> = {};
  if (id !== undefined) meta.jsonRpcId = id;
  if (method) {
    meta.mcpMethod = method;
    if (method === "tools/call") {
      const toolName =
        typeof params?.name === "string" ? params.name : undefined;
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

function installDebugHttpLogging(app: express.Express, scope: string) {
  app.use((req, res, next) => {
    if (logLevel !== "debug") {
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
      if (
        Array.isArray(chunk) &&
        chunk.every((item) => typeof item === "number")
      )
        return Buffer.from(chunk);
      return Buffer.from(String(chunk), "utf8");
    }

    function shouldCapture(chunk: Buffer): boolean {
      const text = chunk.toString("utf8");
      if (text === ": keepalive\n\n") return false;
      if (totalResponseBytes >= MAX_RESPONSE_LOG_BYTES) return false;
      return true;
    }

    res.write = ((chunk: unknown, ...writeArgs: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk && shouldCapture(loggedChunk)) {
        responseChunks.push(loggedChunk);
        totalResponseBytes += loggedChunk.length;
      }
      return originalWrite(
        chunk as never,
        ...(writeArgs as Parameters<typeof originalWrite> extends [
          unknown,
          ...infer Rest,
        ]
          ? Rest
          : never),
      );
    }) as typeof res.write;

    res.end = ((chunk?: unknown, ...endArgs: unknown[]) => {
      const loggedChunk = toLoggedBuffer(chunk);
      if (loggedChunk) responseChunks.push(loggedChunk);
      return originalEnd(
        chunk as never,
        ...(endArgs as Parameters<typeof originalEnd> extends [
          unknown?,
          ...infer Rest,
        ]
          ? Rest
          : never),
      );
    }) as typeof res.end;

    logDebugPretty(`${scope}.request`, {
      requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      ...extractMcpDebugMeta(
        normalizeDebugBody(
          req.body,
          String(req.headers["content-type"] || ""),
        ),
      ),
      body: normalizeDebugBody(
        req.body,
        String(req.headers["content-type"] || ""),
      ),
    });

    res.on("finish", () => {
      const rawBody = Buffer.concat(responseChunks).toString("utf8");
      const responseContentType = String(
        res.getHeader("content-type") || "",
      );
      const normalizedResponseBody = normalizeDebugBody(
        rawBody,
        responseContentType,
      );
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

// ---------------------------------------------------------------------------
// MCP-specific types and state
// ---------------------------------------------------------------------------

type McpSessionInfo = {
  transport: StreamableHTTPServerTransport;
  server: Server;
};

const GetFeedbackArgsSchema = z.object({}).strict();

type ToolInput = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

const sessionStateStore = new SessionStateStore();
const streamEventStore = new InMemoryStreamEventStore();
const requestContext = new AsyncLocalStorage<{
  requestId: string;
  res?: express.Response;
}>();

/** MCP transport/server map — tracks MCP-specific objects per session */
const mcpSessions = new Map<string, McpSessionInfo>();

let sessionManager: SessionManager;
let uiServer: FeedbackUIServer | undefined;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function getSessionId(rawSessionId?: string): string {
  return rawSessionId && rawSessionId.trim().length > 0
    ? rawSessionId
    : DEFAULT_SESSION_ID;
}

function persistAsync(task: string, work: Promise<void>) {
  void work.catch((error) => {
    logEvent("error", task, { error: String(error) });
  });
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

function slugifyForSessionId(clientAlias: string): string {
  const namePart = clientAlias.split(/\s+/)[0] || "session";
  return (
    namePart
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "session"
  );
}

// ---------------------------------------------------------------------------
// MCP Tool Handler Registration
// ---------------------------------------------------------------------------

function registerServerHandlers(targetServer: Server) {
  targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_feedback",
          description:
            "Wait for human feedback for the current session. " +
            "This call blocks until feedback is submitted from the TaskSync UI or timeout is reached.",
          inputSchema: zodToJsonSchema(GetFeedbackArgsSchema, {
            target: "openApi3",
          }) as ToolInput,
        },
      ],
    };
  });

  targetServer.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra) => {
      let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
      try {
        const { name, arguments: toolArgs } = request.params;
        const sessionId = getSessionId(extra?.sessionId);
        await sessionManager.setActiveUiSession(sessionId);
        logEvent("debug", "mcp.tool.call", { tool: name, sessionId });

        switch (name) {
          case "get_feedback": {
            const parsed = GetFeedbackArgsSchema.safeParse(toolArgs ?? {});
            if (!parsed.success) {
              throw new Error(
                `Invalid arguments for get_feedback: ${parsed.error}`,
              );
            }

            sessionManager.markActivity(sessionId, "get_feedback");

            // Check for queued feedback first
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
            const requestId =
              requestContext.getStore()?.requestId ?? randomUUID();
            const feedbackPromise = new Promise<PendingFeedbackResult>(
              (resolve) => {
                sessionManager.setWaiter(sessionId, {
                  waitId,
                  startedAt: waitStartedAt,
                  requestId,
                  resolve,
                });
              },
            );
            logEvent("info", "feedback.waiting", {
              sessionId,
              requestId,
              waitId,
              waitStartedAt,
              heartbeat,
              timeoutMs: feedbackTimeout,
            });

            // --- SSE keepalive ---
            const httpRes = requestContext.getStore()?.res;
            let keepaliveSentCount = 0;
            const clearKeepalive = (reason: string) => {
              if (keepaliveInterval) {
                clearInterval(keepaliveInterval);
                keepaliveInterval = null;
                logEvent("debug", "feedback.keepalive.stopped", {
                  sessionId,
                  requestId,
                  waitId,
                  reason,
                  totalSent: keepaliveSentCount,
                });
              }
            };
            if (httpRes && !httpRes.writableEnded) {
              logEvent("debug", "feedback.keepalive.started", {
                sessionId,
                requestId,
                waitId,
                intervalMs: KEEPALIVE_INTERVAL_MS,
              });
              keepaliveInterval = setInterval(() => {
                if (!httpRes.writableEnded) {
                  try {
                    httpRes.write(": keepalive\n\n");
                    keepaliveSentCount++;
                    if (keepaliveSentCount % 10 === 0) {
                      logEvent("debug", "feedback.keepalive.sent", {
                        sessionId,
                        requestId,
                        waitId,
                        count: keepaliveSentCount,
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
                setTimeout(() => resolve(null), feedbackTimeout),
              );
              result = await Promise.race([feedbackPromise, timeoutPromise]);
            } else {
              result = await feedbackPromise;
            }

            if (result === null) {
              clearKeepalive("timeout");
              if (sessionManager.isWaiting(sessionId)) {
                await sessionManager.clearPendingWaiter(
                  sessionId,
                  "timeout",
                  requestId,
                );
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
                content: [
                  {
                    type: "text",
                    text: "[WAITING] No new feedback yet. Call get_feedback again to continue waiting.",
                  },
                ],
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
                content: [
                  {
                    type: "text",
                    text: "[WAITING] Feedback wait interrupted. Call get_feedback again to continue waiting.",
                  },
                ],
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
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = null;
        }
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logEvent("error", "mcp.tool.error", { error: errorMessage });
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    },
  );

  targetServer.oninitialized = async () => {
    // Intentionally no MCP roots/path handling in feedback-only mode.
  };
}

// ---------------------------------------------------------------------------
// Waiter cleanup on request abort/close
// ---------------------------------------------------------------------------

function attachPendingWaiterCleanup(
  req: express.Request,
  res: express.Response,
  sessionId: string,
  requestId: string,
) {
  let handled = false;

  const clearIfOwned = (reason: string) => {
    if (handled) return;
    handled = true;
    persistAsync(
      "session.persistence.request_closed",
      sessionManager.clearPendingWaiter(sessionId, reason, requestId),
    );
  };

  req.once("aborted", () => {
    logEvent("warn", "mcp.request.aborted", {
      sessionId,
      requestId,
      method: req.method,
    });
    clearIfOwned("request_aborted");
  });

  res.once("close", () => {
    logEvent("debug", "mcp.request.closed", {
      sessionId,
      requestId,
      method: req.method,
      writableEnded: res.writableEnded,
    });
    clearIfOwned(
      res.writableEnded ? "response_closed" : "response_disconnected",
    );
  });
}

// ---------------------------------------------------------------------------
// MCP Session Server Factory
// ---------------------------------------------------------------------------

function createSessionServer(): Server {
  const sessionServer = new Server(
    { name: "tasksync-server", version: "1.0.0" },
    { capabilities: { tools: {}, logging: {} } },
  );
  registerServerHandlers(sessionServer);
  return sessionServer;
}

// ---------------------------------------------------------------------------
// Main Server
// ---------------------------------------------------------------------------

async function runStreamableHTTPServer() {
  // Initialize SessionManager
  sessionManager = new SessionManager(sessionStateStore, {
    onStateChange: (sessionId?: string) => {
      uiServer?.broadcastState(sessionId);
    },
    onLog: (level, event, details) => {
      logEvent(level, event, details);
    },
  });
  await sessionManager.initialize();

  // MCP Express app
  const app = express();

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, last-event-id",
    );
    res.header("Access-Control-Expose-Headers", "mcp-session-id");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json());
  installDebugHttpLogging(app, "mcp.http");

  // ---- MCP request handler ----
  const mcpHandler = async (
    req: express.Request,
    res: express.Response,
  ) => {
    try {
      logEvent("debug", "mcp.request", {
        method: req.method,
        path: req.path,
        hasSessionHeader:
          typeof req.headers["mcp-session-id"] === "string",
      });
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId =
        typeof rawSessionId === "string" ? rawSessionId : undefined;

      let mcpSession: McpSessionInfo | undefined;

      if (sessionId) {
        // Existing session — look up transport
        if (!sessionManager.hasSession(sessionId)) {
          logEvent("warn", "mcp.session.invalid", {
            sessionId,
            method: req.method,
          });
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found" },
            id: null,
          });
          return;
        }
        mcpSession = mcpSessions.get(sessionId);
        if (!mcpSession) {
          logEvent("warn", "mcp.session.transport_missing", {
            sessionId,
            method: req.method,
          });
          res.status(404).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Session transport not found",
            },
            id: null,
          });
          return;
        }

        const entry = sessionManager.getSession(sessionId);
        logEvent("debug", "mcp.session.reused", {
          sessionId,
          method: req.method,
          transportId: entry?.transportId,
          clientAlias: entry?.clientAlias || undefined,
          clientGeneration: entry?.clientGeneration ?? undefined,
        });
      } else {
        // New session — must be initialize request
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          logEvent("warn", "mcp.session.missing", {
            method: req.method,
          });
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided",
            },
            id: null,
          });
          return;
        }

        const sessionServer = createSessionServer();
        const inferredAlias =
          inferAliasFromInitializeBody(req.body);
        const clientAlias = inferredAlias || "unknown-client";
        const clientGeneration =
          sessionManager.getNextClientGeneration(clientAlias);
        const sessionSlug = slugifyForSessionId(clientAlias);
        const transportId = randomUUID();

        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () =>
            `${sessionSlug}-${clientGeneration}`,
          eventStore: streamEventStore as never,
          retryInterval: STREAM_RETRY_INTERVAL_MS,
          onsessioninitialized: (initializedSessionId) => {
            if (inferredAlias) {
              sessionManager.setInferredAlias(
                initializedSessionId,
                inferredAlias,
              );
            }
            // Register session in core SessionManager
            sessionManager.createSession(
              initializedSessionId,
              transportId,
              clientAlias,
              clientGeneration,
              async () => {
                await createdTransport.close();
              },
            );
            // Track MCP-specific objects separately
            mcpSessions.set(initializedSessionId, {
              transport: createdTransport,
              server: sessionServer,
            });

            logEvent("info", "mcp.session.created", {
              sessionId: initializedSessionId,
              transportId,
              clientAlias,
              clientGeneration,
              inferredAlias: inferredAlias || undefined,
              activeSessions:
                sessionManager.getAllSessions().size,
            });
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          persistAsync(
            "session.persistence.stream_closed",
            sessionManager.clearPendingWaiter(
              closedSessionId,
              "stream_closed",
            ),
          );
          const closedEntry =
            sessionManager.getSession(closedSessionId);
          logEvent("warn", "mcp.session.stream.closed", {
            sessionId: closedSessionId,
            transportId:
              closedEntry?.transportId ?? transportId,
            clientAlias:
              closedEntry?.clientAlias || clientAlias,
            clientGeneration:
              closedEntry?.clientGeneration ??
              clientGeneration,
            activeSessions:
              sessionManager.getAllSessions().size,
          });
        };

        await sessionServer.connect(createdTransport);
        mcpSession = {
          transport: createdTransport,
          server: sessionServer,
        };
      }

      if (!mcpSession) {
        throw new Error(
          "No session transport available to handle MCP request",
        );
      }

      const requestId = randomUUID();
      if (sessionId) {
        attachPendingWaiterCleanup(req, res, sessionId, requestId);
      }

      await requestContext.run({ requestId, res }, async () => {
        await mcpSession.transport.handleRequest(
          req,
          res,
          req.body,
        );
      });

      if (req.method === "DELETE" && sessionId) {
        mcpSessions.delete(sessionId);
        await sessionManager.deleteSession(
          sessionId,
          "explicit_delete",
        );
        logEvent("info", "mcp.session.closed", {
          sessionId,
          reason: "explicit_delete",
          activeSessions: sessionManager.getAllSessions().size,
        });
      }
    } catch (error) {
      logEvent("error", "mcp.request.error", {
        error: String(error),
      });
      console.error(
        "Error handling streamable HTTP MCP request:",
        error,
      );
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
      sessions: sessionManager.getAllSessions().size,
      persistence:
        "file-backed minimal session state; transient in-memory replay",
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
    console.error(
      `TaskSync MCP Server running on Streamable HTTP at http://localhost:${mcpPort}`,
    );
    console.error(`MCP endpoint: http://localhost:${mcpPort}/mcp`);
    console.error(`Health check: http://localhost:${mcpPort}/health`);
  });

  // Start Feedback UI
  if (!noUI) {
    uiServer = new FeedbackUIServer(sessionManager, logger, {
      port: uiPort,
      openBrowser: true,
    });
    installDebugHttpLogging(uiServer.app, "ui.http");
    await uiServer.start();
  }
}

// ---------------------------------------------------------------------------
// Cleanup & Shutdown
// ---------------------------------------------------------------------------

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  logEvent("info", "server.cleanup.start", {
    activeSessions: sessionManager?.getAllSessions().size ?? 0,
  });
  console.error("\nShutting down server...");

  sessionManager?.shutdown();

  // Close all MCP transports
  for (const [sessionId, mcp] of mcpSessions.entries()) {
    mcp.transport.close().catch(() => {
      /* best-effort shutdown */
    });
  }
  mcpSessions.clear();

  // Stop UI server
  uiServer?.stop().catch(() => {
    /* best-effort shutdown */
  });

  logEvent("info", "server.cleanup.done", {
    activeSessions: sessionManager?.getAllSessions().size ?? 0,
  });
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
