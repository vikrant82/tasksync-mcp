# Session Workflow

## Goal

Support multiple MCP sessions concurrently with isolated feedback queues.

## Session Lifecycle

1. Client sends `initialize` to `POST /mcp` without `mcp-session-id`.
2. Server creates a Streamable HTTP transport and session id.
3. Client reuses `mcp-session-id` in subsequent MCP requests.
4. Server routes `get_feedback` and UI submissions by session id.

## Feedback Routing

- `get_feedback` blocks per session until feedback is submitted for that same session.
- UI can target sessions explicitly via:
  - URL: `/session/<sessionId>`
  - API body: `POST /feedback` with `sessionId`

## Storage Model

- Feedback is in-memory only.
- No file persistence.
- No file watching.

## Manual Session Control

- `GET /sessions` lists active sessions.
- `POST /sessions/active` sets default UI target session.
- `DELETE /sessions/:sessionId` disconnects a session.
