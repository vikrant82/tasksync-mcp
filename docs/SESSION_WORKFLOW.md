# Session Workflow

## Goal

Support multiple MCP sessions concurrently with isolated feedback queues.

## Session Lifecycle

1. Client sends `initialize` to `POST /mcp` without `mcp-session-id`.
2. Server creates a Streamable HTTP transport with a human-readable session ID (e.g., `opencode-1`, `copilot-3`).
3. Client reuses `mcp-session-id` in subsequent MCP requests.
4. Server routes `get_feedback` and UI submissions by session id.
5. If a stream drops temporarily, the client can reconnect while the server process remains alive.
6. If the server restarts, the client must initialize again; preserved state is reassociated to the new live session.
7. Sessions inactive for >4 hours (and not currently waiting) are automatically pruned every 5 minutes.

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
