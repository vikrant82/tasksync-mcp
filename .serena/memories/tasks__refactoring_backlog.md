# Refactoring & Enhancement Backlog

Updated: 2026-04-02

## Architecture / Project Structure
- [x] Extract SessionManager from index.ts
- [x] OpenCode plugin (detached server architecture)
- [x] **Project restructure** — all source under `src/`, UI under `src/ui/`
- [x] Extract logging.ts (logEvent, debug logging, file logging)
- [x] Extract utils.ts (formatFeedbackResponse, normalizeAlias, slugify, inferAlias)
- [ ] Extract alias-manager.ts (generation counter, alias CRUD from session-manager)
- [ ] Extract feedback-handler.ts (waiter management from index.ts)
- [ ] Split index.ts into mcp-server.ts + ui-server.ts
- [ ] Extract channels.ts could move to channels/ directory with per-channel files

## Code Quality
- [ ] Unit tests for SessionManager
- [ ] Unit tests for feedback flow
- [ ] Integration tests for prune behavior
- [x] Review auto-prune constants — now: 1min interval, configurable threshold via UI, default "Never"

## Session Management
- [x] Configurable prune threshold — UI dropdown (Never/5/10/20/30/60/120/1440 min), default Never
- [ ] Better stale/disconnected-session discovery (connection-health signals beyond lastActivityAt)

## UX Enhancements
- [ ] Confirmation dialog for Disconnect
- [ ] Keyboard shortcuts overlay (? or Cmd+/)
- [ ] Favicon badge / tab indicator when agent waiting
- [ ] Session quick-switch dropdown
- [ ] History search/filter

## Invariants (established)
- SessionManager owns all state broadcasting via `events.onStateChange()`
- `appendHistory` called only by POST `/feedback` handler
