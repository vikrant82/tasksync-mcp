Date: 2026-03-06

Session Summary:
This session continued the long-running session resurrection/client stability stream, but most coding work focused on hardening observability and the feedback UI while keeping the core transport investigation active. Implemented optional file logging, pretty debug request/response logging with request IDs and MCP method/result hints, structured SSE response parsing in logs, simplified `get_feedback` schema to no args, reduced persisted session-file scope to minimal metadata, added bounded per-session submitted feedback history, redesigned the feedback UI to use SSE instead of polling, fixed stale target-session routing in the UI, added waiter-lifecycle SSE broadcasts, improved history UX (collapse, internal scroll, jump-to-latest, compact timestamps), updated the standalone `feedback-server.ts` to match the newer UI contract, and removed redundant `GET /feedback` reads from the UI servers. Repeated `npm run build` checks passed.

Near the end, user reported the real unresolved issue: after a very long idle period (~1 hour), feedback submitted from the UI did not reach the agent tool, and the user manually reconnected MCP from the agent. Review of the latest `tasksync.log` tail gives a strong clue: the old session still had a pending waiter that the server resolved successfully after ~71 minutes, but the client apparently did not receive/use that response; shortly afterward a brand-new session initialize occurred while the old session was still alive in server memory. There are no `mcp.session.stream.closed` / `mcp.session.closed` logs for the old session before the new session appears. That strongly suggests the long-lived client-side request/stream for the old session may have died silently without the server noticing, leaving a stale live waiter that accepted UI feedback but no longer had a viable client on the other end.

Immediate Goal:
Next session should focus directly on the long-idle disconnection issue, using the fresh clue from `tasksync.log`: investigate why a stale waiter on the old session remained considered live, why no close/clear event fired, and how to detect/clear abandoned long-lived waits when the client silently disconnects or reconnects.

Completed:
- Added optional file logging via `TASKSYNC_LOG_FILE` (`index.ts`).
- Added pretty debug HTTP request/response logging with request IDs and MCP method extraction (`index.ts`).
- Added SSE response-body parsing in logs and fixed typed-array response decoding (`index.ts`).
- Moved debug logging middleware after body parsing so request bodies can be logged (`index.ts`).
- Simplified `get_feedback` schema to no arguments (`index.ts`).
- Reduced `.tasksync/session-state.json` to minimal persisted session/user-feedback metadata (`session-state-store.ts`).
- Kept replay transient/in-memory only (`stream-event-store.ts`).
- Added bounded per-session submitted feedback history and `/feedback/history` (`index.ts`, `session-state-store.ts`).
- Redesigned UI to two-column layout with sessions/settings right sidebar and history on the left (`feedback-html.ts`).
- Replaced polling with SSE `/events` for live UI updates (`index.ts`, `feedback-html.ts`).
- Fixed stale UI target-session bug by resolving targets against live sessions and tracking per-client SSE targets (`index.ts`).
- Added waiter-lifecycle `broadcastUiState(...)` hooks so waiting-state changes push immediately (`index.ts`).
- Added history UX improvements: collapsible scroll area, jump-to-latest button, compact timestamps (`feedback-html.ts`).
- Updated standalone `feedback-server.ts` to support `/events` and `/feedback/history`.
- Removed redundant GET `/feedback` endpoint from both embedded and standalone UI servers.
- Updated user-facing docs/examples for `/events` and `/feedback/history`.
- Consolidated durable Serena memories and deleted noisy scratch/temp memories.
- Repeatedly verified with `npm run build`.

Open Loops:
- Main blocker: long-idle old session seems to keep a stale pending waiter alive even when the client no longer effectively receives the response.
- Need to investigate whether `transport.onclose`, request abort/close events, or some missing request-lifecycle hook should clear pending waiters for abandoned long-lived `get_feedback` calls.
- Manual validation of the newer SSE UI and file logging remains useful, but the primary next step is transport diagnosis.
- `index.ts` remains large and could be refactored later, but that is lower priority than the disconnect bug.

