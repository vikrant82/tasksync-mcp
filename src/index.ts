#!/usr/bin/env node

import "dotenv/config";

import { SessionStateStore } from "./session-state-store.js";
import { InMemoryStreamEventStore } from "./stream-event-store.js";
import { SessionManager } from "./session-manager.js";
import { ChannelManager, type ChannelManagerConfig } from "./channels.js";
import { startMcpServer } from "./mcp-server.js";
import { startUiServer, type UiServerHandle } from "./ui-server.js";
import {
  configureLogging,
  logEvent,
} from "./logging.js";
import {
  normalizeAlias,
} from "./utils.js";

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
configureLogging({ logLevel, logFilePath });

// Channel config — Telegram bot token from env or CLI
const telegramBotToken = process.env.TASKSYNC_TELEGRAM_BOT_TOKEN?.trim()
  || args.find((arg) => arg.startsWith("--telegram-token="))?.split("=")[1]?.trim()
  || "";
const telegramAllowedChatIds = (process.env.TASKSYNC_TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));

const DEFAULT_FEEDBACK_SESSION = "__default__";
const KEEPALIVE_INTERVAL_MS = 30000; // 30s SSE comment keepalive to prevent HTTP connection timeout

const sessionStateStore = new SessionStateStore();
const streamEventStore = new InMemoryStreamEventStore();

// Session Manager - single source of truth for session state
let sessionManager: SessionManager;

// Channel Manager - notification channels (Telegram, etc.)
let channelManager: ChannelManager = new ChannelManager(logEvent);
let uiServer: UiServerHandle | null = null;

function getSessionId(rawSessionId?: string): string {
  return rawSessionId && rawSessionId.trim().length > 0 ? rawSessionId : DEFAULT_FEEDBACK_SESSION;
}

async function runStreamableHTTPServer() {
  // Initialize SessionManager - this is the single source of truth for session state
  sessionManager = new SessionManager(sessionStateStore, {
    onStateChange: (sessionId?: string) => {
      uiServer?.broadcastState(sessionId);
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
  channelManager.onFeedback((sessionId, content, images) => {
    sessionManager.deliverFeedback(getSessionId(sessionId), content, images).catch((err) => {
      logEvent("error", "channels.feedback.delivery_error", { sessionId, error: String(err) });
    });
  });

  startMcpServer({
    mcpPort,
    noUI,
    uiPort,
    heartbeat,
    feedbackTimeout,
    keepaliveIntervalMs: KEEPALIVE_INTERVAL_MS,
    logLevel,
    sessionManager,
    channelManager,
    streamEventStore,
    getSessionId,
  });

  if (!noUI) {
    uiServer = startUiServer({
      uiPort,
      sessionManager,
      channelManager,
      logEvent,
      normalizeAlias,
    });
  }
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;

  logEvent("info", "server.cleanup.start", { activeSessions: sessionManager.getAllSessions().size });
  console.error("\nShutting down server...");

  uiServer?.shutdown();

  // Shutdown SessionManager (clears auto-prune interval)
  sessionManager.shutdown();

  // Shutdown notification channels (stops Telegram polling)
  channelManager.shutdown().catch(() => { /* best-effort */ });
  
  // Close all active sessions
  for (const [, session] of sessionManager.getAllSessions().entries()) {
    session.transport?.close().catch(() => {
      /* best-effort shutdown */
    });
  }
  logEvent("info", "server.cleanup.done", { activeSessions: sessionManager.getAllSessions().size });
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
