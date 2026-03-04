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

const DEFAULT_FEEDBACK_SESSION = "__default__";

type FeedbackChannelState = {
  pendingFeedbackResolve: ((content: string) => void) | null;
  queuedFeedback: string | null;
  latestFeedback: string;
};

type StreamableSessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: Server;
  createdAt: string;
  lastActivityAt: string;
};

const feedbackStateBySession = new Map<string, FeedbackChannelState>();
const streamableSessions = new Map<string, StreamableSessionEntry>();
let activeUiSessionId = DEFAULT_FEEDBACK_SESSION;

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
    pendingFeedbackResolve: null,
    queuedFeedback: null,
    latestFeedback: "",
  };
  feedbackStateBySession.set(sessionId, created);
  return created;
}

function formatResponseWithHeadTail(content: string, head?: number, tail?: number): { content: { type: "text"; text: string }[] } {
  if (head && tail) {
    throw new Error("Cannot specify both head and tail parameters simultaneously");
  }

  const lines = content.split("\n");
  const selected = tail ? lines.slice(-tail) : head ? lines.slice(0, head) : lines;
  return { content: [{ type: "text", text: selected.join("\n") }] };
}

function resolvePendingFeedback(content: string, rawSessionId?: string): boolean {
  const sessionId = getSessionId(rawSessionId);
  const state = getFeedbackState(sessionId);
  state.latestFeedback = content;

  if (state.pendingFeedbackResolve) {
    const resolve = state.pendingFeedbackResolve;
    state.pendingFeedbackResolve = null;
    resolve(content);
    return true;
  }

  state.queuedFeedback = content;
  return false;
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

      switch (name) {
        case "get_feedback": {
          const parsed = AskReviewArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
          }

          if (feedbackState.queuedFeedback !== null) {
            const content = feedbackState.queuedFeedback;
            feedbackState.queuedFeedback = null;
            return formatResponseWithHeadTail(content, parsed.data.head, parsed.data.tail);
          }

          const feedbackPromise = new Promise<string>((resolve) => {
            feedbackState.pendingFeedbackResolve = resolve;
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
            feedbackState.pendingFeedbackResolve = null;
            return {
              content: [{ type: "text", text: "[WAITING] No new feedback yet. Call get_feedback again to continue waiting." }],
            };
          }

          return formatResponseWithHeadTail(result, parsed.data.head, parsed.data.tail);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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

  const html = FEEDBACK_HTML.replace("FEEDBACK_PATH", "in-memory feedback queue (non-persistent)");

  feedbackApp.get("/", (_req, res) => {
    res.type("html").send(html);
  });

  feedbackApp.get("/session/:sessionId", (_req, res) => {
    res.type("html").send(html);
  });

  feedbackApp.get("/feedback", (req, res) => {
    const querySession = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    const targetSessionId = querySession.trim() || activeUiSessionId;
    const state = getFeedbackState(getSessionId(targetSessionId));
    res.type("text").send(state.latestFeedback || "");
  });

  feedbackApp.get("/sessions", (_req, res) => {
    const sessions = Array.from(streamableSessions.entries()).map(([sessionId, entry]) => {
      const state = getFeedbackState(sessionId);
      return {
        sessionId,
        sessionUrl: `${uiBaseUrl}/session/${encodeURIComponent(sessionId)}`,
        createdAt: entry.createdAt,
        lastActivityAt: entry.lastActivityAt,
        waitingForFeedback: Boolean(state.pendingFeedbackResolve),
        hasQueuedFeedback: Boolean(state.queuedFeedback),
      };
    });

    res.json({ activeUiSessionId, sessions });
  });

  feedbackApp.post("/sessions/active", (req, res) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
    if (!sessionId || !streamableSessions.has(sessionId)) {
      res.status(400).json({ error: "Unknown sessionId" });
      return;
    }

    activeUiSessionId = sessionId;
    res.json({ ok: true, activeUiSessionId });
  });

  feedbackApp.delete("/sessions/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = streamableSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    try {
      await session.transport.close();
      streamableSessions.delete(sessionId);
      feedbackStateBySession.delete(sessionId);
      if (activeUiSessionId === sessionId) {
        activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
      }
      res.json({ ok: true });
    } catch (error) {
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
      if (content.trim().length > 0) {
        resolvePendingFeedback(content, normalizedSessionId);
      }

      res.json({ ok: true, sessionId: normalizedSessionId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  feedbackApp.listen(uiPort, () => {
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
      const rawSessionId = req.headers["mcp-session-id"];
      const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
      let entry: StreamableSessionEntry | undefined;

      if (sessionId) {
        entry = streamableSessions.get(sessionId);
        if (!entry) {
          res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: Invalid session ID" },
            id: null,
          });
          return;
        }
        entry.lastActivityAt = new Date().toISOString();
      } else {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null,
          });
          return;
        }

        const sessionServer = createSessionServer();
        let createdTransport: StreamableHTTPServerTransport;
        createdTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            streamableSessions.set(initializedSessionId, {
              transport: createdTransport,
              server: sessionServer,
              createdAt: new Date().toISOString(),
              lastActivityAt: new Date().toISOString(),
            });
          },
        });

        createdTransport.onclose = () => {
          const closedSessionId = createdTransport.sessionId;
          if (!closedSessionId) return;
          streamableSessions.delete(closedSessionId);
          feedbackStateBySession.delete(closedSessionId);
          if (activeUiSessionId === closedSessionId) {
            activeUiSessionId = DEFAULT_FEEDBACK_SESSION;
          }
        };

        await sessionServer.connect(createdTransport);
        entry = {
          transport: createdTransport,
          server: sessionServer,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        };
      }

      await entry.transport.handleRequest(req, res, req.body);
    } catch (error) {
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

  console.error("\nShutting down server...");
  for (const [sessionId, session] of streamableSessions.entries()) {
    session.transport.close().catch(() => {
      /* best-effort shutdown */
    });
    streamableSessions.delete(sessionId);
    feedbackStateBySession.delete(sessionId);
  }
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
