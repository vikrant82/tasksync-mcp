Updated: 2026-03-29

## Completed: Plugin Image Support + Session Prune Fix (March 2026)
- `opencode-tasksync@1.1.0`: best-effort image support for `get_feedback`
- Layer 1: save images to `$TMPDIR/tasksync-images/<sessionId>/image-N.<ext>` and return file paths in tool output
- Layer 2: experimental `experimental.chat.messages.transform` hook injects `FilePart` attachments via `data:` URIs
- Memory leak fixed by deleting processed image refs from `pendingImages`
- `tasksync-mcp-http@1.0.1`: plugin sessions are no longer auto-pruned during long gaps between feedback calls
- Root cause: `pruneStale()` only protected sessions with active `pendingWaiter`; plugin sessions lost protection after feedback delivery and could be pruned before next `get_feedback`
- Fix: protect sessions with no MCP transport (`!entry.transport`) from auto-prune; cleanup remains via plugin `session.deleted`, manual prune, or UI delete
- Docs updated: `README.md`, `docs/OPENCODE_PLUGIN.md`, `opencode-plugin/README.md`
- GitHub releases created: `v1.0.1` and `plugin-v1.1.0`

## Completed: OpenCode Plugin v1.0.0 (March 2026)
- Published to npm as `opencode-tasksync@1.0.0`
- Detached server architecture: thin HTTP client → server REST API
- Config hook: injects `daemon` agent + optional augmentation of existing agents
- Three doc files explain "why plugin over MCP" (agent augmentation advantage)
- Config: `.tasksync/config.json` (global `~/.tasksync/` + project `.tasksync/` + env vars)
- Key bug fixes: `res.on('close')` not `req`, prune resets activeUiSessionId
- Previous monorepo approach parked on `opencode-plugin` branch

## Completed: Simple Prune Integration (March 2026)
- Session auto-prune UI and backend integration landed earlier on main
