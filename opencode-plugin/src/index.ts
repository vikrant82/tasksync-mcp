import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { DAEMON_AGENT_PROMPT } from "./daemon-prompt.js";
import { DAEMON_OVERLAY_FULL } from "./daemon-overlay.js";
import { DAEMON_OVERLAY_COMPACT } from "./daemon-overlay-compact.js";

interface ImageAttachment {
  data: string;
  mimeType: string;
}

/**
 * Module-level cache for images received from feedback responses.
 * Keyed by OpenCode sessionID. Used by the tool.execute.after hook
 * to inject images as native FilePart attachments on the tool result.
 */
const pendingImages = new Map<string, ImageAttachment[]>();

// Retry configuration for transient errors
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;
const BACKOFF_MULTIPLIER = 2;

// Reasons that indicate the session is permanently gone — don't retry
const NON_RETRYABLE_REASONS = new Set(["session_deleted", "session_pruned"]);

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
      let backoffMs = INITIAL_BACKOFF_MS;

      // Outer retry loop — reconnects on transient failures without involving the LLM
      while (true) {
        try {
          const result = await connectAndWait(serverUrl, sessionId, context);

          if (!result.retry) {
            return result.value;
          }

          // Transient failure — log and fall through to backoff
          console.error(`[tasksync] Retrying in ${backoffMs}ms: ${result.reason}`);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return "[get_feedback aborted — tool was cancelled]";
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[tasksync] Connection error, retrying in ${backoffMs}ms: ${errMsg}`);
        }

        // Backoff sleep — always properly guarded for abort
        try {
          await abortableSleep(backoffMs, context.abort);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return "[get_feedback aborted — tool was cancelled]";
          }
          throw err;
        }
        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      }
    },
  });

  return {
    tool: {
      get_feedback: getFeedback,
    },

    // Layer 2: Inject images as FilePart attachments on the tool result.
    // This hook fires after execute() returns but before the result is persisted.
    // Since the hook fires AFTER resolveTools maps existing attachments (adding PartBase
    // fields), attachments we inject here must include id/sessionID/messageID themselves.
    // OpenCode validates these via zod: id starts with "prt", sessionID with "ses",
    // messageID with "msg".
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: Record<string, unknown>,
    ) => {
      if (input.tool !== "get_feedback") return;

      const images = pendingImages.get(input.sessionID);
      if (!images || images.length === 0) return;

      console.error(`[tasksync] Layer 2: injecting ${images.length} image(s) as attachments for session ${input.sessionID}`);

      output.attachments = images.map((img, idx) => {
        const ext = img.mimeType.split("/")[1] || "png";
        return {
          // PartBase fields required by OpenCode's FilePart schema
          id: `prt_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 10)}`,
          sessionID: input.sessionID,
          messageID: `msg_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 10)}`,
          // FilePart fields
          type: "file" as const,
          mime: img.mimeType,
          filename: `feedback-image-${idx}.${ext}`,
          url: `data:${img.mimeType};base64,${img.data}`,
        };
      });

      pendingImages.delete(input.sessionID);
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionInfo = (event as { properties?: { info?: { id?: string } } }).properties?.info;
        if (sessionInfo?.id) {
          fetch(`${serverUrl}/sessions/${sessionInfo.id}`, { method: "DELETE" }).catch(() => {});
          pendingImages.delete(sessionInfo.id);
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

type ConnectResult =
  | { retry: false; value: string }
  | { retry: true; reason: string };

/**
 * Single SSE connection attempt. Returns either a terminal result (feedback text
 * or non-retryable close) or a retry signal for transient failures.
 * Throws on AbortError (user cancellation) — caller must handle.
 */
async function connectAndWait(
  serverUrl: string,
  sessionId: string,
  context: { abort: AbortSignal },
): Promise<ConnectResult> {
  const resp = await fetch(`${serverUrl}/api/stream/${sessionId}`, {
    signal: context.abort,
    headers: { Accept: "text/event-stream" },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "unknown error");
    return { retry: true, reason: `HTTP ${resp.status}: ${text}` };
  }

  if (!resp.body) {
    return { retry: true, reason: "no response body for SSE stream" };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      if (block.startsWith(":")) continue;

      let eventType = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          data += line.slice(6);
        }
      }

      if (!data) continue;

      if (eventType === "feedback") {
        const result = JSON.parse(data) as {
          type: "feedback";
          content: string;
          images?: ImageAttachment[];
        };

        // Cache images for the tool.execute.after hook to inject as attachments
        if (result.images && result.images.length > 0) {
          pendingImages.set(sessionId, result.images);
        }

        return { retry: false, value: result.content };
      }

      if (eventType === "closed") {
        const result = JSON.parse(data) as { type: "closed"; reason: string };
        if (NON_RETRYABLE_REASONS.has(result.reason)) {
          return { retry: false, value: `[Session closed: ${result.reason}]` };
        }
        return { retry: true, reason: `session closed: ${result.reason}` };
      }

      if (eventType === "error") {
        const result = JSON.parse(data) as { type: "error"; message: string };
        return { retry: true, reason: `server error: ${result.message}` };
      }
    }
  }

  // Stream ended without a terminal event — server may have restarted
  return { retry: true, reason: "SSE stream ended unexpectedly" };
}

/**
 * Sleep that respects an AbortSignal. Throws AbortError if aborted during sleep.
 */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default plugin;
