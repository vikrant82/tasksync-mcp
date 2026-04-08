Updated 2026-04-08.

## Two Integration Paths

TaskSync supports two ways to connect agents:

1. **MCP Server** — Streamable HTTP MCP for VS Code Copilot, Claude Desktop, any MCP client
2. **OpenCode Plugin** — Native plugin (`opencode-tasksync`) that connects to the server via REST

Both share the same server, SessionManager, feedback UI, and persistence layer.

## Core Architecture

Runtime centered in `index.ts` with two Express apps:
1. **MCP server** on port 3011 (`/mcp`, `/health`)
2. **Feedback UI server** on port 3456 — serves web UI, SSE events, REST API

### Session Types
- **MCP sessions**: Created via MCP `initialize`, have `StreamableHTTPServerTransport` + `Server`
- **Plugin sessions**: Created via `POST /api/sessions` or auto on `POST /api/wait/:id`, no MCP transport

`StreamableSessionEntry` has optional `transport?` and `server?` fields to support both types.

## Transport & Keepalive
- MCP transport: `StreamableHTTPServerTransport` with transient in-memory replay
- `requestContext` AsyncLocalStorage carries `{ requestId, res?: express.Response }` per MCP request
- MCP SSE keepalive: writes `: keepalive\n\n` every 30s to POST response stream
- Plugin SSE: `GET /api/stream/:sessionId` with 30s keepalive comments, replaces old POST long-poll

## Session & State Management
- `session-manager.ts`: `SessionManager` class — sessions, feedback state, aliases, auto-prune
- `session-state-store.ts`: file-backed persistence in `.tasksync/session-state.json`
- Session IDs: MCP uses `{client-slug}-{generation}` (e.g., `opencode-1`), plugin uses OpenCode session IDs
- Auto-prune: checks every 1 min, threshold configurable via UI dropdown ("Auto prune after"). Default: "Never" (0 = disabled). All session types treated equally (no plugin skip). Uses `deleteSession()` for full cleanup.
- Manual prune ("Prune Stale" button): 30-minute threshold, removes all non-waiting sessions.
- `pruneStale()` is async with `pruning` guard flag to prevent overlap from `setInterval`.
- `setAgentContext()` calls `markActivity()` when context non-null → FYI messages and agent context updates reset stale timer.
- Activity tracked by: `setWaiter` (feedback_request), `deliverFeedback`, `consumeQueuedFeedback`, `setAgentContext` (agent_context), `markSessionActivity` (get_feedback MCP handler).

## Feedback Flow
- Waiter pattern: `setWaiter()` → `deliverFeedback()` (resolves) or `clearPendingWaiter()` (cancels)
- Queued feedback: `consumeQueuedFeedback()` returns immediately if feedback was submitted before wait
- Image support: MCP returns `TextContent + ImageContent` blocks; plugin injects native `FilePart` attachments via `tool.execute.after` hook
- `formatFeedbackResponse()` creates MCP content blocks

## Plugin REST API (on UI server port)
- `POST /api/sessions` — register external session (idempotent)
- `GET /api/stream/:sessionId` — SSE stream for feedback (auto-registers, checks queue first, sends keepalives every 30s). Replaces old POST long-poll.
- Client disconnect → `res.on('close')` → `clearPendingWaiter()` + cleanup SSE registry
- `activeSSEClients` Map tracks all open SSE connections for graceful shutdown

## OpenCode Plugin (`opencode-plugin/` directory)
- SSE client — consumes `GET /api/stream/:sessionId` with auto-reconnect
- `connectAndWait()`: single SSE connection attempt, returns discriminated union `{ retry: true/false }`
- Retry loop in `execute()`: exponential backoff (1s → 2s → 4s → 8s → 15s cap), only `context.abort` terminates
- `NON_RETRYABLE_REASONS`: `session_deleted`, `session_pruned` — permanent closes that stop retry
- Config hook: always injects `daemon` agent; augmented agents get `get_feedback` tool only (no prompt mutation)
- Agent augmentation: daemon overlay appended at runtime via `experimental.chat.system.transform` hook — preserves built-in agent prompts (OpenCode treats `agent.prompt` as a full override, not append)
- `activeAgentBySession` Map tracks which agent is active per session (set by `chat.message` hook, which fires before `system.transform`)
- `shouldAugmentAgent()` / `wildcardEnabled`: determines if overlay should apply; `KNOWN_BUILT_IN_AGENTS` (`ask`, `build`, `plan`, `general`) auto-included under wildcard `"*"`
- `augmentAgents` config: accepts array (`["ask", "build"]`) or comma-separated string (`"ask,build"` or `"*"`), parsed via `parseAugmentAgents()`
- `tool.execute.after` hook: injects images as native `FilePart` attachments with PartBase fields
- Event hook: cleans up on `session.deleted` (includes `activeAgentBySession` cleanup)
- Config from `.tasksync/config.json` (global `~/.tasksync/` → project `.tasksync/` → env vars)
- OpenCode rejects unknown keys in `opencode.json`, so config uses dedicated files

