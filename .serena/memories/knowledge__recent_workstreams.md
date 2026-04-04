Updated: 2026-03-31

## Completed: Remote Mode / Telegram Notifications (March 2026, PR #5)
- Channel abstraction: `NotificationChannel` interface + `ChannelManager` dispatcher
- Telegram: grammY bot with `/start` registration, chat ID persistence, inline keyboards
- Plugin captures agent text via `experimental.text.complete` hook, sends as `X-Agent-Context` header
- Per-session `remoteEnabled` toggle in feedback UI (persisted across restarts)
- FYI status notifications: 30s timer in plugin, POST `/api/status/:sessionId` → Telegram
- Multi-message splitting (4000 char Telegram limit), markdown→HTML conversion
- Reply-to routing for multi-session Telegram support
- Bug fixes: base64-encode header (newlines), text.complete hook (async timing), sanitizer hydration
- Config: `TASKSYNC_TELEGRAM_BOT_TOKEN` env / `--telegram-token` CLI, `.env` support via dotenv

## Completed: Documentation Overhaul (March 2026)
- Main README rewritten: punchy lead, OpenCode plugin spotlight, "how hooks enable features" section
- Plugin README rewritten for npmjs landing page: feature list, concise "how it works"
- GitHub repo: updated description, 10 topics, homepage URL set
- Releases: Server v1.1.0 "Always Connected", Plugin v1.2.0 "Unbreakable"

## Completed: Show Assistant Messages in Feedback UI (April 2026, PR #7)
- Display agent's last message (agentContext) in primary feedback web UI, not just Telegram
- Gated behind "Show assistant messages" checkbox in Settings (localStorage-persisted, off by default)
- Backend: setAgentContext broadcasts SSE state, buildUiStatePayload includes agentContext, FYI endpoint stores context
- Frontend: collapsible HTML panel between wait-banner and composer, CSS for dark/light themes, JS logic with localStorage persistence
- UX: Enable via Settings → "Show assistant messages" checkbox. Panel shows below wait banner with last agent message, collapse/expand toggle.

## Completed: Telegram Message Improvements (April 2026, PR #7)
- Removed unreachable "Open in browser" localhost link from Telegram notifications and FYI messages
- Added session alias display — shows alias from getSessionAlias() fallback chain (manual → inferred → clientAlias → truncated ID)
- Removed `feedbackUrl` from `NotificationParams`/`FYIParams` interfaces, replaced with `sessionAlias?: string`
- Cleaned up `buildKeyboard()` (removed unused `_feedbackUrl` param)
- Updated all 3 call sites in index.ts

## Completed: Auto-Prune Overhaul (April 2026, PR #7)
- Fixed: `pruneStale()` unconditionally skipped plugin sessions (legacy "stateless HTTP" comment). Now all sessions equal, pruned by `lastActivityAt`.
- Fixed: Auto-prune used manual cleanup instead of `deleteSession()` — leaked transport/alias/state. Now uses proper `deleteSession()`.
- Made `pruneStale()` async with `pruning` guard flag to prevent concurrent runs.
- Added "Never" (0) option to auto-prune dropdown; made it the default (was 20 min).
- FYI/agent context updates now reset stale timer: `setAgentContext()` calls `markActivity()` when context non-null.
- Stale threshold reduced from 1h to 30min for UI stale badge, prune button, and manual prune confirm.
- Updated docs: SESSION_WORKFLOW.md, API_SPEC.md, FEEDBACK_UI_GUIDE.md.
- Removed dead duplicate constants (`MIN_DISCONNECT_AFTER_MINUTES`, `MAX_DISCONNECT_AFTER_MINUTES`) from index.ts.

## Completed: Source Restructuring (April 2026, PR #8)
- All source moved to `src/`, UI templates to `src/ui/` with shorter names
- Extracted `src/logging.ts` (logging infra + debug HTTP middleware) and `src/utils.ts` (pure helpers) from monolithic index.ts
- Dead code removed: `lib.ts`, `path-utils.ts`, `path-validation.ts`, `roots-utils.ts`, `__tests__/`, `jest.config.cjs` + unused deps
- Build config updated: `tsconfig.json` rootDir → `src/`, cleaned package.json
- No API/behavior changes — fully backward compatible
- Released as Server v1.3.0 (bundled with agent context markdown + bug fixes from same branch)

## Completed: Agent Context Markdown + Bug Fixes (April 2026, PR #8)
- Agent context panel now renders markdown (was plain text)
- Source-specific headings: "Agent status update" (FYI) vs "Last assistant message" (assistant)
- Bug fix: remote toggle button disappeared after click (`/sessions` GET missing `channelsAvailable`)
- Bug fix: CSS pulse animation CPU burn → GPU-composited opacity animation
- Telegram feedback replies now show session alias

## Next Up
- Stabilization: end-to-end testing of all features
- Consider further index.ts extraction (alias-manager, feedback-handler, mcp-server split)

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
