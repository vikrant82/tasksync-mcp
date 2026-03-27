# Refactoring & Enhancement Backlog

Updated: 2026-03-27

## Architecture
- [x] Extract SessionManager from index.ts
- [x] OpenCode plugin (detached server architecture)
- [ ] Extract logging.ts (logEvent, debug logging, file logging)
- [ ] Extract alias-manager.ts (slugify, generation counter, alias CRUD)
- [ ] Extract feedback-handler.ts (waiter management, formatFeedbackResponse)
- [ ] Split index.ts into mcp-server.ts + ui-server.ts

## Code Quality
- [ ] Unit tests for SessionManager
- [ ] Unit tests for feedback flow
- [ ] Integration tests for prune behavior
- [ ] Review auto-prune constants (4h threshold, 5min interval)

## Session Management
- [ ] Configurable prune threshold
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
