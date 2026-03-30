# Handoff: Experiment Image Timeout

## Date
2026-03-30

## Session Summary
This workstream investigated two related OpenCode plugin issues around `get_feedback`: (1) idle wait transport instability causing plugin-side timeouts during long waits, and (2) incomplete Layer 2 image attachment injection despite reliable Layer 1 temp-file image fallback. The server, UI, and manual REST flow were verified healthy; the likely transport issue was narrowed to the OpenCode/Bun/plugin HTTP path timing out idle localhost long-poll requests. To mitigate that, the server/plugin wait flow was changed from one indefinitely idle plugin POST to bounded wait + retry behavior. At the same time, startup version logging and extensive plugin diagnostics were added so runtime behavior could be traced precisely. Later analysis of real plugin logs showed the new bounded wait design explains repeated waiting notifications every ~20–25 seconds because the waiter is intentionally cleared and recreated on each poll timeout, and the UI currently interprets that as a fresh waiting transition. Separately, Layer 2 transform logging showed the transform hook runs and sees completed `get_feedback` tool parts, but those parts do not expose our `imageRef` metadata where the hook expects it, so attachment injection remains unresolved.

## Immediate Goal
Resume on branch `experiment-image-timeout` and decide between two follow-up paths: (a) make plugin waiting sticky across poll timeouts so the UI stops re-notifying every ~25s, and/or (b) continue tracing why `context.metadata({ metadata: { imageRef } })` is not surfacing an `imageRef` on completed `get_feedback` tool parts for Layer 2 attachment injection.

## Completed
- Added server startup/version reporting sourced from root `package.json` in `index.ts`.
- Added feedback UI startup version logging in `index.ts`.
- Added plugin initialization version logging sourced from `opencode-plugin/package.json` in `opencode-plugin/src/index.ts`.
- Added `PendingFeedbackResult.type = "timeout"` in `session-manager.ts` and allowed `clearPendingWaiter(...)` to resolve custom results.
- Added plugin wait timeout handling in `index.ts` for `POST /api/wait/:sessionId` with `PLUGIN_WAIT_TIMEOUT_MS = 25000` and `api.wait.timeout` logging.
- Added MCP-side `feedback.wait.poll_timeout` handling in `index.ts` so timeout results are handled explicitly.
- Reworked plugin `get_feedback` in `opencode-plugin/src/index.ts` from one long-lived fetch to a retry loop with timeout handling and retry delay (`WAIT_RETRY_DELAY_MS = 250`).
- Added detailed plugin logs for wait lifecycle: `plugin.feedback.wait.start`, `plugin.feedback.wait.response`, `plugin.feedback.wait.timeout`, `plugin.feedback.wait.failed`, `plugin.feedback.closed`, `plugin.feedback.received`.
- Added detailed Layer 1 image logs: `plugin.image.layer1.start`, `dir_ready`, `saved`, `save_failed`, `complete`.
- Added deeper Layer 2 transform diagnostics in `opencode-plugin/src/index.ts`: `summarizePart(...)`, `plugin.image.layer2.transform.start`, `.message`, `.tool_part`, `.no_image_ref`, `.cache_miss`, `.injected`, `.cleaned`, `.done`.
- Broadened Layer 2 lookup from only `part.state.metadata.imageRef` to `part.state?.metadata?.imageRef ?? part?.metadata?.imageRef`.
- Verified builds pass:
  - `npm run build` in repo root ✅
  - `npm run build` in `opencode-plugin/` ✅
- Verified runtime server health directly:
  - `curl http://localhost:3011/health` returned 200 and expected metadata.
  - `curl http://localhost:3456/` returned feedback UI HTML.
  - direct REST test (`/api/sessions` + `/api/wait/:id` + `/feedback`) worked end-to-end.
- Confirmed from plugin logs that the repeated waiting notification every ~20–25s is currently expected behavior from the bounded wait/retry transport design, not a stale build.
- Confirmed Layer 1 image fallback remains reliable.
- Confirmed Layer 2 transform hook runs, but completed `get_feedback` tool parts only exposed `metadataKeys: ["truncated"]` in observed logs and did not expose our `imageRef` where the transform hook expects it.

## Open Loops
- **Sticky waiting UX not implemented yet.** Current bounded wait/retry clears and recreates the waiter every ~25s, causing repeated UI waiting notifications.
- **Layer 2 metadata propagation unresolved.** `context.metadata({ metadata: { imageRef } })` does not appear on completed `get_feedback` tool parts in the observed transform-hook logs.
- Need a decision whether to keep bounded wait/retry transport as-is, suppress UI notifications for poll-timeout reconnects, or redesign plugin waiting semantics.
- Need another focused OpenCode runtime experiment if continuing Layer 2 work, now using the richer transform logs already in place.

