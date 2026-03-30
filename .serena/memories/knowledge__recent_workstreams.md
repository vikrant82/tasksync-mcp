Updated: 2026-03-30

## Completed: Remote Mode / Telegram Notifications (March 2026, PR #5)
- Channel abstraction: `NotificationChannel` interface + `ChannelManager` dispatcher
- Telegram: grammY bot with `/start` registration, chat ID persistence, inline keyboards
- Plugin captures agent text via `experimental.text.complete` hook, sends as `X-Agent-Context` header
- Per-session `remoteEnabled` toggle in feedback UI
- Bug fixes: base64-encode header (newlines), use text.complete instead of event hook (async timing)
- Config: `TASKSYNC_TELEGRAM_BOT_TOKEN` env / `--telegram-token` CLI, `.env` support via dotenv

## Completed: Native Image Injection (March 2026, PR #4)
- Root-caused Layer 2 failure: `fromPlugin()` discards callback metadata, `experimental.chat.messages.transform` never saw `imageRef`
- Switched to `tool.execute.after` hook — injects `FilePart` attachments with PartBase fields directly on tool result
- First attempt failed: missing id/sessionID/messageID fields → zod validation error. Fixed by generating PartBase-compliant IDs.
- Removed Layer 1 (temp files) — redundant after native injection works. Preserved in `ref/layer1-temp-files` branch.
- Related memory: `knowledge__mcp_image_support`, `knowledge__layer1_temp_files`

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
