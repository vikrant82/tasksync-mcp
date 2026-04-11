# Session Workflow

## Goal

Support multiple concurrent sessions with isolated feedback queues. Sessions can originate from MCP clients or external plugins.

## Session Types

| Type | Origin | Transport | Session ID |
|------|--------|-----------|------------|
| **MCP** | MCP `initialize` | `StreamableHTTPServerTransport` | `{client-slug}-{generation}` (e.g., `opencode-1`) |
| **Plugin** | `POST /api/sessions` or auto on `GET /api/stream/:id` | SSE (`text/event-stream`) | Plugin-provided (e.g., OpenCode session ID) |

Both types share the same feedback queue, waiter, and UI infrastructure.

## MCP Session Lifecycle

1. Client sends `initialize` to `POST /mcp` without `mcp-session-id`.
2. Server creates a Streamable HTTP transport with a human-readable session ID (e.g., `opencode-1`, `copilot-3`).
3. Client reuses `mcp-session-id` in subsequent MCP requests.
4. Server routes `get_feedback` and UI submissions by session id.
5. If a stream drops temporarily, the client can reconnect while the server process remains alive.
6. If the server restarts, the client must initialize again; preserved state is reassociated to the new live session.
7. Auto-prune is configurable via the UI settings ("Auto prune after" dropdown). Default is "Never" (disabled). When enabled, sessions inactive beyond the configured threshold (and not currently waiting) are pruned every minute. Manual prune via the "Prune Stale" button uses a 30-minute threshold.

## Plugin Session Lifecycle

1. Plugin ensures the session exists via `POST /api/sessions` when needed.
2. Plugin optionally sends the latest assistant text to `POST /api/context/:sessionId` for UI display and remote notifications.
3. Plugin opens `GET /api/stream/:sessionId` and waits on the SSE stream.
4. Server auto-registers the session if needed, sends keepalive comments every 30 seconds, and emits `feedback` / `closed` / `error` events.
5. On `session.deleted`, the plugin calls `DELETE /sessions/:sessionId` and clears local session caches.
6. Same auto-prune rules apply (configurable, default disabled).

## Feedback Routing

- `get_feedback` blocks per session until feedback is submitted for that same session.
- UI can target sessions explicitly via:
  - URL: `/session/<sessionId>`
  - API body: `POST /feedback` with `sessionId`

## Storage Model

- Feedback/session metadata is persisted locally.
- Live waiter closures, replay-event history, and transport/server objects remain in-memory only.
- No legacy file-watching feedback path.

## Manual Session Control

- `GET /sessions` lists active sessions.
- `POST /sessions/active` sets default UI target session.
- `DELETE /sessions/:sessionId` disconnects a session.

## Restart Boundary

- Old pre-restart session IDs are not transparently resurrected.
- Recovery happens by creating a fresh MCP session and reassociating preserved feedback/session state.
