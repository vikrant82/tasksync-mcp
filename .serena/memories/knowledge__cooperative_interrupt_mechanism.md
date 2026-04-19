# Cooperative Interrupt Mechanism for TaskSync Daemon

## Problem Statement

When the TaskSync daemon loop is running in OpenCode (GitHub Copilot backend), the `get_feedback` tool returns as a **tool result** → last message is not `role: "user"` → `x-initiator: "agent"` → **free** (no premium request consumed).

However, if the user needs to redirect/interrupt the agent while it's mid-work (between `get_feedback` calls), the only option is to press Cancel in OpenCode. This:
1. Interrupts the Effect fiber (`run-state.ts` → `cancel()`)
2. Sets `aborted = true` in `processor.ts` `onInterrupt` handler
3. Saves assistant message with interrupted state
4. Session goes to "idle"
5. User must type a NEW message to resume → `role: "user"` → `x-initiator: "user"` → **billable premium request**

This costs 1 extra premium request every time the user interrupts.

## Billing Mechanism (OpenCode + GitHub Copilot)

**Source:** `packages/opencode/src/plugin/github-copilot/copilot.ts`

OpenCode injects `x-initiator` header on every LLM API call:
- `"user"` → last message in payload is `role: "user"` (and not synthetic/compaction) → **billable**
- `"agent"` → last message is tool result, compaction, or subagent session → **free**

In the daemon loop, ALL `get_feedback` returns are tool results → all subsequent work is free. Only the initial user message that starts the daemon costs 1 premium request.

