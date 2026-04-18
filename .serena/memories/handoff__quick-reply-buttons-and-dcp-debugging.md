# Handoff: Quick-Reply Buttons + DCP Compression Debugging

**Date**: 2026-04-17

## Session Summary

Session focused on two areas: (1) adding quick-reply buttons to tasksync-mcp feedback UI, and (2) researching the DCP (Dynamic Context Pruning) plugin to understand and debug why compression isn't reclaiming context effectively.

## Immediate Goal

Debug DCP compression context reclamation — understand why compressed blocks don't reduce context usage as much as expected, and potentially improve compression efficiency.

## Completed

### Quick-Reply Button Enhancements (all uncommitted)
- **Stop button** added to web UI (`src/ui/feedback-html.ts`, `src/ui/scripts.ts`) and Telegram (`src/channels.ts`)
  - Sends: `"All tasks accomplished, we can **Stop** now. If you are a sub agent, repeat all the summary and information in one last message and stop. Do not call get_feedback again. If you are the main agent, you can just stop."`
  - Uses `btn-danger` CSS class (red background, already existed at line 140 of feedback-html.ts)
  - Telegram: `🛑 Stop` button on same row as Continue; callback handler maps `"stop"` action to full message text
- **Pause Session button** added to web UI and Telegram
  - Sends: `"$pause-session — Pause this session now. Follow the pause-session skill protocol: gather current state, identify open loops, write handoff memory (handoff__<topic>.md)..."` (full verbose prompt with all handoff protocol steps)
  - Web: `<button id="pause-button" class="btn-secondary">Pause Session</button>` after Stop
  - Telegram: `⏸️ Pause` on new row; callback maps `"pause"` action to same verbose prompt
  - Does NOT end the feedback loop (unlike Stop) — agent continues after saving
- **Approve/Continue**: kept as-is (bare `"approve"` / `"continue"` strings)
- **Docs updated**: `FEEDBACK_UI_GUIDE.md` (line 12), `README.md` (line 109) — both list all 4 buttons
- **Busy/disable logic**: all new buttons wired into `setBusy()` in scripts.ts
- **Build**: passes clean

