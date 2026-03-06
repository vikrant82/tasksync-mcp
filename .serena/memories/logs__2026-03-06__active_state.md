Stable consolidated log for 2026-03-06:
- Build currently passes.
- Embedded UI uses SSE `/events` and `/feedback/history`.
- `/feedback` is now POST-only submission endpoint.
- File logging is optional via `TASKSYNC_LOG_FILE`.
- Debug logging includes request IDs, pretty request/response payloads, MCP method hints, structured SSE body parsing, and now request-body logging runs after body parsers.
- Stale routed-session bug in SSE UI was fixed.
- HAR-driven waiter broadcast hooks were added.
- Remaining operational issue: daemon-loop feedback polling intermittently sees `MCP error -32000: Connection closed` and can block the loop itself.
