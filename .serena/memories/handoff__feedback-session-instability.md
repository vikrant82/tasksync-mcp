# Date
2026-03-05

# Session Summary
We resumed the TaskSync daemon loop and focused on long-run instability where Copilot MCP sessions intermittently stop receiving feedback after async stream/SSE reconnect churn (`TypeError: terminated`). Earlier logs showed session invalidation and reconnect-driven session recreation, followed by cases where UI posted feedback but the waiting agent appeared stuck.

We confirmed that reconnect churn is normal on the client side, but server behavior needed hardening. We previously changed stream-close handling to avoid deleting sessions on transient stream closures, and made unknown-session `DELETE` idempotent to reduce stale cleanup noise. In this session, we identified a likely message-loss path: a pending `get_feedback` resolver can remain registered after stream termination, causing subsequent UI submissions to be logged as delivered to a dead waiter. That creates a false-positive delivery event and can strand the agent.

We implemented a targeted fix to clear stale pending waiters whenever transport closes or session is explicitly deleted, so future feedback is queued/retrievable instead of being routed to an orphaned waiter. We paused before running a full long-duration validation cycle.

# Immediate Goal
Validate that feedback is no longer lost during reconnect cycles and that delivery semantics shift from ghost `delivered.to_waiter` to `queued`/`return.queued` when waiters are stale.

# Completed
- Added session alias support and inferred aliases from MCP `initialize` client info.
- Added manual alias API and UI rename flow:
  - `POST /sessions/:sessionId/alias`
  - UI `Rename` action and alias display.
- Hardened transient disconnect handling:
  - Stream `onclose` no longer auto-deletes session state.
- Made stale `DELETE /mcp` idempotent for unknown session IDs.
- Added stale waiter cleanup logic:
  - `clearPendingWaiter(sessionId, reason)`
  - invoked on stream close and explicit delete.
- Added waiter/session correlation instrumentation in `index.ts`:
  - each `get_feedback` wait now gets a `waitId` and `waitStartedAt`
  - queued feedback now records `queuedAt` and logs queue duration on return
  - session entries now track `transportId`, `clientAlias`, and `clientGeneration`
  - session create/reuse/stream-close/explicit-delete logs include transport/client metadata
  - waiter clear/deliver/return logs include wait metadata and durations
- Rebuilt successfully after each patch (`npm run build`).

# Open Loops
- Current leading hypothesis from latest server logs: the dominant failure mode may be MCP session ID rollover during reconnect (`old session closed` -> `new session created`), not necessarily stale waiter delivery on the same session.
- Need empirical validation over >=1 reconnect interval with real Copilot client traffic:
  - Confirm whether fresh reconnects reuse the same session ID or rotate to a new one.
  - If session rotates, confirm whether UI remains targeted to the old session while Copilot starts waiting on the new one.
  - Confirm no more feedback loss after `mcp.session.stream.closed`.
  - Confirm presence/behavior of `feedback.waiter.cleared` logs.
  - Confirm queued submissions are eventually consumed via `feedback.return.queued`.
- Best validation recipe for next run:
  - start from a fresh session,
  - note the initial session ID,
  - when disconnect happens, capture the next `mcp.session.created` / `mcp.session.closed` lines,
  - after any `feedback.queued`, capture the very next `feedback.waiting` or `feedback.return.queued` lines,
  - record whether the UI route-target session ID still matches the active Copilot session.
- Optional future hardening:
  - Add client-identity rollover migration (old session -> new session) for queued feedback continuity if the client rotates sessions aggressively.
  - Add status endpoint for faster diagnosis (`GET /sessions/:id/status`).

# Key Decisions
- Need empirical validation over >=1 reconnect interval with real Copilot client traffic:
  - Confirm no more feedback loss after `mcp.session.stream.closed`.
  - Confirm presence/behavior of `feedback.waiter.cleared` logs.
  - Confirm subsequent submissions are `feedback.queued` then `feedback.return.queued` when appropriate.
- Optional future hardening:
  - Add client-identity rollover migration (old session -> new session) for queued feedback continuity if the client rotates sessions aggressively.
  - Add status endpoint for faster diagnosis (`GET /sessions/:id/status`).