Key Decisions:
- Replay history is not persisted to disk; only minimal session/user-feedback metadata is durable.
- SSE, not WebSocket, is the primary UI live-update mechanism.
- `/feedback` is POST-only for submission; reads now go through `/feedback/history` or SSE state.
- UI history is the primary view of current feedback context; redundant latest-feedback panel was removed.
- Current diagnosis direction shifted back toward transport/request-lifecycle correctness rather than more UI work.

Files Modified:
- `index.ts`
- `feedback-html.ts`
- `feedback-server.ts`
- `session-state-store.ts`
- `stream-event-store.ts`
- `README.md`
- `docs/API_SPEC.md`
- `docs/SESSION_WORKFLOW.md`
- `docs/examples/client-configs.md`
- `docs/examples/http-endpoints.curl.md`
- `docs/examples/multi-session-flow.curl.md`
- `task-sync-agent-opencode.md`
- Serena memory files updated/added: `handoff__session_resurrection_and_client_stability`, `knowledge__architecture`, `knowledge__project_overview`, `knowledge__feedback_ui_ux`, `tasks__todo`, `logs__2026-03-06__active_state`, `tasks__completion_checklist`, and updated older `handoff__feedback-session-instability`

Next Memories to Load:
- `knowledge__architecture`
- `knowledge__project_overview`
- `knowledge__feedback_ui_ux`
- `tasks__todo`
- `logs__2026-03-06__active_state`

Resumption Prompt:
Resume by focusing on the long-idle disconnect bug, not more UI polish. Start from the recent log clue: old session `30ea4c58-f709-45fc-9925-f72eefec8e56` entered `feedback.waiting` at `2026-03-06T15:37:36.352Z`, then at `2026-03-06T16:48:57.006Z` the UI posted feedback to that same old session and the server logged `feedback.delivered.to_waiter` with `waitDurationMs: 4280656`, meaning the server still believed the waiter was live after ~71 minutes. Then at `2026-03-06T16:49:35.497Z` a brand-new session `2b5450ac-aa6b-427d-9844-970e3038b6b5` was initialized manually from the agent (`clientGeneration: 3`) while the old session still existed (`activeSessions: 2`). Search for why the old session never logged `mcp.session.stream.closed`, `feedback.waiter.cleared`, or `mcp.session.closed` before this reconnect. Investigate whether long-lived `POST /mcp` tool calls can silently die without triggering transport `onclose`, and whether Express/Node request `close` / `aborted` / response `close` handling should clear the waiter. Re-read `runStreamableHTTPServer`, `resolvePendingFeedback`, `clearPendingWaiter`, and `registerServerHandlers`, then inspect whether the SDK’s long-lived request semantics expose a better hook than transport close.

Raw artifacts:
- Commit-worthy build command used repeatedly: `npm run build`
- File logging example: `TASKSYNC_LOG_LEVEL=debug TASKSYNC_LOG_FILE=/tmp/tasksync.log node dist/index.js --port=3011 --ui-port=3457`
- Repeated daemon transport error during this session: `McpError: MCP error -32000: Connection closed`
- Key log lines from `tasksync.log`:
  - `2026-03-06T15:37:36.352Z` `feedback.waiting` old session `30ea4c58-f709-45fc-9925-f72eefec8e56`, waitId `ecadeddc-f357-43c2-99d4-76fb27d5d782`
  - `2026-03-06T16:48:57.006Z` `ui.feedback.post` requested/target session `30ea4c58-f709-45fc-9925-f72eefec8e56`, contentLength `1942`
  - `2026-03-06T16:48:57.008Z` `feedback.delivered.to_waiter` same old session, same waitId, `waitDurationMs: 4280656`
  - `2026-03-06T16:49:35.497Z` `mcp.session.created` new session `2b5450ac-aa6b-427d-9844-970e3038b6b5`, `clientGeneration: 3`, `activeSessions: 2`
  - There are no corresponding old-session `mcp.session.stream.closed`, `feedback.waiter.cleared`, or `mcp.session.closed` lines before the new session appears in the tail.
- Tail snippet clue: after new session creation, repeated POST/GET reuse the new session normally (`mcp.session.reused` for `2b5450ac-aa6b-427d-9844-970e3038b6b5`), but the log no longer shows any server-side close record for the abandoned old session.
- Current `/health` persistence string: `file-backed minimal session state; transient in-memory replay`
