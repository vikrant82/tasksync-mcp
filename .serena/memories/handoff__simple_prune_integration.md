# Handoff: Simple Prune Integration

**Date:** 2026-03-24

## Session Summary

Fixed two regressions on `simple-prune` branch that were caused by the SessionManager integration (done 2026-03-22). User reported "two messages visible in task-sync web UX on every feedback submit."

### Investigation findings:
1. **Double messages bug** — `appendHistory` was called twice per feedback: once in POST `/feedback` handler (line 897) and again in `resolvePendingFeedback` (line 473). Both pushed to the same `state.history` array.
2. **Redundant broadcasting** — SessionManager methods all call `this.events.onStateChange()` internally (which maps to `broadcastUiState`), but index.ts callers ALSO called `broadcastUiState` explicitly after every SessionManager call. This caused 2-3x broadcast spam per mutation.

### Fixes applied (commit `c4220c2`):
- Simplified `resolvePendingFeedback` to just call `deliverFeedback` and return result — removed redundant `appendHistory` and `broadcastUiState`
- Removed ALL 14 redundant `broadcastUiState` calls from index.ts callers
- Only surviving `broadcastUiState` call sites: function definition (line 307) and SessionManager event hook (line 948)
- Build passes, pushed to `origin/simple-prune`

## Immediate Goal

Branch is functional — needs manual UX testing to confirm double-message bug is resolved.

## Completed

- ✅ SessionManager integration (2026-03-22, commit `23fa631`)
- ✅ Fix duplicate appendHistory in feedback flow (2026-03-24, commit `c4220c2`)
- ✅ Fix redundant broadcastUiState calls — SessionManager now owns all broadcasting (2026-03-24, commit `c4220c2`)
- ✅ Build passes

## Open Loops

- Manual UX testing to confirm double-message fix
- Review `entry` fallback object (index.ts lines 1073-1082) — creates local StreamableSessionEntry not registered with SessionManager
- Review facade accessor functions for correctness
- Auto-prune constants changed from main: 4h→10min threshold, 5min→1min interval — may be too aggressive
- Debounce rapid state broadcasts (performance concern with many sessions)

## Key Decisions

1. SessionManager owns ALL state broadcasting via `this.events.onStateChange()` — callers must NOT also call `broadcastUiState()`
2. `appendHistory` ownership: called by POST `/feedback` handler only (not by `resolvePendingFeedback`)
3. Facade functions retained for gradual migration (future phases will remove them)

## Files Modified

- `index.ts` — Bug fix commit: 1 insertion, 21 deletions (removed redundant calls)

## Next Memories to Load

- `knowledge__architecture` — Core architecture details
- `knowledge__feedback_ui_ux` — UI behavior details
- `tasks__refactoring_backlog` — Future refactoring plans

## Resumption Prompt

The `simple-prune` branch has two commits on top of main (`fecc23d`):
1. `23fa631` — SessionManager integration refactor
2. `c4220c2` — Bug fix for double messages + redundant broadcasts

Key architectural invariant: **SessionManager methods broadcast internally** via `events.onStateChange()`. Index.ts callers must NOT call `broadcastUiState()` after SessionManager method calls. The only two `broadcastUiState` sites are the function definition and the SessionManager event hook at line 948.

Next steps: manual testing, review open loops above, or merge to main when confident.
