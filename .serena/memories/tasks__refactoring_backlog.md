# Refactoring & Test Backlog

Updated: 2026-04-20

## Architecture / Project Structure
- [x] Extract `SessionManager` from `src/index.ts`
- [x] OpenCode plugin (detached server architecture)
- [x] Project restructure under `src/`
- [x] Extract `logging.ts`
- [x] Extract `utils.ts`
- [x] Extract `src/ui-server.ts`
- [x] Extract `src/feedback-handler.ts`
- [x] Extract `src/mcp-server.ts`
- [x] Extract `src/feedback-state.ts`
- [x] Extract `src/alias-state.ts`
- [ ] Consider extracting the remaining prune/session-lifecycle cluster from `src/session-manager.ts`
- [ ] Consider splitting `src/channels.ts` into per-channel modules if that surface keeps growing

## Tests / Verification
- [ ] Unit tests for `AliasStateManager`
- [ ] Unit tests for `FeedbackStateManager`
- [ ] Unit tests for `SessionManager` session lifecycle and target-resolution behavior
- [ ] Integration tests for `get_feedback` / `check_interrupts`
- [ ] Integration tests for restart recovery from `.tasksync/session-state.json`
- [ ] Integration tests for prune behavior
- [ ] End-to-end smoke test for plugin interrupt flow after server restart

## Session Management
- [x] Configurable prune threshold
- [ ] Better stale/disconnected-session discovery beyond `lastActivityAt`

## UX Enhancements
- [ ] Confirmation dialog for Disconnect
- [ ] Keyboard shortcuts overlay (`?` / `Cmd+/`)
- [ ] Favicon badge / tab indicator when agent is waiting
- [ ] Session quick-switch dropdown
- [ ] History search/filter

## Notes
- The April 2026 refactor stream was intentionally behavior-preserving: no new validation branches, schema changes, or fallback changes were introduced.
- Latest verified checkpoint: `npm run build` passed after the `alias-state.ts` extraction.
- Highest-ROI next step is automated tests before any further structural decomposition.