## Session Recovery (Server Restart)

Persistence layer (`SessionStateStore` → `.tasksync/session-state.json`) enables seamless recovery:

### Preserved across server restart:
- Feedback history, queued feedback + images, latest feedback
- Manual aliases, client generations (for alias inference)
- Remote mode setting per session
- Active UI session ID

### Not preserved (runtime-only):
- `pendingWaiter: null` — live Promise resolvers can't survive restart
- `agentContext: null` — BUT plugin re-sends via `POST /api/context/:sessionId` on reconnect
- In-memory `sessions` Map entries (require live transport)

### Plugin Recovery Flow:
1. Server dies → plugin's `reader.read()` throws → retry loop: exponential backoff 1s→2s→4s→8s→15s cap
2. Server restarts → `SessionManager.initialize()` → `hydrateFromStore()` restores persisted state
3. Plugin reconnects → `GET /api/stream/:sessionId` → auto-registers session → `setWaiter()`
4. Plugin sends agent context via `POST /api/context/:sessionId` → context restored immediately
5. If remote enabled → Telegram notification re-sent
6. Observable: wait timer resets (new waiter start time), brief UI disconnection gap

### UI Recovery Flow:
- `EventSource` auto-reconnects (~3s default retry, no server-sent `retry:` field)
- On reconnect, `/events` handler sends full state payload immediately
- `applyUiState()` restores all UI elements

### MCP Client Recovery:
- Depends on MCP client implementation (reconnect behavior varies)
- StreamableHTTPServerTransport uses transient in-memory replay (lost on restart)

## Logging
- Compact structured logs via `logEvent()`
- Debug HTTP logging with request IDs and MCP method hints
- Optional file logging via `TASKSYNC_LOG_FILE`

## Remote Mode (Notification Channels)
- `channels.ts`: `ChannelManager` + `TelegramChannel` implementation
- `NotificationChannel` interface: `name`, `initialize()`, `notify()`, `onFeedback()`, `shutdown()`
- `ChannelManager`: dispatches to all active channels, routes feedback via callback
- Telegram: grammY bot + `@grammyjs/runner` (non-blocking long polling)
  - `/start` registers chatId, persisted to `~/.tasksync/telegram-chats.json`
  - Text replies → feedback delivery to active session
  - Inline keyboard: Approve/Reject/Continue quick-reply buttons
- Config: `TASKSYNC_TELEGRAM_BOT_TOKEN` env / `--telegram-token` CLI arg
- Server: `channelManager.notify()` triggered when waiter set + session has `remoteEnabled`
- Plugin: `experimental.text.complete` hook caches agent text → sent via `POST /api/context/:sessionId` (was previously base64 `X-Agent-Context` header, changed in v1.2.1)
- Session state: `remoteEnabled` boolean (persisted), `agentContext` string (runtime)
- `NotificationParams`/`FYIParams`: `sessionId`, `sessionAlias?`, `context` — no `feedbackUrl` (removed: localhost link unreachable from remote)
- Telegram headers show session alias via `getSessionAlias()` fallback chain (manual → inferred → clientAlias → truncated ID)
- UI: toggle button per session, `channelsAvailable` flag
- Endpoints: `POST /sessions/:id/remote`, `GET /channels`

## UI State & Push Architecture
- SSE push from `/events`; broadcasts on session and waiter lifecycle transitions
- Target session resolution: requested → active UI → first live → default constant
- Wait banner with live elapsed timer
- State payload (`buildUiStatePayload()`): includes sessions, waiters, `agentContext`, `channelsAvailable`
- `onStateChange(sessionId)` triggers: `setWaiter`, `clearPendingWaiter`, `deliverFeedback`, `setAgentContext`, `deleteSession`, `setRemoteEnabled`, session alias changes, prune events
- Plugin SSE: `GET /api/stream/:sessionId` — registers waiter, sends keepalive every 30s, feedback via SSE events. `activeSSEClients` Map tracks connections for graceful shutdown.
- Client SSE: `GET /events` — UI EventSource for real-time state updates