## Key Decisions
- Chose bounded wait + retry transport as a mitigation because real plugin `get_feedback` calls were timing out while manual server-side long-poll tests succeeded, pointing to an idle HTTP timeout in the OpenCode/Bun/plugin path rather than a server bug.
- Kept Layer 1 temp-file image fallback as the reliable baseline even while investigating Layer 2.
- Added high-signal structured plugin logging rather than more speculative code changes, so runtime behavior could be reasoned about from concrete evidence.
- Treated repeated waiting notifications as a UX/state-model issue created by the mitigation, not as evidence the rebuilt plugin/server were stale.

## Files Modified
- `index.ts` — server version logging, feedback UI version logging, plugin wait timeout handling, explicit MCP timeout handling.
- `session-manager.ts` — `PendingFeedbackResult` extended with timeout; `clearPendingWaiter(...)` can now resolve custom results.
- `opencode-plugin/src/index.ts` — plugin version logging, bounded wait retry loop, wait lifecycle logs, Layer 1/Layer 2 image diagnostics, transform-part summarization.
- `package-lock.json` — root package version metadata updated to `1.0.1`.
- `opencode-plugin/package-lock.json` — plugin package version metadata updated to `1.1.0`.
- `.serena/memories/knowledge__mcp_image_support.md` — updated to note real-world evidence that the model inspected an attached screenshot from a tool result.
- `.serena/memories/knowledge__recent_workstreams.md` — updated completed workstream summary.
- `.serena/memories/handoff__plugin_image_support.md` — prior related handoff retained.

## Next Memories to Load
- `handoff__experiment_image_timeout.md`
- `handoff__plugin_image_support.md`
- `knowledge__mcp_image_support`
- `knowledge__recent_workstreams`
- `knowledge__architecture`

## Resumption Prompt
Resume from branch `experiment-image-timeout`. The code already contains a bounded plugin wait timeout plus retry loop intended to avoid idle long-poll timeout in OpenCode, but that mitigation currently causes repeated waiting notifications every ~25s because the waiter is cleared/recreated and the UI treats each reconnect as a new wait transition. At the same time, Layer 2 image injection is still unresolved: the transform hook definitely runs and sees completed `get_feedback` tool parts, but those parts do not expose the `imageRef` metadata where the code looks for it (`part.state.metadata` or `part.metadata`). Start by loading this handoff plus `handoff__plugin_image_support.md` and `knowledge__mcp_image_support`. Then inspect the branch diff and decide whether the next task is UX-focused (sticky waiting / suppress notifications on poll timeout reconnect) or metadata-focused (trace where `context.metadata()` lands in OpenCode runtime structures). If testing again, capture plugin logs for: `plugin.feedback.wait.start`, `plugin.feedback.wait.timeout`, `plugin.image.layer2.transform.tool_part`, `plugin.image.layer2.no_image_ref`, `plugin.image.layer2.injected`, and server logs for `api.wait.started`, `api.wait.timeout`, `api.wait.resolved`, `api.wait.client_disconnected`.

## Raw Artifacts
- Prior recurring plugin error before mitigation: `[TaskSync connection error: The operation timed out.. Is the TaskSync server running at http://localhost:3456?]`
- Manual proof server path worked: register session via `/api/sessions`, start `/api/wait/:sessionId`, POST feedback to `/feedback`, waiter resolved with `{"type":"feedback","content":"debug feedback"}`.
- Important log signals already implemented:
  - server: `api.wait.started`, `api.wait.timeout`, `api.wait.resolved`, `api.wait.client_disconnected`, `feedback.wait.poll_timeout`
  - plugin wait: `plugin.feedback.wait.start`, `plugin.feedback.wait.response`, `plugin.feedback.wait.timeout`, `plugin.feedback.wait.failed`
  - plugin Layer 2: `plugin.image.layer2.transform.start`, `.tool_part`, `.no_image_ref`, `.cache_miss`, `.injected`, `.cleaned`, `.done`
- Observed plugin-log evidence from real runtime:
  - repeated `plugin.image.layer2.transform.start` with `pendingCount: 0`
  - completed `get_feedback` tool parts had `stateKeys: ["status","input","output","title","metadata","time"]`
  - those parts showed `metadataKeys: ["truncated"]` and `attachmentCount: 0`
  - transform hook therefore emitted `plugin.image.layer2.no_image_ref`
  - a `read` tool part had `attachmentCount: 1`, proving attachments are possible on tool parts in principle.
