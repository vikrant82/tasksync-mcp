# Refactoring Backlog

Updated: 2026-03-22

This tracks identified refactoring opportunities for the TaskSync codebase.

## Current State

`index.ts` is 1400+ lines with mixed concerns. Should be modularized.

## Planned Phases

### Phase 1: Extract `session-manager.ts` ✅ IN PROGRESS
Extract all session lifecycle logic into dedicated module:
- Session creation/destruction
- State management (`streamableSessions`, `feedbackStateBySession`)
- Prune logic (auto + manual)
- Health tracking (if retained)
- Clear APIs: `createSession()`, `closeSession()`, `pruneStale()`, `isWaiting()`, `getSession()`

Benefits: Single source of truth, testable, fixes current state bugs

### Phase 2: Extract `logging.ts`
Move all logging utilities:
- `logEvent()`, `logDebugPretty()`, `shouldLog()`, `appendLogLine()`
- `extractMcpDebugMeta()`, `normalizeDebugBody()`, `parseSseDebugBody()`
- `installDebugHttpLogging()`

Low risk, no state dependencies, easy win.

### Phase 3: Extract `alias-manager.ts`
Move alias inference and mapping:
- `slugifyForSessionId()`, `nextClientGeneration()`
- `normalizeAlias()`, `getSessionAlias()`
- `inferAliasFromInitializeBody()`, `reassociatePersistedStateForAlias()`
- `manualAliasBySession`, `inferredAliasBySession`, `clientGenerationByAlias` maps

### Phase 4: Extract `feedback-handler.ts`
Move feedback flow logic:
- `resolvePendingFeedback()`, `formatFeedbackResponse()`
- `appendFeedbackHistory()`
- Waiter management (pending waiter, queued feedback)

### Phase 5: Split servers
- `mcp-server.ts` — MCP transport, tool registration, `runStreamableHTTPServer()`
- `ui-server.ts` — Express routes, SSE, `startFeedbackUI()`

## Other Improvements

### Code Quality
- [ ] Add unit tests for session-manager
- [ ] Add unit tests for feedback flow
- [ ] Add integration tests for prune behavior

### Session Management
- [ ] Remove dangerous `resolveUiSessionTarget()` fallback chain
- [ ] Strict session targeting (error if session doesn't exist)
- [ ] Configurable prune threshold (from aggressive_prune branch)

### UI/UX
- [ ] Show clearer error when selected session doesn't exist
- [ ] Better visualization of session health/staleness
- [ ] Session filter/search for many sessions

### Performance
- [ ] Consider switching auto-prune interval based on session count
- [ ] Debounce rapid state broadcasts
