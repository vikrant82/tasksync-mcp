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

/**
 * Tracks the active user-selected agent per session.
 * Used to apply daemon overlay at runtime without replacing built-in prompts.
 */
const activeAgentBySession = new Map<string, string>();

/**
 * Module-level cache for the most recent assistant text per session.
 * Updated reactively via message.part.updated events. Sent to server
 * as X-Agent-Context header on SSE connections for remote notifications.
 */
const agentContextBySession = new Map<string, string>();

/**
 * FYI notification timers. When assistant text completes without a get_feedback
 * call within FYI_DELAY_MS, the text is sent to the server as an informational
 * status update for remote notifications.
 */
const fyiTimers = new Map<string, ReturnType<typeof setTimeout>>();
const FYI_DELAY_MS = 30_000;

// Retry configuration for transient errors
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;
const BACKOFF_MULTIPLIER = 2;

// Reasons that indicate the session is permanently gone — don't retry
const NON_RETRYABLE_REASONS = new Set(["session_deleted", "session_pruned"]);

// Built-in OpenCode agent names we can safely target when wildcard augmentation
// is enabled, even if they are not explicitly defined in cfg.agent yet.
const KNOWN_BUILT_IN_AGENTS = ["ask", "build", "plan", "general"] as const;

const plugin: Plugin = async ({ directory }) => {
  const config = loadConfig(directory);
  const serverUrl = config.serverUrl.replace(/\/+$/, "");
  const overlay =
    config.overlayStyle === "compact" ? DAEMON_OVERLAY_COMPACT : DAEMON_OVERLAY_FULL;
  const wildcardEnabled = config.augmentAgents.includes("*");
  const shouldAugmentAgent = (name: string | undefined) =>
    !!name && name !== "daemon" && (wildcardEnabled || config.augmentAgents.includes(name));

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

    // Cache assistant text synchronously — this hook fires during text-end processing,
    // BEFORE tool execution in the same LLM step. Unlike bus events (which are delivered
    // asynchronously via a forked fiber), this guarantees the cache has the current step's
    // text when get_feedback executes.
    //
    // Also starts a FYI timer: if the agent doesn't call get_feedback within FYI_DELAY_MS,
    // the text is sent to the server as an informational notification.
    "experimental.text.complete": async (
      input: { sessionID: string; messageID: string; partID: string },
      output: { text: string },
    ) => {
      if (output.text && output.text.length > 0) {
        agentContextBySession.set(input.sessionID, output.text);

        // Cancel any existing FYI timer for this session
        const existing = fyiTimers.get(input.sessionID);
        if (existing) clearTimeout(existing);

        // Start new FYI timer — will fire if no get_feedback within FYI_DELAY_MS
        const timer = setTimeout(() => {
          fyiTimers.delete(input.sessionID);
          const text = agentContextBySession.get(input.sessionID);
          if (!text) return;

          fetch(`${serverUrl}/api/status/${input.sessionID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ context: text }),
          }).catch((err) => {
            console.error(`[tasksync] FYI notification failed: ${err}`);
          });
        }, FYI_DELAY_MS);

        fyiTimers.set(input.sessionID, timer);
      }
    },

    // Track the selected agent for this session so we can inject daemon overlay
    // during system-prompt assembly without mutating agent.prompt in config.
    "chat.message": async (
      input: { sessionID: string; agent?: string },
      _output: { message: unknown; parts: unknown[] },
    ) => {
      if (typeof input.agent === "string" && input.agent.length > 0) {
        activeAgentBySession.set(input.sessionID, input.agent);
      }
    },

    // Append daemon overlay at runtime for targeted agents.
    // This preserves built-in prompts because OpenCode treats agent.prompt as
    // an override, not an append.
    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      if (config.augmentAgents.length === 0) return;
      if (!input.sessionID) return;

      const activeAgent = activeAgentBySession.get(input.sessionID);
      if (!shouldAugmentAgent(activeAgent)) return;
      if (output.system.includes(overlay)) return;

      output.system.push(overlay);
    },

    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = (event as {
          properties?: { info?: { role?: string; sessionID?: string; agent?: string } };
        }).properties?.info;

        if (
          info?.role === "user" &&
          typeof info.sessionID === "string" &&
          typeof info.agent === "string" &&
          info.agent.length > 0
        ) {
          activeAgentBySession.set(info.sessionID, info.agent);
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = (event as { properties?: { info?: { id?: string } } }).properties?.info;
        if (sessionInfo?.id) {
          fetch(`${serverUrl}/sessions/${sessionInfo.id}`, { method: "DELETE" }).catch(() => {});
          pendingImages.delete(sessionInfo.id);
          agentContextBySession.delete(sessionInfo.id);
          activeAgentBySession.delete(sessionInfo.id);
          const fyiTimer = fyiTimers.get(sessionInfo.id);
          if (fyiTimer) {
            clearTimeout(fyiTimer);
            fyiTimers.delete(sessionInfo.id);
          }
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
        for (const [name, agent] of Object.entries(cfg.agent)) {
          if (name === "daemon") continue;
          if (!shouldAugmentAgent(name)) continue;
          if (!agent) continue;

          agent.tools = { ...agent.tools, get_feedback: true };
        }

        // For requested agents not present in cfg.agent yet, create partial config
        // entries so get_feedback is enabled. Under wildcard, also seed known
        // built-ins to make "*" behave predictably.
        const requestedTargets = Array.from(
          new Set(
            wildcardEnabled
              ? [...KNOWN_BUILT_IN_AGENTS, ...config.augmentAgents.filter((name) => name !== "*")]
              : config.augmentAgents,
          ),
        );

        for (const name of requestedTargets) {
          if (name === "daemon") continue;
          if (cfg.agent[name]) continue; // already processed above

          cfg.agent[name] = {
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
  // Cancel any pending FYI timer — the agent is now waiting for feedback,
  // so the text will be used as context in the notification instead.
  const fyiTimer = fyiTimers.get(sessionId);
  if (fyiTimer) {
    clearTimeout(fyiTimer);
    fyiTimers.delete(sessionId);
  }

  // Send agent context via POST body (avoids HTTP header size limits)
  if (agentContextBySession.has(sessionId)) {
    try {
      await fetch(`${serverUrl}/api/context/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: agentContextBySession.get(sessionId)! }),
        signal: context.abort,
      });
    } catch {
      // Non-fatal: context is for display/notifications only
    }
  }

  const resp = await fetch(`${serverUrl}/api/stream/${sessionId}`, {
    signal: context.abort,
    headers: {
      Accept: "text/event-stream",
    },
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
