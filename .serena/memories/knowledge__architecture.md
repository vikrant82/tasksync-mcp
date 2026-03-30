Updated 2026-03-27.

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
- Auto-prune: every 1 min, removes sessions inactive >10 min (configurable, not waiting)
- Prune resets `activeUiSessionId` if the active session was pruned

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
- Config hook: always injects `daemon` agent + optional augmentation of other agents
- `tool.execute.after` hook: injects images as native `FilePart` attachments with PartBase fields
- Event hook: cleans up on `session.deleted`
- Config from `.tasksync/config.json` (global `~/.tasksync/` → project `.tasksync/` → env vars)
- OpenCode rejects unknown keys in `opencode.json`, so config uses dedicated files

## Logging
- Compact structured logs via `logEvent()`
- Debug HTTP logging with request IDs and MCP method hints
- Optional file logging via `TASKSYNC_LOG_FILE`

## UI State
- SSE push from `/events`; broadcasts on session and waiter lifecycle transitions
- Target session resolution: requested → active UI → first live → default constant
- Wait banner with live elapsed timer