### Files Modified
- `src/ui/feedback-html.ts` — Stop/Pause button HTML + element refs + CSS min-width rule for btn-danger
- `src/ui/scripts.ts` — Click handlers for Stop/Pause, busy logic
- `src/channels.ts` — Telegram keyboard buttons, callback action→text mapping
- `docs/FEEDBACK_UI_GUIDE.md` — Quick replies documentation
- `README.md` — Telegram buttons list
- `~/.config/opencode/dcp.jsonc` — Changed `"debug": false` to `"debug": true` (for next session's debugging)

### DCP Research (captured in `knowledge__dcp_plugin` memory)
- Full architecture documented: compress tool schema, pipeline, state model, sync mechanism
- OpenCode integration: `experimental.chat.messages.transform` hook, `filterCompacted`, pruning

## Open Loops

### DCP Compression Context Reclamation Issue
**Problem**: After compression, context usage doesn't decrease as much as expected.

**Findings so far**:
1. DCP notification for our b2 compress showed: -30.6K removed, +23.7K summary = net ~6.9K saved. Only 22% token reduction.
2. Context counter initially didn't reflect savings (showed increase), then after a few turns showed ~10K reduction (92,366 → 82,152). May be a display lag.
3. **Root cause identified**: Protected tool outputs are force-appended verbatim to every summary regardless of summary content.
   - `COMPRESS_DEFAULT_PROTECTED_TOOLS = ["task", "skill", "todowrite", "todoread"]` (config.ts:89)
   - `appendProtectedTools()` in `lib/compress/protected-content.ts` iterates all messages in the range, finds protected tool parts, appends their full output after heading "The following protected tools were used in this conversation as well:"
   - For `task` tool with `allowSubAgents: true`: even fetches subagent session messages and merges into the appended output
4. This means: even a 2-line summary can balloon to 20K+ if the range contains large todowrite arrays, task subagent results, or skill loads

**Key code paths**:
- `filterCompressedRanges()` in `lib/messages/prune.ts:159-233` — replaces compressed messages with synthetic user message containing stored summary at anchor point; skips messages in prune list
- `appendProtectedTools()` in `lib/compress/protected-content.ts:55-153` — the bloating function
- `syncCompressionBlocks()` in `lib/messages/sync.ts:15-124` — manages block active/deactivated state, doesn't do content replacement
- `wrapCompressedSummary()` in `lib/compress/state.ts:51-59` — wraps with `[Compressed conversation section]` header + `<dcp-message-id>bN</dcp-message-id>` footer
- `createCompressRangeTool/execute` in `lib/compress/range.ts:58-177` — full pipeline orchestration

**DCP config** (`~/.config/opencode/dcp.jsonc`):
- `summaryBuffer: true` — active summary tokens extend max limit (could mask growth)
- `allowSubAgents: true` — DCP processes subagent sessions too
- `protectUserMessages: false` — user messages can be compressed
- `debug: true` — JUST ENABLED, requires OpenCode restart to take effect
- `nudgeForce: "strong"`, `nudgeFrequency: 3`, `maxContextLimit: "90%"`, `minContextLimit: 30000`

### Possible Solutions to Investigate
1. **Truncate/summarize protected tool outputs** instead of appending verbatim — would require DCP plugin change
2. **Reduce protected tools** — e.g., don't protect todowrite/todoread (their outputs are relatively large JSON arrays)
3. **Write leaner summaries** — focus on decisions/file-paths, reference Serena memories for durable knowledge
4. **Use `/dcp stats` and `/dcp context`** commands to get actual token breakdowns per block
5. **Check DCP debug logs** after restart (now enabled at `~/.config/opencode/logs/dcp/`)

## Key Decisions
- Approve/Continue kept as simple strings (daemon prompt handles interpretation)
- Pause Session doesn't end feedback loop — agent continues after handoff save
- Stop button includes sub-agent instruction to dump summary before stopping
- DCP knowledge written to Serena memory `knowledge__dcp_plugin` for reuse

## Next Memories to Load
- `knowledge__dcp_plugin` — DCP architecture and best practices
- `knowledge__architecture` — tasksync-mcp architecture
- `knowledge__project_overview` — project overview and versions
- `tasks__refactoring_backlog` — open backlog items

## Debugging DCP — What to Do Next Session

### Debug Logging
- `dcp.jsonc` has `"debug": true` — requires OpenCode restart to take effect
- Logs go to `~/.config/opencode/logs/dcp/daily/YYYY-MM-DD.log`
- Context snapshots saved to `~/.config/opencode/logs/dcp/context/<sessionId>/<timestamp>.json`
- Logs include: component name, message, structured data (block IDs, token counts, etc.)
- Context snapshots are minimized: role, time, tokens, text/tool parts (no IDs, no step parts)

### `/dcp stats` Command
Shows:
- **Tokens in|out**: total compressed tokens vs total summary tokens (active blocks only)
- **Ratio**: compression ratio (e.g., 3:1)
- **Time**: total compression duration
- **Messages/Tools**: count of pruned messages and tools
- **All-time**: lifetime stats from storage

### `/dcp context` Command
Shows:
- **System/User/Assistant/Tools** breakdown with bar chart and percentages
- System = first assistant input + cache - first user tokens
- Tools = tokenizer estimate of tool inputs + outputs (non-pruned, non-compacted)
- Assistant = residual (total - system - user - tools)
- **Summary section**: "Pruned: N tools, M messages (~XK tokens)", "Current context", "Without DCP"

### Key Investigation Steps
1. After restart, run `/dcp context` to see current breakdown
2. Do a compress, then run `/dcp stats` to see tokens in/out and ratio
3. Check the daily log for "Injected compress summary" entries with summaryLength
4. Check context snapshots to see actual message content after compression (what the LLM sees)
5. Look at the force-appended protected tool outputs — are they the bulk of the summary?

### Where Protected Tool Appending Happens
- `appendProtectedTools()` in `lib/compress/protected-content.ts:55-153`
- Default protected: `["task", "skill", "todowrite", "todoread"]` (config.ts:89)
- With `allowSubAgents: true`: task tool results include fetched subagent session messages merged via `mergeSubagentResult()`
- Appended verbatim after: "The following protected tools were used in this conversation as well:"

### The Core Issue
The compression pipeline works correctly (messages removed, synthetic summary injected). But the **net savings are poor** because:
1. Protected tool outputs are appended verbatim — todowrite produces full JSON todo arrays, task subagent results can be massive
2. `summaryBuffer: true` extends the effective max limit by active summary tokens, masking growth
3. User summaries may be too verbose (should be lean: decisions + file paths, not research dumps)

## Resumption Prompt

This session added Stop/Pause Session quick-reply buttons to tasksync-mcp (uncommitted) and deeply researched the DCP compression plugin. The main open issue is poor compression efficiency: protected tool outputs (todowrite, task, skill, todoread) are appended verbatim to every compressed summary, causing summaries to be nearly as large as the original content. 

To continue: (1) Restart OpenCode so `debug: true` takes effect in dcp.jsonc. (2) Run `/dcp stats` and `/dcp context` to see actual token breakdowns per compressed block. (3) Inspect debug logs at `~/.config/opencode/logs/dcp/` after a compression. (4) Consider solutions: truncating protected outputs in DCP source, reducing the protected tool list, or just writing leaner summaries. (5) The button changes are uncommitted — commit when ready. (6) Build passes clean.
