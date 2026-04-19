# OpenCode / GitHub Copilot Billing & Header Reference

## Header Injection Source

**File:** `packages/opencode/src/plugin/github-copilot/copilot.ts`

A custom `fetch` interceptor registered as a plugin hook. It intercepts every LLM API call and injects billing/routing headers.

## Headers Injected

| Header | Value | When | Purpose |
|--------|-------|------|---------|
| `x-initiator` | `"user"` | First user message in a turn | Marks as billable premium request |
| `x-initiator` | `"agent"` | Tool call continuations, compaction, subagent sessions | Marks as non-billable (free) |
| `Openai-Intent` | `"conversation-edits"` | Always | Declares interaction type |
| `User-Agent` | `opencode/<version>` | Always | Client identification |
| `Copilot-Vision-Request` | `"true"` | When images present in messages | Flags vision-capable requests |
| `Authorization` | `Bearer <token>` | Always | Copilot OAuth token |

## Headers NOT Used by OpenCode

These are VS Code Copilot-specific headers and are **absent** from OpenCode:
- `copilot-integration-id`
- `editor-version`
- `editor-plugin-version`
- `x-github-*`
- `x-copilot-*`

## How `x-initiator` is Determined (3 Code Paths)

### 1. Custom Fetch Interceptor (Primary)
Parses the request body and inspects the **last message role**:
- Last message is `role: "user"` (and not synthetic/attachment) → `"user"` (billable)
- Last message is anything else (tool result, assistant, system) → `"agent"` (free)
- Works for: Chat Completions API, Responses API, Anthropic-style messages

### 2. Compaction Detection
If any message part has:
- `type === "compaction"`, OR
- Is a synthetic text part with `compaction_continue` metadata
→ Forced to `"agent"` (free)

**History:**
- Before March 14, 2026: Compaction counted as `"user"` (billable) — no special handling
- March 14, 2026 (PR #17431, commit `88226f306`): Added `x-initiator: "agent"` for compaction
- April 15, 2026 (PR #22567, commit `e83b22159`): Extended to auto-compaction continuations

### 3. Subagent Sessions
If the session has a `parentID` (child of another session) → ALL requests forced to `"agent"` (free)

## Billing Implications for TaskSync Daemon

### Free Operations (tool results → `x-initiator: "agent"`)
- `get_feedback` returns (tool result, not user message)
- All tool calls during work phases
- Compaction/context management
- Subagent sessions launched by the daemon

### Billable Operations (`x-initiator: "user"`)
- Initial user message that starts the daemon session (unavoidable, 1 request)
- Resuming after OpenCode cancel/interrupt (user types new message)
- Any manual user message typed directly in OpenCode chat

### Practical Cost Model
A typical daemon session:
- **1 premium request**: Initial "start daemon" message
- **0 premium requests**: All subsequent `get_feedback` loops (tool results)
- **+1 per interrupt**: If user cancels in OpenCode and types to resume

### Key Insight
The daemon loop is essentially "infinite free LLM calls" after the initial 1 premium request, as long as all feedback flows through the `get_feedback` MCP tool rather than OpenCode's chat input.

## OpenCode Cancel/Interrupt Flow

1. `cancel(sessionID)` in `run-state.ts` interrupts the Effect fiber
2. `processor.ts` `onInterrupt`: sets `aborted = true`, calls `halt(AbortError)`
3. `prompt.ts` `onInterrupt` (subtasks): marks tool parts as `status: 'error', error: 'Cancelled'`
4. Session goes to "idle"
5. User must type NEW message → `role: "user"` → billable

## Rate Limit Tiers (GitHub Copilot)

Premium requests have quotas based on plan:
- The `x-initiator: "agent"` requests do NOT count against the premium quota
- Only `x-initiator: "user"` requests consume premium request allocation
- Exact quotas vary by plan tier (not publicly documented in detail)

## Implications for Feature Design

When designing TaskSync features, prefer flows where user input comes through MCP tools (tool results → free) rather than requiring the user to type in OpenCode (user messages → billable).

See also: `knowledge__cooperative_interrupt_mechanism` for the planned solution to avoid interrupt costs.
