import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ChannelManager } from "./channels.js";
import { logEvent } from "./logging.js";
import type {
  FeedbackChannelState,
  PendingFeedbackResult,
  SessionManager,
} from "./session-manager.js";
import { formatFeedbackResponse } from "./utils.js";

const GetFeedbackArgsSchema = z.object({}).strict();

type ToolInput = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

type RequestContextStore = {
  requestId: string;
  res?: {
    writableEnded: boolean;
    write(chunk: string): unknown;
  };
};

type FeedbackHandlerDependencies = {
  sessionManager: SessionManager;
  channelManager?: ChannelManager;
  heartbeat: boolean;
  feedbackTimeout: number;
  keepaliveIntervalMs: number;
  requestContext: {
    getStore(): RequestContextStore | undefined;
  };
  getSessionId(rawSessionId?: string): string;
  setActiveUiSessionId(sessionId: string): Promise<void>;
  getFeedbackState(sessionId: string): FeedbackChannelState;
  markSessionActivity(sessionId: string, source?: string): void;
};

export function registerFeedbackHandlers(
  targetServer: Server,
  {
    sessionManager,
    channelManager,
    heartbeat,
    feedbackTimeout,
    keepaliveIntervalMs,
    requestContext,
    getSessionId,
    setActiveUiSessionId,
    getFeedbackState,
    markSessionActivity,
  }: FeedbackHandlerDependencies
): void {
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
        {
          name: "check_interrupts",
          description:
            "Non-blocking check for urgent messages from the user. " +
            "Returns immediately with any queued urgent feedback, or an empty result if none. " +
            "Call this periodically between tool calls to allow the user to redirect your work mid-task. " +
            "If urgent feedback is returned, prioritize it over your current task.",
          inputSchema: {
            type: "object" as const,
            properties: {},
            required: [],
          },
        },
      ],
    };
  });

  targetServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    try {
      const { name, arguments: args } = request.params;
      const sessionId = getSessionId(extra?.sessionId);
      await setActiveUiSessionId(sessionId);
      getFeedbackState(sessionId);
      logEvent("debug", "mcp.tool.call", { tool: name, sessionId });

      switch (name) {
        case "get_feedback": {
          const parsed = GetFeedbackArgsSchema.safeParse(args ?? {});
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_feedback: ${parsed.error}`);
          }

          markSessionActivity(sessionId, "get_feedback");

          const urgent = sessionManager.consumeUrgentFeedback(sessionId);
          if (urgent !== null) {
            logEvent("info", "feedback.return.urgent", {
              sessionId,
              contentLength: urgent.content.length,
              imageCount: urgent.images?.length ?? 0,
            });
            return formatFeedbackResponse(`[URGENT] ${urgent.content}`, urgent.images);
          }

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
          const requestId = requestContext.getStore()?.requestId ?? randomUUID();
          const feedbackPromise = new Promise<PendingFeedbackResult>((resolve) => {
            sessionManager.setWaiter(sessionId, {
              waitId,
              startedAt: waitStartedAt,
              requestId,
              resolve,
            });
          });
          logEvent("info", "feedback.waiting", {
            sessionId,
            requestId,
            waitId,
            waitStartedAt,
            heartbeat,
            timeoutMs: feedbackTimeout,
          });

          if (sessionManager.isRemoteEnabled(sessionId) && channelManager?.hasChannels) {
            const context = sessionManager.getAgentContext(sessionId);
            channelManager.notify({
              sessionId,
              sessionAlias: sessionManager.getSessionAlias(sessionId),
              context: context ?? undefined,
            }).catch((err) => {
              logEvent("error", "feedback.notify.error", { sessionId, error: String(err) });
            });
          }

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
              intervalMs: keepaliveIntervalMs,
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
            }, keepaliveIntervalMs);
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
            if (sessionManager.isWaiting(sessionId)) {
              await sessionManager.clearPendingWaiter(sessionId, "timeout", requestId);
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
            imageCount: result.images?.length ?? 0,
            keepalivesSent: keepaliveSentCount,
          });
          return formatFeedbackResponse(result.content, result.images);
        }

        case "check_interrupts": {
          markSessionActivity(sessionId, "check_interrupts");
          const urgent = sessionManager.consumeUrgentFeedback(sessionId);

          if (urgent) {
            logEvent("info", "mcp.check_interrupts.found", {
              sessionId,
              contentLength: urgent.content.length,
              imageCount: urgent.images?.length ?? 0,
            });
            return formatFeedbackResponse(`[URGENT] ${urgent.content}`, urgent.images);
          }

          logEvent("debug", "mcp.check_interrupts.empty", { sessionId });
          return {
            content: [{ type: "text", text: "No pending interrupts." }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      if (keepaliveInterval) {
        clearInterval(keepaliveInterval);
        keepaliveInterval = null;
      }
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
