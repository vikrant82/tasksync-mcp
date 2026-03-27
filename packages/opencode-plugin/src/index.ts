import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
  SessionManager,
  SessionStateStore,
  FeedbackUIServer,
  createLogger,
  type Logger,
  type PendingFeedbackResult,
} from "@tasksync/core";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { DAEMON_AGENT_PROMPT } from "./daemon-prompt.js";
import { DAEMON_OVERLAY_FULL } from "./daemon-overlay.js";
import { DAEMON_OVERLAY_COMPACT } from "./daemon-overlay-compact.js";
import { loadConfig, type TaskSyncPluginConfig } from "./config.js";

/**
 * Module-level singleton state.
 *
 * OpenCode loads the plugin once per project directory. Because the
 * SessionManager is already multi-session aware, a single shared
 * instance serves all projects — matching the MCP server's "one
 * server, many clients" model. The first plugin load initialises the
 * shared state; subsequent loads reuse it.
 */
let sharedLogger: Logger | undefined;
let sharedSessionManager: SessionManager | undefined;
let sharedUIServer: FeedbackUIServer | undefined;
let initPromise: Promise<void> | undefined;

async function ensureSharedInit(config: TaskSyncPluginConfig): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = doSharedInit(config);
  return initPromise;
}

async function doSharedInit(config: TaskSyncPluginConfig): Promise<void> {
  sharedLogger = createLogger({
    level: config.logLevel,
    filePath: config.logFile,
  });

  const globalStateDir = path.join(os.homedir(), ".tasksync");
  const stateStore = new SessionStateStore(
    path.join(globalStateDir, "session-state.json"),
  );

  sharedSessionManager = new SessionManager(stateStore, {
    onStateChange: () => sharedUIServer?.broadcastState(),
    onLog: (level, event, details) => sharedLogger!.log(level, event, details),
  });
  await sharedSessionManager.initialize();

  sharedUIServer = new FeedbackUIServer(sharedSessionManager, sharedLogger, {
    port: config.uiPort,
    openBrowser: config.openBrowser,
  });
  try {
    await sharedUIServer.start();
  } catch (err) {
    sharedLogger.log("warn", "plugin.ui_server_failed", {
      error: err instanceof Error ? err.message : String(err),
      port: config.uiPort,
    });
    sharedUIServer = undefined;
  }
}

const plugin: Plugin = async ({ directory }) => {
  const config = loadConfig(directory);

  await ensureSharedInit(config);

  const logger = sharedLogger!;
  const sessionManager = sharedSessionManager!;

  logger.log("info", "plugin.loaded_for_project", {
    directory,
    uiPort: sharedUIServer?.getPort() ?? null,
    augmentAgents: config.augmentAgents,
    overlayStyle: config.overlayStyle,
  });

  function ensureSession(sessionId: string): void {
    if (!sessionManager.hasSession(sessionId)) {
      sessionManager.createSession(
        sessionId,
        `opencode-${sessionId}`,
        "opencode",
        null,
      );
    }
  }

  const getFeedbackTool = tool({
    description:
      "Wait for human feedback via the TaskSync web UI. This tool blocks until the user submits feedback through the browser-based feedback interface. Use this at the end of every response to maintain the daemon feedback loop.",
    args: {},
    execute: async (_args, context) => {
      const sessionId = context.sessionID;
      ensureSession(sessionId);

      const queued = sessionManager.consumeQueuedFeedback(sessionId);
      if (queued) {
        return queued.content;
      }

      const waitId = crypto.randomUUID();
      const { promise, resolve } =
        Promise.withResolvers<PendingFeedbackResult>();

      sessionManager.setWaiter(sessionId, {
        waitId,
        startedAt: new Date().toISOString(),
        requestId: context.messageID,
        resolve,
      });

      const onAbort = () => {
        sessionManager.clearPendingWaiter(
          sessionId,
          "tool_call_aborted",
          context.messageID,
        );
      };
      context.abort.addEventListener("abort", onAbort, { once: true });

      try {
        const result = await promise;
        if (result.type === "feedback") {
          return result.content;
        }
        return `[Session closed: ${result.reason}]`;
      } finally {
        context.abort.removeEventListener("abort", onAbort);
      }
    },
  });

  function getOverlayPrompt(
    style: TaskSyncPluginConfig["overlayStyle"],
  ): string {
    return style === "compact" ? DAEMON_OVERLAY_COMPACT : DAEMON_OVERLAY_FULL;
  }

  return {
    tool: {
      get_feedback: getFeedbackTool,
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionId = event.properties.info.id;
        if (sessionManager.hasSession(sessionId)) {
          await sessionManager.deleteSession(
            sessionId,
            "opencode_session_deleted",
          );
        }
      }
    },

    config: async (openCodeConfig) => {
      // --- Layer 2: Dedicated daemon agent (always injected) ---
      if (!openCodeConfig.agent) openCodeConfig.agent = {};
      openCodeConfig.agent.daemon = {
        description:
          "Persistent daemon agent running a TaskSync feedback loop. Never terminates unless explicitly told to stop.",
        mode: "primary",
        prompt: DAEMON_AGENT_PROMPT,
        tools: {
          get_feedback: true,
          write: true,
          edit: true,
          bash: true,
          read: true,
          list: true,
          glob: true,
          grep: true,
          webfetch: true,
          task: true,
          todowrite: true,
          todoread: true,
          skill: true,
        },
        permission: {
          edit: "allow",
          bash: "allow",
          webfetch: "allow",
        },
      };

      // --- Layer 3: Agent augmentation (optional, per-project) ---
      if (config.augmentAgents.length > 0) {
        const overlay = getOverlayPrompt(config.overlayStyle);

        const agentsToAugment = new Set<string>();

        if (config.augmentAgents.includes("*")) {
          for (const name of Object.keys(openCodeConfig.agent)) {
            if (name !== "daemon") agentsToAugment.add(name);
          }
        } else {
          for (const name of config.augmentAgents) {
            if (name !== "daemon") agentsToAugment.add(name);
          }
        }

        for (const agentName of agentsToAugment) {
          const existing = openCodeConfig.agent[agentName];
          if (existing) {
            const existingPrompt = existing.prompt || "";
            existing.prompt = existingPrompt
              ? `${existingPrompt}\n\n${overlay}`
              : overlay;

            if (!existing.tools) existing.tools = {};
            existing.tools.get_feedback = true;
          } else {
            openCodeConfig.agent[agentName] = {
              prompt: overlay,
              tools: { get_feedback: true },
            };
          }

          logger.log("info", "plugin.agent.augmented", {
            agent: agentName,
            style: config.overlayStyle,
            existed: !!existing,
          });
        }
      }
    },
  };
};

export default plugin;
