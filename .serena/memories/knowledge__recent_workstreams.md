Updated: 2026-04-11

## Completed: Version Display + Auto Session Naming (April 2026, PR #11)
- Server version now appears in startup logs, MCP init, `/health`, and feedback UI footer
- Plugin version logs on initialization
- Added `POST /sessions/:sessionId/title` endpoint for inferred aliases from OpenCode session titles
- Released as Server v1.4.0 and Plugin v1.3.0

## Completed: Feedback Defaults + Session Title Cleanup (April 2026, PR #12)
- Fixed persisted auto-prune bug: selecting `Never` now stays disabled after reload instead of drifting back to 10 minutes
- Feedback composer now separates quick replies (`Approve`, `Continue`) from the primary `Send Feedback` action so button priority is clearer while an agent is waiting
- Plugin ignores or trims bootstrap/orientation titles before syncing inferred aliases, so session names better reflect the actual task
- Added deferred title sync path that re-registers the plugin session before retrying title updates
- Released as Server v1.4.1 and Plugin v1.3.1

## Completed: Preserve Built-in Prompts During Augmentation (April 2026, PR #10)
- Fixed: `augmentAgents` was replacing built-in agent prompts (OpenCode treats `agent.prompt` as full override)
- Daemon overlay now appended at runtime via `experimental.chat.system.transform` hook
- `activeAgentBySession` Map tracks agent per session (set by `chat.message` / `message.updated`)
- Wildcard `"*"` auto-includes built-ins (`ask`, `build`, `plan`, `general`)

## Completed Earlier (March-April 2026)
- Telegram remote mode, FYI updates, assistant-message panel, session alias display in Telegram
- Auto-prune overhaul, source restructuring, agent context POST migration, native image injection, SSE plugin transport/recovery, initial OpenCode plugin release

## Documentation / Knowledge Follow-up
- Closeout on 2026-04-11 corrected stale docs that still mentioned plugin long-poll `POST /api/wait/:sessionId`; current plugin flow is SSE via `GET /api/stream/:sessionId`
- `SESSION_WORKFLOW.md`, `API_SPEC.md`, and `FEEDBACK_UI_GUIDE.md` were updated during session closeout

## Next Up
- Stabilization: end-to-end testing of all features
- Update any remaining stale memories that still mention pre-v1.4.1 versions or long-poll plugin behavior
- Consider further `index.ts` extraction (`alias-manager`, `feedback-handler`, MCP/UI server split)
