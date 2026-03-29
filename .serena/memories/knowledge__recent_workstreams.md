Updated: 2026-03-28

## Next Up: Plugin Image Support
- Plugin `get_feedback` returns text only (OpenCode tool limitation: `execute()` returns `Promise<string>`)
- MCP path already supports full `ImageContent` blocks
- Need to explore: can images be injected via `client.session.prompt()` SDK, or base64-encoded in text?
- Related memory: `knowledge__mcp_image_support`

## Completed: OpenCode Plugin v1.0.0 (March 2026)
- Published to npm as `opencode-tasksync@1.0.0`
- Detached server architecture: thin HTTP client → server REST API
- Config hook: injects `daemon` agent + optional augmentation of existing agents
- Three doc files explain "why plugin over MCP" (agent augmentation advantage)
- Config: `.tasksync/config.json` (global `~/.tasksync/` + project `.tasksync/` + env vars)
- Key bug fixes: `res.on('close')` not `req`, prune resets activeUiSessionId
- Previous monorepo approach parked on `opencode-plugin` branch

## Completed: Simple Prune Integration (March 2026)
- SessionManager extraction from index.ts
- Bug fixes for double-message/redundant broadcasts
- Auto-prune + manual prune with UI support

## Completed: Image Support & UI Enhancements (March 2026)
- Full image pipeline (paste/drag/file → base64 → MCP ImageContent)
- Markdown toolbar, accessibility, two-column layout
- Session management UI (rename, prune, delete)