# Key Decisions
- Treat stream closure as transient transport churn, not authoritative session death.
- Keep explicit session delete as the only canonical session teardown path.
- Prefer queueing over resolving uncertain waiters to avoid silent feedback loss.

# Files Modified
- `index.ts`
  - Added alias maps, alias inference, alias endpoint and session payload alias.
  - Changed stream close/delete lifecycle behavior.
  - Added idempotent delete-missing path.
  - Added stale waiter clearing (`feedback.waiter.cleared`).
- `feedback-html.ts`
  - Added alias-first session rendering + `Rename` button and rename workflow.
- `feedback-server.ts`
  - Added standalone alias compatibility and alias endpoint.
- `docs/API_SPEC.md`
  - Documented alias endpoint and alias response field.
- `docs/FEEDBACK_UI_GUIDE.md`
  - Documented rename/alias UX behavior.

# Next Memories to Load
- `knowledge__architecture`
- `knowledge__streamable_http_sessions`
- `knowledge__feedback_ui_ux`
- `handoff__feedback-session-instability`

# Resumption Prompt
Resume instability validation with running TaskSync server and Copilot MCP client connected to `http://localhost:3011/mcp`. New instrumentation is now available in server logs: `waitId`, `waitStartedAt`, `queuedAt`, `transportId`, `clientAlias`, and `clientGeneration` are attached to wait/deliver/clear/return/session lifecycle events. Watch for this sequence: (1) `feedback.waiting` with `waitId`, (2) reconnect churn (`mcp.session.stream.closed`), (3) `feedback.waiter.cleared` for the same `waitId` if a waiter existed, then submit feedback from UI to same route-target session. If feedback queues, confirm the next `feedback.return.queued` includes the same `queuedAt`. If the client rotates session IDs, compare `clientAlias` and `clientGeneration` across `mcp.session.created`, `mcp.session.reused`, `mcp.session.stream.closed`, and `mcp.session.closed` to determine whether the same Copilot client is rolling over sessions. If loss still occurs, use the new IDs to identify whether delivery happened to an old waiter, an old transport generation, or the wrong session ID. Re-run `npm run build` after any edits.

# Raw Artifacts
- Additional server log evidence from 2026-03-05 shows clear reconnect/session-rollover correlation:
  - `11:08:38 feedback.waiting` on session `5fd6b47c-9737-41ca-a18e-9035c4854a5a`
  - `11:09:00 mcp.session.stream.closed` for that same session
  - immediately followed by `11:09:00 mcp.session.closed reason=explicit_delete`
  - then `11:09:00 mcp.session.created` with new session `e80fce28-4f7a-4ca7-8870-a8b28e87dbd2`
- This indicates the client/server pair is not only reconnecting transport, but rotating MCP session IDs across that event.
- Subsequent live delivery on the new session was healthy:
  - `11:11:19 feedback.waiting`
  - `11:12:29 ui.feedback.post`
  - `feedback.delivered.to_waiter`
  - `feedback.return.live`
- Another healthy live cycle occurred at `11:18:22 -> 11:25:29` on the same new session.
- At `11:26:55`, feedback for session `e80fce28-4f7a-4ca7-8870-a8b28e87dbd2` was `feedback.queued`, which by itself is not failure; it means no waiter was active at submit time. The confirming follow-up log to look for is the next `feedback.return.queued` when the agent calls `get_feedback` again.
- Missing from this log slice: any `feedback.waiter.cleared` entries and any per-wait/request correlation IDs, so it is still impossible to prove whether a stale waiter survived a disconnect in this specific sample.


- Client log pattern (reconnect churn):
  - `Error reading from async stream, we will reconnect: TypeError: terminated`
  - recurring roughly every ~5 minutes.
- Server log examples during churn:
  - `mcp.session.stream.closed`
  - `mcp.session.closed reason=explicit_delete`
  - `mcp.session.created ...`
  - `feedback.waiting` / `ui.feedback.post` / `feedback.delivered.to_waiter` / `feedback.return.live`
  - problematic case observed earlier: feedback posted when no active waiter resulted in `feedback.queued`.
- Latest fix introduced:
  - `feedback.waiter.cleared` emitted on stream close/delete when waiter existed.
