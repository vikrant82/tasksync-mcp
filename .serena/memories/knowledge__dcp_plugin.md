# DCP Plugin (Dynamic Context Pruning)

Source: `opencode-dynamic-context-pruning/`

## Compress Tool (range mode)
- Schema: `{topic: string, content: [{startId, endId, summary}]}`
- Boundary IDs: `mNNNN` (message refs, m0001-m9999) or `bN` (block refs, b1, b2...)
- `(bN)` placeholders in summaries get expanded to stored block content
- Protected tools (task, skill, todowrite, todoread) force-appended to summaries

## Key Architecture
- `experimental.chat.messages.transform` hook runs 17-step pipeline on every LLM call
- `syncCompressionBlocks()` replaces compressed messages' content with summary text (transient, not persisted)
- State: `CompressionBlock` objects track blockId, runId, active flag, consumed/parent blocks, effective message/tool IDs
- Message IDs injected as `<dcp-message-id>` XML tags via `injectMessageIds()`

## OpenCode Native Compaction (separate from DCP)
- `filterCompacted()` windows conversation at most recent CompactionPart boundary
- Pruning: after 40K protected tokens, older tool outputs marked as `time.compacted` → show as `"[Old tool result content cleared]"`
- `experimental.chat.messages.transform`: receives `{messages: WithParts[]}` by reference, plugins mutate in place

## Config (`dcp.jsonc`)
Key settings: `compress.maxContextLimit`, `minContextLimit`, `nudgeFrequency`, `protectedTools`, `protectUserMessages`, `permission`, `mode`, `summaryBuffer`, turn protection, manual mode, strategies (dedup, purgeErrors)

## Best Practices for Summaries
- Write lean: decisions, file paths, what changed — not full research dumps
- Reference Serena memories for durable knowledge instead of duplicating in summaries
- Target 70-90% token reduction
