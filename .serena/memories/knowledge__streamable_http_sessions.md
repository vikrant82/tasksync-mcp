# Streamable HTTP Session Notes
- Added `--streamable-http` transport mode.
- Uses MCP session IDs (`mcp-session-id`) to isolate concurrent clients.
- Per-session feedback queue/promise state ensures one agent session does not consume another session's feedback.
- No TTL cleanup by design (long human wait windows supported).
- Manual cleanup supported via `DELETE /sessions/:sessionId`.
- Canonical multi-window routing URL: `/session/:sessionId`.
- UI submits explicit `sessionId` to avoid race conditions when multiple sessions are active.
