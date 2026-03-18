Updated 2026-03-10.

## Core Architecture
- Runtime centered in `index.ts` with two Express apps:
  1. Streamable HTTP MCP server on `/mcp`
  2. Feedback UI server on `/`, `/session/:sessionId`, `/events`, `/feedback/history`, `/sessions`, and session mutation routes.

## Transport & Keepalive
- MCP transport: `StreamableHTTPServerTransport` with transient in-memory replay
- `requestContext` AsyncLocalStorage carries `{ requestId, res?: express.Response }` per request
- SSE keepalive: writes `: keepalive\n\n` every 30s to POST response stream via `res.write()`
  - Bypasses SDK transport abstraction (writes directly to Express response)
  - Cleared on: feedback received, timeout, connection close, write error
  - Configurable via `KEEPALIVE_INTERVAL_MS = 30000`
- `--heartbeat` flag: opt-in for legacy [WAITING] timeout mode
  - `heartbeat=false` (default): `feedbackTimeout=0`, waits indefinitely
  - `heartbeat=true`: `feedbackTimeout` from `--timeout=` or `DEFAULT_TIMEOUT` (1 hour)

## Session & State Management
- `session-state-store.ts`: file-backed metadata in `.tasksync/session-state.json`
  - latest/queued feedback, bounded feedback history, session metadata, alias metadata, active UI session
- `stream-event-store.ts`: transient in-memory event store for short-lived replay
- Session IDs: `{client-slug}-{generation}` format (e.g., `opencode-1`, `copilot-3`)
  - `slugifyForSessionId()` extracts tool name from alias, lowercases, strips version/special chars
  - `nextClientGeneration()` provides monotonic counter per alias, persisted to disk
- Session close: stream close clears waiter + logs; DELETE fully removes state
- Auto-prune: `setInterval` every 5 min removes sessions inactive >4h (not waiting)

## Feedback Flow
- `get_feedback` waiter ownership tracked per raw HTTP request via request-scoped IDs
- Request abort/response close cleanup: abandoned POST waits clear only their own waiter
- Later feedback queued if no active waiter
- Image support: `POST /feedback` accepts optional `images[]` array of `{data: base64, mimeType}`. Backend propagates through waiter/queue. `formatFeedbackResponse()` returns mixed `TextContent + ImageContent` MCP blocks. Express JSON limit: 50mb.
- `ImageAttachment` type and `sanitizeImageAttachments()` helper defined in `session-state-store.ts`

## Logging
- Compact structured logs via `logEvent(...)`
- Pretty debug request/response logs with request IDs and MCP method hints
- Debug body truncation: `DEBUG_BODY_MAX_CHARS = 2000`, HTML replaced with `[HTML content omitted]`
- Response accumulation cap: `MAX_RESPONSE_LOG_BYTES = 50_000`
- Keepalive comments filtered from debug accumulation
- Optional file logging via `TASKSYNC_LOG_FILE`

## UI State
- SSE push from `/events`; broadcasts on session and waiter lifecycle transitions
- Target session resolution: requested → active UI → first live → default constant
- Wait banner: live elapsed timer via `setInterval(1s)` using `waitStartedAt` from payload
- Session list: metadata line (created time, active ago, waiting duration), stale visual dimming
- Prune button shows stale count, auto-disabled when 0
