Updated: 2026-03-30

## Next Up: Layer 2 Image Investigation
- Layer 1 (temp files) is reliable — images saved to `$TMPDIR/tasksync-images/<sessionId>/`
- Layer 2 (experimental.chat.messages.transform hook) still broken — `context.metadata({ imageRef })` not surfacing on completed tool parts
- Related memory: `knowledge__mcp_image_support`

## Completed: SSE Plugin Transport + Session Resiliency (March 2026, branch `feat/sse-plugin-wait`)
- Replaced POST long-poll (`/api/wait/:sessionId`) with SSE (`GET /api/stream/:sessionId`)
- 30s keepalive comments prevent Bun/HTTP idle timeouts
- Server graceful shutdown: `activeSSEClients` registry, sends `event: closed` to all clients on SIGTERM/SIGINT
- Plugin `connectAndWait()` + retry loop with exponential backoff (1s → 15s cap)
- Only `context.abort` (user-initiated) or non-retryable close reasons stop the loop
- Tested: 9-min idle survival, server restart recovery (2-36s reconnect), feedback delivery over SSE
- Bug fix: `abortableSleep` in catch block moved to properly guarded position
- Docs updated: README, plugin README, OPENCODE_PLUGIN.md

## Completed: OpenCode Plugin v1.0.0 (March 2026)
- Published to npm as `opencode-tasksync@1.0.0`
- Detached server architecture: thin HTTP client → server REST API
- Config hook: injects `daemon` agent + optional augmentation of existing agents
- Config: `.tasksync/config.json` (global `~/.tasksync/` + project `.tasksync/` + env vars)
- Key bug fixes: `res.on('close')` not `req`, prune resets activeUiSessionId

## Completed: Simple Prune Integration (March 2026)
- SessionManager extraction from index.ts
- Bug fixes for double-message/redundant broadcasts
- Auto-prune + manual prune with UI support

## Completed: Image Support & UI Enhancements (March 2026)
- Full image pipeline (paste/drag/file → base64 → MCP ImageContent)
- Markdown toolbar, accessibility, two-column layout
- Session management UI (rename, prune, delete)
