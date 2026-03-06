Updated 2026-03-06.

`tasksync-mcp` is a Streamable HTTP MCP server focused on iterative human feedback loops for coding agents through the `get_feedback` tool.

Current notable behavior:
- `get_feedback` takes no arguments and blocks until feedback arrives or timeout is reached.
- Feedback UI is embedded by default and now uses SSE (`/events`) for live updates instead of polling.
- UI shows a two-column layout with composer/history on the left and sessions/settings on the right.
- Per-session submitted feedback history is stored in bounded form and exposed through `/feedback/history`.
- Minimal session/user-feedback metadata is persisted locally in `.tasksync/session-state.json`.
- Replay is transient/in-memory only; stale pre-restart session IDs are still invalid.
- Optional file logging is available via `TASKSYNC_LOG_FILE`; debug mode adds pretty HTTP payload logging with request IDs and MCP method hints.

Stack:
- TypeScript
- Node.js
- Express
- `@modelcontextprotocol/sdk`
- Jest / ts-jest
