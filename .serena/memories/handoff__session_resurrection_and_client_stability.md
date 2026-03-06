Date: 2026-03-06

Session Summary:
Investigated the long-idle feedback/session instability path and confirmed the likely root cause is stale `get_feedback` waiters tied to abandoned long-lived POST/SSE requests. The MCP SDK (`@modelcontextprotocol/sdk` 1.25.2 installed) does not fire transport `onclose` for a single abandoned POST request; `onclose` is for whole transport closure. TaskSync previously only cleared waiters from transport `onclose` or explicit delete flows, so a dead request could leave `pendingWaiter` live for a long time and consume later UI feedback. Implemented a server-side fix in `index.ts` to track waiter ownership by raw HTTP request and clear only the owning waiter on request abort/response close.

Immediate Goal:
Validate the new per-request waiter cleanup logic with a fresh-log repro and confirm abandoned waits no longer steal future feedback.

Completed:
- Inspected `index.ts` waiter/session lifecycle around `resolvePendingFeedback`, `clearPendingWaiter`, `registerServerHandlers`, and `runStreamableHTTPServer`.
- Inspected installed MCP SDK transport internals under `node_modules/@modelcontextprotocol/sdk/dist/esm/server/*` and confirmed lack of public per-request cancellation hooks in tool handlers.
- Updated `index.ts` to import `AsyncLocalStorage` and maintain a request-scoped `requestId`.
- Updated `FeedbackChannelState.pendingWaiter` to include `requestId` and resolve a discriminated `PendingFeedbackResult` instead of a raw string.
- Added `attachPendingWaiterCleanup(req, res, sessionId, requestId)` to listen for `req.aborted` and `res.close`, logging `mcp.request.aborted` / `mcp.request.closed` and clearing only the owning waiter.
- Updated `clearPendingWaiter(sessionId, reason, expectedRequestId?)` to support ownership checks, actively resolve the waiter with `{ type: "closed", reason }`, and log `requestId`.
- Updated `resolvePendingFeedback(...)` to resolve waiters with `{ type: "feedback", content }` and include waiter `requestId` in logs.
- Updated `get_feedback` handling to use request-aware waiter setup, return an interrupted waiting message when a request-owned waiter is cleared, and preserve existing timeout behavior.

Open Loops:
- No build/test run has been performed in this session.
- Need to verify there are no type/runtime regressions from the new `PendingFeedbackResult` flow.
- Need clean-room repro with fresh logs and sessions to confirm stale waiters are cleared on client disconnect.
- Need to confirm whether `res.close` with `writableEnded=true` should always clear the waiter or whether some paths produce a harmless post-response cleanup log.

Key Decisions:
- Fix at raw Express request lifecycle level rather than relying on SDK tool handler metadata, because SDK `extra` only exposes `sessionId` and transport `onclose` is too coarse.
- Use per-request ownership (`requestId`) so an older disconnected request cannot clear a newer retried waiter for the same session.
- Resolve cleared waiters with a synthetic closed/interrupted result so suspended async handlers do not leak forever.

Files Modified:
- `index.ts` — added per-request waiter ownership, request lifecycle cleanup, and interrupted-wait result handling.

Next Memories to Load:
- `handoff__session_resurrection_and_client_stability`
- `knowledge__architecture`
- `tasks__todo`

Resumption Prompt:
Resume on the session resurrection/client stability stream. Start by reviewing the new `index.ts` changes around `PendingFeedbackResult`, `attachPendingWaiterCleanup`, `clearPendingWaiter`, and the `get_feedback` wait path. Then run a focused verification pass: inspect git diff, build if appropriate, and reproduce the prior long-idle failure from a clean state. The important check is whether an abandoned old POST request now logs `mcp.request.aborted` or `mcp.request.closed` followed by `feedback.waiter.cleared` with a matching `requestId`, and whether later UI feedback is queued or delivered only to the active waiter rather than disappearing into the stale one. If regressions appear, pay close attention to double-resolution risk and to `res.close` firing after normal successful responses.

Raw artifacts:
- Root cause conclusion: stale `pendingWaiter` was previously cleared only by transport `onclose` / explicit delete, but SDK transport `onclose` is not a per-request disconnect signal.
- New log events introduced/used for diagnosis: `mcp.request.aborted`, `mcp.request.closed`, `feedback.wait.interrupted`, augmented `feedback.waiting`, `feedback.delivered.to_waiter`, `feedback.waiter.cleared` with `requestId`.
- Prior failure evidence from memory: old session waiter persisted ~71 minutes before UI feedback was delivered to it, after which a new session initialized separately.