**Compaction:** Also forced to `"agent"` since March 2026 (PR #17431). Subagent sessions with `parentID` are always `"agent"`.

## Proposed Solution: Cooperative Interrupt

Instead of forcing a cancel in OpenCode, build an in-band interrupt mechanism that works within the daemon tool-call loop.

### Architecture

```
Normal daemon loop:
  Agent works → calls get_feedback (blocks) → user submits → tool result → free → repeat

With cooperative interrupt:
  Agent works → periodically calls check_interrupts() → empty → continues working
  Agent works → calls check_interrupts() → URGENT FEEDBACK → processes it → calls get_feedback → free
```

### New Components

#### 1. `check_interrupts` MCP Tool

**Purpose:** Non-blocking tool that returns immediately. Either empty (no interrupt) or with urgent feedback.

**Behavior:**
- If no urgent feedback queued → returns `{ interrupted: false }`
- If urgent feedback queued → returns `{ interrupted: true, feedback: "...", images: [...] }`
- Clears the urgent queue after returning
- Does NOT block like `get_feedback`

**Registration:** In `src/index.ts`, alongside `get_feedback` tool.

**Schema:**
```typescript
{
  name: "check_interrupts",
  description: "Check if the user has sent an urgent interrupt message. Call this periodically during long work phases. Returns immediately.",
  inputSchema: { type: "object", properties: {} }
}
```

**Return format:**
```typescript
// No interrupt
{ content: [{ type: "text", text: "No pending interrupts." }] }

// Interrupt pending
{ content: [{ type: "text", text: "URGENT INTERRUPT from user:\n\n<feedback>" }] }
```

#### 2. Urgent Queue in Session State

**Location:** `src/session-manager.ts` → `SessionState` interface

Add to session state:
```typescript
urgentFeedback: string | null;
urgentImages: string[] | null;
urgentQueuedAt: string | null;
```

**Methods to add:**
- `queueUrgentFeedback(sessionId, feedback, images?)` — sets urgent fields, persists, emits state change
- `consumeUrgentFeedback(sessionId)` — reads and clears urgent fields, returns the feedback

#### 3. API Endpoint

**`POST /sessions/:sessionId/urgent-feedback`**

```typescript
// Request body
{ feedback: string, images?: string[] }

// Response
{ success: true }
```

This is separate from the normal feedback endpoint. It sets the urgent queue without affecting the normal `get_feedback` blocking mechanism.

#### 4. Web UI: "Interrupt & Send" Button

**Location:** `src/ui/feedback-html.ts` and `src/ui/scripts.ts`

**UI Design:**
- New button in the composer area (next to Send): "⚡ Interrupt & Send" or similar
- Only visible when the session is active and NOT waiting for feedback (i.e., agent is mid-work)
- When clicked: sends the textarea content to the urgent endpoint instead of normal feedback
- Visual feedback: button turns orange/yellow, shows "Interrupt queued" confirmation
- The textarea content is preserved (user can still edit/resend if agent doesn't pick it up quickly)

**Visibility Logic:**
- Show "Interrupt & Send" when: session selected, `waitingForFeedback === false`, session is active
- Show normal "Send" when: session selected, `waitingForFeedback === true`
- This naturally handles the transition: when agent calls `get_feedback`, UI switches to "Send"

#### 5. Daemon Skill Instructions Update

**Location:** `~/.agents/skills/task-sync-daemon/SKILL.md`

Add instruction for periodic interrupt checking:

```markdown
## Cooperative Interrupt Protocol

During long work phases (multiple tool calls without calling `get_feedback`), 
periodically call `check_interrupts` to see if the user has sent urgent feedback.

**When to check:**
- After every 3-5 tool calls during a work phase
- Before starting a new major sub-task
- After completing a significant unit of work

**When you receive an interrupt:**
1. Acknowledge the interrupt in your visible text output
2. Stop current work (or complete the immediate atomic operation)
3. Process the urgent feedback
4. Call `get_feedback` to resume the normal loop
```

### Implementation Order

1. Add urgent queue fields to session state (`session-manager.ts`)
2. Add `queueUrgentFeedback()` and `consumeUrgentFeedback()` methods
3. Add `POST /sessions/:sessionId/urgent-feedback` endpoint (`index.ts`)
4. Register `check_interrupts` MCP tool (`index.ts`)
5. Add "Interrupt & Send" button to web UI
6. Wire up button to urgent endpoint in `scripts.ts`
7. Update state change handling to show/hide interrupt button
8. Update daemon skill instructions
9. Persist urgent state in `session-state-store.ts`
10. Build and test

### Edge Cases

- **Agent never calls `check_interrupts`**: Urgent feedback sits in queue. User can still Cancel in OpenCode as fallback. Urgent feedback is picked up on next `get_feedback` call if still queued.
- **Multiple urgent messages**: Latest one wins, or queue them (TBD). Simplest: latest replaces previous.
- **Agent calls `get_feedback` while urgent is queued**: `get_feedback` should check urgent queue first and return it immediately instead of blocking.
- **Race condition**: User sends urgent while agent is about to call `get_feedback`. Not a problem — `get_feedback` can check urgent queue before blocking.
- **Transport closed**: Urgent queue is persisted, survives reconnection.

### Limitations

- **Not instant**: Agent checks cooperatively. 5-30 second delay depending on work being done.
- **Relies on LLM following instructions**: The agent must actually call `check_interrupts`. Can't force it.
- **Falls back to Cancel**: If agent ignores cooperative checks, user can still force-cancel (costs 1 premium request).

### Related Code Locations

- `src/index.ts`: Tool registration (line ~300 for `get_feedback`), endpoint registration
- `src/session-manager.ts`: Session state, `SessionState` interface
- `src/session-state-store.ts`: Persistence, `PersistedSessionMetadata`
- `src/ui/feedback-html.ts`: Web UI HTML generation
- `src/ui/scripts.ts`: Client-side JavaScript
- `~/.agents/skills/task-sync-daemon/SKILL.md`: Daemon loop instructions

### OpenCode Internals Referenced

- `packages/opencode/src/plugin/github-copilot/copilot.ts`: `x-initiator` header injection
- `packages/opencode/src/session/run-state.ts`: `cancel(sessionID)` fiber interruption
- `packages/opencode/src/session/processor.ts`: `onInterrupt` handler
- `packages/opencode/src/session/prompt.ts`: Subtask `onInterrupt` handler
