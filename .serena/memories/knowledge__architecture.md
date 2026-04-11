Updated 2026-04-11.

## Two Integration Paths
1. **MCP Server** — Streamable HTTP MCP for VS Code Copilot, Claude Desktop, any MCP client
2. **OpenCode Plugin** — Native plugin (`opencode-tasksync`) that connects to the server via REST + SSE

Both share the same server, `SessionManager`, feedback UI, and persistence layer.

## Core Architecture
Runtime is centered in `src/index.ts` with two Express apps:
1. **MCP server** on port 3011 (`/mcp`, `/health`)
2. **Feedback UI server** on port 3456 — serves web UI, SSE events, REST API

### Session Types
- **MCP sessions**: created via MCP `initialize`, have `StreamableHTTPServerTransport` + `Server`
- **Plugin sessions**: created via `POST /api/sessions` or auto on `GET /api/stream/:sessionId`, no MCP transport

`StreamableSessionEntry` has optional `transport?` and `server?` fields so both types share the same state model.

## Transport & Keepalive
- MCP transport: `StreamableHTTPServerTransport` with transient in-memory replay
- `requestContext` AsyncLocalStorage carries `{ requestId, res?: express.Response }` per MCP request
- MCP keepalive: writes `: keepalive\n\n` every 30s to the POST response stream
- Plugin feedback transport: `GET /api/stream/:sessionId` SSE with 30s keepalive comments and reconnect logic

## Session & State Management
- `src/session-manager.ts`: sessions, feedback state, aliases, auto-prune
- `src/session-state-store.ts`: persisted state in `.tasksync/session-state.json`
- Session IDs: MCP uses `{client-slug}-{generation}`; plugin uses OpenCode session IDs
- Auto-prune runs every minute and is configurable from the UI. Default is `Never` (`0`) and that value now persists correctly after the PR #12 fix.
- Manual prune uses a 30-minute inactivity threshold.
- Activity is updated by waiter creation, feedback delivery/queue consumption, agent-context updates, and MCP `get_feedback` activity markers.

## Feedback Flow
- Waiter pattern: `setWaiter()` → `deliverFeedback()` or `clearPendingWaiter()`
- Queued feedback returns immediately on next wait if submitted before the agent blocks
- Image support: MCP returns `TextContent + ImageContent`; plugin injects native `FilePart` attachments via `tool.execute.after`

## OpenCode Plugin (`opencode-plugin/`)
- `connectAndWait()` opens the SSE stream and returns `{ retry: true/false }`
- Retry loop in `get_feedback` uses exponential backoff (1s → 15s cap); only `context.abort` stops it
- `NON_RETRYABLE_REASONS`: `session_deleted`, `session_pruned`
- Config hook always injects the dedicated `daemon` agent
- Augmented agents get the daemon overlay at runtime through `experimental.chat.system.transform` so built-in prompts are preserved
- `activeAgentBySession` tracks the active agent per session
- `experimental.text.complete` caches assistant text for UI/remote status updates
- `session.updated` events can sync inferred titles to the server via `POST /sessions/:sessionId/title`
- PR #12 added low-signal title filtering so bootstrap/orientation titles are ignored or trimmed before being used as inferred aliases

## Session Recovery
- Persisted across restart: feedback history, queued feedback + images, aliases, client generations, remote-enabled flag, active UI session ID
- Runtime only: pending waiters, live transports/servers, agent context text
- Plugin recovery path: reconnect SSE, auto-register session, resend context via `POST /api/context/:sessionId`

## Remote Mode
- `src/channels.ts`: `ChannelManager` + `TelegramChannel`
- Telegram supports `/start`, stored chat IDs, text replies, and inline quick-reply buttons
- Remote mode is per session (`POST /sessions/:id/remote`)
- Agent context is sent via `POST /api/context/:sessionId` and FYI updates via `POST /api/status/:sessionId`

## Documentation State
- As of 2026-04-11, docs were corrected to reflect current plugin SSE flow instead of the old long-poll path
