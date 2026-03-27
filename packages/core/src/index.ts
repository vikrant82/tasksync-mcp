// Session management
export { SessionManager } from "./session-manager.js";
export type {
  SessionEntry,
  SessionInfo,
  SessionManagerEvents,
  FeedbackChannelState,
  PendingFeedbackResult,
  PendingWaiter,
} from "./session-manager.js";
export {
  DEFAULT_SESSION_ID,
  DEFAULT_DISCONNECT_AFTER_MINUTES,
  MIN_DISCONNECT_AFTER_MINUTES,
  MAX_DISCONNECT_AFTER_MINUTES,
} from "./session-manager.js";

// State persistence
export { SessionStateStore } from "./session-state-store.js";
export type { ImageAttachment } from "./session-state-store.js";

// Feedback UI server
export { FeedbackUIServer, normalizeAlias, formatFeedbackResponse } from "./feedback-ui-server.js";
export type { FeedbackUIServerOptions, UiStatePayload } from "./feedback-ui-server.js";

// Logging
export { createLogger } from "./logging.js";
export type { Logger, LoggerOptions, LogLevel } from "./logging.js";

// HTML template
export { FEEDBACK_HTML } from "./feedback-html.js";
