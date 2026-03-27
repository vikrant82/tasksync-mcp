Updated: 2026-03-27

## Active: OpenCode Plugin (Detached Server Architecture)
- Branch: `simple-prune`
- Status: **Working** — tested successfully, feedback loop holds open correctly
- Server-side: `res.on('close')` for client disconnect (NOT `req` — Express body parser consumes `req` stream)
- Plugin: `opencode-plugin/` — thin HTTP client connecting to server REST API
- Config: `.tasksync/config.json` (global `~/.tasksync/` + project `.tasksync/`) with env var overrides
- Bug fixed: `req.on('close')` fired immediately (1ms) → changed to `res.on('close')` for proper long-poll
- Bug fixed: `pruneStale()` now resets `activeUiSessionId` when active session is pruned
- Docs: README, OPENCODE_PLUGIN.md, API_SPEC.md, SESSION_WORKFLOW.md all updated
- Previous monorepo approach parked on `opencode-plugin` branch

## Completed: Simple Prune Integration (March 2026)
- SessionManager extraction from index.ts
- Bug fixes for double-message/redundant broadcasts
- Auto-prune + manual prune with UI support

## Completed: Image Support & UI Enhancements (March 2026)
- Full image pipeline (paste/drag/file → base64 → MCP ImageContent)
- Markdown toolbar, accessibility, two-column layout
- Session management UI (rename, prune, delete)
