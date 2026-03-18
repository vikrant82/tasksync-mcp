Updated 2026-03-10.

`tasksync-mcp` is a Streamable HTTP MCP server focused on iterative human feedback loops for coding agents through the `get_feedback` tool.

Key features:
- `get_feedback` blocks until feedback arrives. Connection kept alive by SSE comment keepalive (`: keepalive\n\n` every 30s).
- Default mode: no timeout, no [WAITING] — waits indefinitely with keepalive.
- Legacy heartbeat mode (`--heartbeat`): returns [WAITING] on timeout, agent re-POSTs.
- Feedback UI is embedded by default and uses SSE (`/events`) for live updates.
- UI shows two-column layout: composer/history (left), sessions/settings (right).
- Image support: paste, drag-drop, or attach images in the feedback UI. Images sent as base64 in `POST /feedback`, returned to agents as MCP `ImageContent` blocks alongside text. History shows thumbnails with lightbox zoom.
- Markdown toolbar: formatting buttons (Bold, Italic, Code, etc.), keyboard shortcuts (Ctrl+B/I/K/`), Tab indent, auto-continue lists.
- Per-session submitted feedback history stored in bounded form and exposed via `/feedback/history`.
- Session/feedback metadata persisted locally in `.tasksync/session-state.json`.
- Replay is transient/in-memory only; stale pre-restart session IDs are invalid.
- Optional file logging via `TASKSYNC_LOG_FILE`; debug mode adds HTTP payload logging with request IDs.

Agent prompt variants:
- `task-sync-agent-opencode.md` / `task-sync-agent-copilot.md` — default (keepalive, no [WAITING])
- `task-sync-agent-opencode-waiting.md` / `task-sync-agent-copilot-waiting.md` — heartbeat mode

Stack: TypeScript, Node.js, Express, `@modelcontextprotocol/sdk`, Jest/ts-jest
