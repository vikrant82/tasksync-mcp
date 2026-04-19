# Current Todo

Updated: 2026-04-20

## Priority: Tests
- Add unit tests for `AliasStateManager`
- Add unit tests for `FeedbackStateManager`
- Add unit/integration coverage for `SessionManager` lifecycle and prune behavior
- Add integration tests for `get_feedback`, `check_interrupts`, recovery, prune behavior

## Priority: Refactoring Polish
- Extract shared feedback-wait protocol from `ui-server.ts` and `feedback-handler.ts`
- Reduce ~25 pass-through one-liners in `session-manager.ts` (consider exposing sub-managers)
- Return immutable copy from `FeedbackStateManager.getFeedbackState()`
- Add shutdown handle to `startMcpServer` (match `startUiServer` pattern)
- Deduplicate `__default__` constant (import from `session-manager.ts`)
- Remove dead `if (!hasActiveTimeout) {}` block in `pruneStale()`

## Priority: Stale Session Detection (deferred)
- Add `markDisconnected()` to SSE close handler in `ui-server.ts:593`
- Consider changing default `disconnectAfterMinutes` to nonzero
- Consider server-side liveness probe / agent heartbeat

## Status
- Server v1.6.0 and Plugin v1.4.0 released
- All changes committed and pushed to main
- Recommended: tests before more refactors
