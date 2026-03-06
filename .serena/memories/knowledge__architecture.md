Updated 2026-03-06.

- Runtime is centered in `index.ts` with two Express apps:
  1. Streamable HTTP MCP server on `/mcp`
  2. Feedback UI server on `/`, `/session/:sessionId`, `/events`, `/feedback/history`, `/sessions`, and session mutation routes.
- MCP transport uses `StreamableHTTPServerTransport` with transient in-memory replay support only; replay history is not persisted to disk.
- Session/UI persistence is handled by `session-state-store.ts`, which stores minimal file-backed metadata in `.tasksync/session-state.json`:
  - latest/queued feedback
  - bounded submitted feedback history
  - session metadata
  - alias metadata
  - active UI session
- `stream-event-store.ts` provides the transient in-memory event store used for short-lived replay while the process remains alive.
- UI state is pushed via SSE from `/events`; server broadcasts UI state on session and waiter lifecycle transitions.
- UI target session resolution rule is: requested session if live, else active UI session if live, else first live session, else default session constant.
- Logging now supports:
  - compact structured logs via `logEvent(...)`
  - pretty debug request/response logs for MCP and UI traffic
  - request IDs and MCP method/result hints in debug mode
  - optional dual-write file logging via `TASKSYNC_LOG_FILE`
- Session-close semantics:
  - stream close clears waiter and logs closure, but does not delete session state
  - explicit MCP `DELETE /mcp` fully removes session state
  - UI `DELETE /sessions/:sessionId` also fully removes session state
  - closing the browser tab does not delete MCP sessions
- Current architectural follow-up: `index.ts` now carries substantial responsibilities (MCP lifecycle, UI routes, SSE state push, logging, persistence wiring) and could be split into smaller modules later.
