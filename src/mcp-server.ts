import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import express from "express";
import type { ChannelManager } from "./channels.js";
import { registerFeedbackHandlers } from "./feedback-handler.js";
import {
  installDebugHttpLogging,
  logEvent,
} from "./logging.js";
import type {
  SessionManager,
  StreamableSessionEntry,
} from "./session-manager.js";
import type { InMemoryStreamEventStore } from "./stream-event-store.js";
import {
  inferAliasFromInitializeBody,
  slugifyForSessionId,
  SERVER_VERSION,
} from "./utils.js";

const STREAM_RETRY_INTERVAL_MS = 2000;

type RequestContextStore = {
  requestId: string;
  res?: express.Response;
};

type StartMcpServerOptions = {
  mcpPort: number;
  noUI: boolean;
  uiPort: number;
  heartbeat: boolean;
  feedbackTimeout: number;
  keepaliveIntervalMs: number;
  logLevel: string;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  streamEventStore: InMemoryStreamEventStore;
  getSessionId(rawSessionId?: string): string;
};

function persistAsync(task: string, work: Promise<void>) {
  void work.catch((error) => {
    logEvent("error", task, { error: String(error) });
  });
}

async function clearPendingWaiter(
  sessionManager: SessionManager,
  sessionId: string,
  reason: string,
  expectedRequestId?: string
) {
  await sessionManager.clearPendingWaiter(sessionId, reason, expectedRequestId);
}

function attachPendingWaiterCleanup(
  sessionManager: SessionManager,
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
      clearPendingWaiter(sessionManager, sessionId, reason, requestId)
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

function createSessionServer(
  sessionManager: SessionManager,
  channelManager: ChannelManager,
  heartbeat: boolean,
  feedbackTimeout: number,
  keepaliveIntervalMs: number,
  requestContext: AsyncLocalStorage<RequestContextStore>,
  getSessionId: (rawSessionId?: string) => string
): Server {
  const sessionServer = new Server(
    { name: "tasksync-server", version: SERVER_VERSION },
    { capabilities: { tools: {}, logging: {} } }
  );

  registerFeedbackHandlers(sessionServer, {
    sessionManager,
    channelManager,
    heartbeat,
    feedbackTimeout,
    keepaliveIntervalMs,
    requestContext,
    getSessionId,
    setActiveUiSessionId: sessionManager.setActiveUiSession.bind(sessionManager),
    getFeedbackState: sessionManager.getFeedbackState.bind(sessionManager),
    markSessionActivity: sessionManager.markActivity.bind(sessionManager),
  });

  return sessionServer;
}

export function startMcpServer({
  mcpPort,
  noUI,
  uiPort,
  heartbeat,
  feedbackTimeout,
  keepaliveIntervalMs,
  logLevel,
  sessionManager,
  channelManager,
  streamEventStore,
  getSessionId,
}: StartMcpServerOptions): void {
  const requestContext = new AsyncLocalStorage<RequestContextStore>();
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
        entry = sessionManager.getSession(sessionId);
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
        sessionManager.markReconnected(sessionId);
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

        const sessionServer = createSessionServer(
          sessionManager,
          channelManager,
          heartbeat,
          feedbackTimeout,
          keepaliveIntervalMs,
          requestContext,
          getSessionId
        );
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
              activeSessions: sessionManager.getAllSessions().size,
            });
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          persistAsync(
            "session.persistence.stream_closed",
            clearPendingWaiter(sessionManager, closedSessionId, "stream_closed")
          );
          sessionManager.markDisconnected(closedSessionId, "stream_closed");
          const closedEntry = sessionManager.getSession(closedSessionId);
          logEvent("warn", "mcp.session.stream.closed", {
            sessionId: closedSessionId,
            transportId: closedEntry?.transportId ?? transportId,
            clientAlias: closedEntry?.clientAlias || clientAlias,
            clientGeneration: closedEntry?.clientGeneration ?? clientGeneration,
            activeSessions: sessionManager.getAllSessions().size,
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
          disconnectedAt: null,
          status: "active",
        };
      }

      if (!entry) {
        throw new Error("No session entry available to handle MCP request");
      }

      const requestId = randomUUID();
      if (sessionId) {
        attachPendingWaiterCleanup(sessionManager, req, res, sessionId, requestId);
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
          activeSessions: sessionManager.getAllSessions().size,
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
      version: SERVER_VERSION,
      transport: "streamable-http",
      sessions: sessionManager.getAllSessions().size,
      persistence: "file-backed minimal session state; transient in-memory replay",
    });
  });

  app.listen(mcpPort, () => {
    logEvent("info", "server.started", {
      version: SERVER_VERSION,
      mcpPort,
      uiEnabled: !noUI,
      uiPort,
      heartbeat,
      timeoutMs: feedbackTimeout,
      keepaliveIntervalMs,
      logLevel,
    });
    console.error(`TaskSync MCP Server v${SERVER_VERSION} running on Streamable HTTP at http://localhost:${mcpPort}`);
    console.error(`MCP endpoint: http://localhost:${mcpPort}/mcp`);
    console.error(`Health check: http://localhost:${mcpPort}/health`);
  });
}
