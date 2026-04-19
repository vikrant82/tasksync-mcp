Updated: 2026-04-19

## Completed: Behavior-Preserving Server Refactor (April 2026)
- Confirmed live sanity checks: `curl http://127.0.0.1:3011/health` returned healthy with version `1.5.0`, and `curl http://127.0.0.1:3456/` returned HTTP 200
- Extracted `src/feedback-handler.ts` from `src/index.ts`
- Extracted `src/mcp-server.ts` for MCP transport/bootstrap
- Extracted `src/feedback-state.ts` from `src/session-manager.ts`
- Extracted `src/alias-state.ts` from `src/session-manager.ts`
- `npm run build` passed after each extraction checkpoint
- No intentional functional changes or new validation branches were introduced

## Current Recommendation
- Park refactoring at the current build-green checkpoint
- Prioritize automated tests next: alias state, feedback state, session lifecycle, interrupts, recovery, and prune behavior
- No release needed solely for this internal cleanup; roll these refactors into the next functional or bug-fix release

## Earlier Completed: Version Display + Auto Session Naming (April 2026, PR #11)
- Server version now appears in startup logs, MCP init, `/health`, and feedback UI footer
- Plugin version logs on initialization
- Added `POST /sessions/:sessionId/title` endpoint for inferred aliases from OpenCode session titles
- Released as Server v1.4.0 and Plugin v1.3.0

## Earlier Completed: Feedback Defaults + Session Title Cleanup (April 2026, PR #12)
- Fixed persisted auto-prune bug: selecting `Never` now stays disabled after reload instead of drifting back to 10 minutes
- Feedback composer now separates quick replies (`Approve`, `Continue`) from the primary `Send Feedback` action so button priority is clearer while an agent is waiting
- Plugin ignores or trims bootstrap/orientation titles before syncing inferred aliases, so session names better reflect the actual task
- Added deferred title sync path that re-registers the plugin session before retrying title updates
- Released as Server v1.4.1 and Plugin v1.3.1

## Earlier Completed: Preserve Built-in Prompts During Augmentation (April 2026, PR #10)
- Fixed: `augmentAgents` was replacing built-in agent prompts
- Daemon overlay now appended at runtime via `experimental.chat.system.transform` hook
- `activeAgentBySession` map tracks agent per session
- Wildcard `"*"` auto-includes built-ins (`ask`, `build`, `plan`, `general`)
