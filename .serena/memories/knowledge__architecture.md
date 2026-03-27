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
- SSE keepalive: writes `: keepalive\n\n` every 30s to POST response stream (MCP only)
- Plugin uses long-poll (`POST /api/wait/:sessionId`) — no keepalive needed (localhost)

## Session & State Management
- `session-manager.ts`: `SessionManager` class — sessions, feedback state, aliases, auto-prune
- `session-state-store.ts`: file-backed persistence in `.tasksync/session-state.json`
- Session IDs: MCP uses `{client-slug}-{generation}` (e.g., `opencode-1`), plugin uses OpenCode session IDs
- Auto-prune: every 1 min, removes sessions inactive >10 min (configurable, not waiting)
- Prune resets `activeUiSessionId` if the active session was pruned

## Feedback Flow
- Waiter pattern: `setWaiter()` → `deliverFeedback()` (resolves) or `clearPendingWaiter()` (cancels)
- Queued feedback: `consumeQueuedFeedback()` returns immediately if feedback was submitted before wait
- Image support: MCP returns `TextContent + ImageContent` blocks; plugin returns text-only string
- `formatFeedbackResponse()` creates MCP content blocks

## Plugin REST API (on UI server port)
- `POST /api/sessions` — register external session (idempotent)
- `POST /api/wait/:sessionId` — long-poll for feedback (auto-registers, checks queue first, blocks)
- Client abort → `res.on('close')` → `clearPendingWaiter()` cleanup (must use `res`, not `req` — Express body parser consumes `req` stream before handler runs)

## OpenCode Plugin (`opencode-plugin/` directory)
- Thin HTTP client — `fetch()` to server REST endpoints
- Config hook: always injects `daemon` agent + optional augmentation of other agents
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
