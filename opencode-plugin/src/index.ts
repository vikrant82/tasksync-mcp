import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { DAEMON_AGENT_PROMPT } from "./daemon-prompt.js";
import { DAEMON_OVERLAY_FULL } from "./daemon-overlay.js";
import { DAEMON_OVERLAY_COMPACT } from "./daemon-overlay-compact.js";
import { mkdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";

interface ImageAttachment {
  data: string;
  mimeType: string;
}

interface PendingImageBatch {
  sessionId: string;
  images: ImageAttachment[];
}

function summarizePart(part: any): Record<string, unknown> {
  const state = part?.state;
  const metadata = state?.metadata;

  return {
    type: part?.type,
    tool: part?.tool,
    callID: part?.callID,
    hasState: Boolean(state),
    stateStatus: state?.status,
    stateKeys: state && typeof state === "object" ? Object.keys(state) : [],
    metadataKeys: metadata && typeof metadata === "object" ? Object.keys(metadata) : [],
    imageRefAtStateMetadata: metadata?.imageRef,
    imageRefAtPartMetadata: part?.metadata?.imageRef,
    attachmentCount: Array.isArray(state?.attachments) ? state.attachments.length : 0,
  };
}

function logPluginEvent(event: string, details: Record<string, unknown> = {}): void {
  console.error(`[tasksync] ${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}`);
}

/**
 * Module-level cache for images received from feedback responses.
 * Keyed by a unique reference ID embedded in tool metadata.
 * Used by the experimental.chat.messages.transform hook to inject
 * images as FilePart entries into the message history.
 */
const pendingImages = new Map<string, PendingImageBatch>();
const require = createRequire(import.meta.url);
const { version: taskSyncPluginVersion = "0.0.0" } = require("../package.json") as {
  version?: string;
};
const WAIT_RETRY_DELAY_MS = 250;

const plugin: Plugin = async ({ directory }) => {
  const config = loadConfig(directory);
  const serverUrl = config.serverUrl.replace(/\/+$/, "");

  logPluginEvent("plugin.initialized", {
    version: taskSyncPluginVersion,
    serverUrl,
    directory,
    augmentAgents: config.augmentAgents,
    overlayStyle: config.overlayStyle,
  });

  const getFeedback = tool({
    description:
      "Wait for human feedback via the TaskSync web UI. " +
      "Blocks until the user submits feedback or the session is closed. " +
      "Call this at the end of every response to maintain the daemon loop.",
    args: {},
    execute: async (_args, context) => {
      const sessionId = context.sessionID;
      try {
        let attempt = 0;

        while (true) {
          attempt += 1;
          logPluginEvent("plugin.feedback.wait.start", { sessionId, serverUrl, attempt });

          const resp = await fetch(`${serverUrl}/api/wait/${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: context.abort,
          });

          logPluginEvent("plugin.feedback.wait.response", {
            sessionId,
            status: resp.status,
            ok: resp.ok,
            attempt,
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => "unknown error");
            logPluginEvent("plugin.feedback.wait.error_response", {
              sessionId,
              status: resp.status,
              body: text,
              attempt,
            });
            return `[TaskSync error: ${resp.status} ${text}]`;
          }

          const result = (await resp.json()) as
            | { type: "feedback"; content: string; images?: ImageAttachment[] }
            | { type: "closed"; reason: string }
            | { type: "timeout"; retryAfterMs?: number };

          if (result.type === "timeout") {
            logPluginEvent("plugin.feedback.wait.timeout", {
              sessionId,
              attempt,
              retryAfterMs: result.retryAfterMs ?? 0,
            });
            const retryDelay = Math.max(0, result.retryAfterMs ?? WAIT_RETRY_DELAY_MS);
            if (retryDelay > 0) {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, retryDelay);
                const onAbort = () => {
                  clearTimeout(timer);
                  reject(new DOMException("Aborted", "AbortError"));
                };
                if (context.abort.aborted) {
                  onAbort();
                  return;
                }
                context.abort.addEventListener("abort", onAbort, { once: true });
                setTimeout(() => context.abort.removeEventListener("abort", onAbort), retryDelay + 50);
              });
            }
            continue;
          }

          if (result.type === "closed") {
            logPluginEvent("plugin.feedback.closed", { sessionId, reason: result.reason, attempt });
            return `[Session closed: ${result.reason}]`;
          }

          logPluginEvent("plugin.feedback.received", {
            sessionId,
            contentLength: result.content.length,
            imageCount: result.images?.length ?? 0,
            attempt,
          });

          if (result.images && result.images.length > 0) {
            // Layer 1: Save images to temp files so agents can read them with file tools
            const imageDir = join(tmpdir(), "tasksync-images", sessionId);
            logPluginEvent("plugin.image.layer1.start", {
              sessionId,
              imageCount: result.images.length,
              imageDir,
            });
            try {
              mkdirSync(imageDir, { recursive: true });
              logPluginEvent("plugin.image.layer1.dir_ready", { sessionId, imageDir });
            } catch {}

            const savedPaths: string[] = [];
            for (let i = 0; i < result.images.length; i++) {
              const img = result.images[i];
              const ext = img.mimeType.split("/")[1] || "png";
              const filePath = join(imageDir, `image-${i}.${ext}`);
              try {
                writeFileSync(filePath, Buffer.from(img.data, "base64"));
                savedPaths.push(filePath);
                logPluginEvent("plugin.image.layer1.saved", {
                  sessionId,
                  imageIndex: i,
                  mimeType: img.mimeType,
                  filePath,
                });
              } catch (err) {
                logPluginEvent("plugin.image.layer1.save_failed", {
                  sessionId,
                  imageIndex: i,
                  mimeType: img.mimeType,
                  filePath,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }

            logPluginEvent("plugin.image.layer1.complete", {
              sessionId,
              imageCount: result.images.length,
              savedCount: savedPaths.length,
            });

            // Layer 2 (experimental): Cache images for the transform hook to inject as FileParts.
            // Use a unique ref so the transform hook can correlate images with this specific tool result.
            const imageRef = crypto.randomUUID();
            pendingImages.set(imageRef, { sessionId, images: result.images });
            logPluginEvent("plugin.image.layer2.cached", {
              sessionId,
              imageRef,
              imageCount: result.images.length,
              pendingCount: pendingImages.size,
            });
            context.metadata({ metadata: { imageRef } });
            logPluginEvent("plugin.image.layer2.metadata_attached", {
              sessionId,
              imageRef,
            });

            if (savedPaths.length > 0) {
              logPluginEvent("plugin.feedback.returning_with_images", {
                sessionId,
                imageRef,
                savedCount: savedPaths.length,
              });
              return `${result.content}\n\n[User attached ${savedPaths.length} image(s): ${savedPaths.join(", ")}]`;
            }

            logPluginEvent("plugin.feedback.returning_without_saved_paths", {
              sessionId,
              imageRef,
              imageCount: result.images.length,
            });
          }

          logPluginEvent("plugin.feedback.returning_text_only", { sessionId });
          return result.content;
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          logPluginEvent("plugin.feedback.wait.aborted", { sessionId });
          return "[get_feedback aborted — tool was cancelled]";
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        logPluginEvent("plugin.feedback.wait.failed", { sessionId, error: errMsg });
        return `[TaskSync connection error: ${errMsg}. Is the TaskSync server running at ${serverUrl}?]`;
      }
    },
  });

  return {
    tool: {
      get_feedback: getFeedback,
    },

    // Layer 2 (experimental): Inject images as FileParts into the message history
    // before each LLM call. This hook fires on every generation request with a fresh
    // copy of the complete message history. If the Go backend maps FilePart entries
    // to native image content, the LLM will be able to "see" the attached images.
    "experimental.chat.messages.transform": async (
      _input: {},
      output: { messages: Array<{ info: { id: string; sessionID: string }; parts: any[] }> },
    ) => {
      if (!output?.messages?.length) return;

      logPluginEvent("plugin.image.layer2.transform.start", {
        messageCount: output.messages.length,
        pendingCount: pendingImages.size,
      });

      for (const msg of output.messages) {
        if (!msg?.parts) continue;

        logPluginEvent("plugin.image.layer2.transform.message", {
          sessionId: msg.info?.sessionID,
          messageId: msg.info?.id,
          partCount: msg.parts.length,
        });

        for (const part of msg.parts) {
          if (part?.type === "tool") {
            logPluginEvent("plugin.image.layer2.transform.tool_part", {
              sessionId: msg.info?.sessionID,
              messageId: msg.info?.id,
              ...summarizePart(part),
            });
          }

          if (
            part.type !== "tool" ||
            part.tool !== "get_feedback" ||
            part.state?.status !== "completed"
          ) {
            continue;
          }

          const imageRef = part.state?.metadata?.imageRef ?? part?.metadata?.imageRef;
          if (!imageRef) {
            logPluginEvent("plugin.image.layer2.no_image_ref", {
              sessionId: msg.info?.sessionID,
              messageId: msg.info?.id,
              ...summarizePart(part),
            });
            continue;
          }

          const batch = pendingImages.get(imageRef);
          if (!batch || batch.images.length === 0) {
            const existingAttachmentCount = Array.isArray(part.state?.attachments)
              ? part.state.attachments.length
              : 0;
            if (existingAttachmentCount === 0) {
              logPluginEvent("plugin.image.layer2.cache_miss", {
                sessionId: msg.info?.sessionID,
                messageId: msg.info?.id,
                imageRef,
                pendingCount: pendingImages.size,
              });
            }
            continue;
          }

          // Inject images as attachments on the tool state
          part.state.attachments = batch.images.map(
            (img: ImageAttachment, idx: number) => ({
              type: "file" as const,
              mime: img.mimeType,
              filename: `feedback-image-${idx}.${img.mimeType.split("/")[1] || "png"}`,
              url: `data:${img.mimeType};base64,${img.data}`,
            }),
          );

          logPluginEvent("plugin.image.layer2.injected", {
            sessionId: batch.sessionId,
            messageId: msg.info?.id,
            imageRef,
            attachmentCount: batch.images.length,
          });

          // Free memory — this ref has been processed
          pendingImages.delete(imageRef);
          logPluginEvent("plugin.image.layer2.cleaned", {
            sessionId: batch.sessionId,
            imageRef,
            pendingCount: pendingImages.size,
          });
        }
      }

      logPluginEvent("plugin.image.layer2.transform.done", {
        pendingCount: pendingImages.size,
      });
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const sessionInfo = (event as { properties?: { info?: { id?: string } } }).properties?.info;
        if (sessionInfo?.id) {
          logPluginEvent("plugin.session.deleted", {
            sessionId: sessionInfo.id,
            pendingCount: pendingImages.size,
          });
          fetch(`${serverUrl}/sessions/${sessionInfo.id}`, { method: "DELETE" }).catch(() => {});

          // Clean up any cached images for this session
          for (const [ref, _images] of pendingImages) {
            pendingImages.delete(ref);
          }
          logPluginEvent("plugin.session.deleted.cleanup_complete", {
            sessionId: sessionInfo.id,
            pendingCount: pendingImages.size,
          });
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
