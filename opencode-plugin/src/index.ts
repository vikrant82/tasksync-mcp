import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { DAEMON_AGENT_PROMPT } from "./daemon-prompt.js";
import { DAEMON_OVERLAY_FULL } from "./daemon-overlay.js";
import { DAEMON_OVERLAY_COMPACT } from "./daemon-overlay-compact.js";

const plugin: Plugin = async ({ directory }) => {
  const config = loadConfig(directory);
  const serverUrl = config.serverUrl.replace(/\/+$/, "");

  const getFeedback = tool({
    description:
      "Wait for human feedback via the TaskSync web UI. " +
      "Blocks until the user submits feedback or the session is closed. " +
      "Call this at the end of every response to maintain the daemon loop.",
    args: {},
    execute: async (_args, context) => {
      const sessionId = context.sessionID;

      try {
        const resp = await fetch(`${serverUrl}/api/wait/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: context.abort,
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "unknown error");
          return `[TaskSync error: ${resp.status} ${text}]`;
        }

        const result = (await resp.json()) as
          | { type: "feedback"; content: string; images?: unknown[] }
          | { type: "closed"; reason: string };

        if (result.type === "closed") {
          return `[Session closed: ${result.reason}]`;
        }

        return result.content;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return "[get_feedback aborted — tool was cancelled]";
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[tasksync] get_feedback error for session ${sessionId}: ${errMsg}`);
        return `[TaskSync connection error: ${errMsg}. Is the TaskSync server running at ${serverUrl}?]`;
      }
    },
  });

  return {
    tool: {
      get_feedback: getFeedback,
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionInfo = (event as { properties?: { info?: { id?: string } } }).properties?.info;
        if (sessionInfo?.id) {
          fetch(`${serverUrl}/sessions/${sessionInfo.id}`, { method: "DELETE" }).catch(() => {});
        }
      }
    },

    config: async (cfg) => {
      // Layer 2: Always inject the dedicated daemon agent
      cfg.agent = cfg.agent || {};
      cfg.agent.daemon = {
        description: "TaskSync persistent daemon agent with mandatory feedback loop",
        mode: "primary" as const,
        prompt: DAEMON_AGENT_PROMPT,
        tools: { get_feedback: true },
      };

      // Layer 3: Optional augmentation of other agents
      if (config.augmentAgents.length > 0) {
        const overlay =
          config.overlayStyle === "compact" ? DAEMON_OVERLAY_COMPACT : DAEMON_OVERLAY_FULL;
        const shouldAugment = (name: string) =>
          config.augmentAgents.includes("*") || config.augmentAgents.includes(name);

        for (const [name, agent] of Object.entries(cfg.agent)) {
          if (name === "daemon") continue;
          if (!shouldAugment(name)) continue;
          if (!agent) continue;

          agent.prompt = (agent.prompt || "") + "\n\n" + overlay;
          agent.tools = { ...agent.tools, get_feedback: true };
        }

        // For agents in augmentAgents list that aren't in config yet (built-in agents),
        // create partial config entries so the tool gets added
        for (const name of config.augmentAgents) {
          if (name === "*" || name === "daemon") continue;
          if (cfg.agent[name]) continue; // already processed above

          cfg.agent[name] = {
            prompt: overlay,
            tools: { get_feedback: true },
          };
        }
      }
    },
  };
};

export default plugin;
