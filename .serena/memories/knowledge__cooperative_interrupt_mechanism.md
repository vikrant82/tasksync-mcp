Updated: 2026-04-19

## Purpose
Avoid burning an extra premium request when the user needs to redirect a daemon-style agent mid-task. Instead of cancelling OpenCode and sending a new user message, TaskSync provides an in-band urgent feedback path that stays inside the tool-result loop.

## Billing Rationale
OpenCode sets `x-initiator` based on the last message in the model payload:
- `user` when the last message is a real user message -> billable
- `agent` when the last message is a tool result, compaction output, or subagent traffic -> free

In the daemon loop, `get_feedback` returns as a tool result, so subsequent work remains `agent`-initiated. Cooperative interrupts preserve that pattern better than cancelling the OpenCode run and starting a new user turn.

## Implemented Behavior

### `check_interrupts` MCP tool
- Registered in `src/index.ts` alongside `get_feedback`
- Non-blocking and takes no arguments
- Returns plain text tool output, not a structured JSON payload
- Possible responses:
  - `No pending interrupts.`
  - `[URGENT] <message>`
- If urgent images are present in session state, they are returned through the normal feedback formatting path together with the urgent text
- Consumes queued urgent feedback when it returns it

### `get_feedback` priority order
`get_feedback` checks in this order:
1. urgent queue
2. normal queued feedback
3. blocking waiter

If urgent feedback is present, `get_feedback` returns immediately with `[URGENT] ...` instead of blocking.

### Session state and persistence
Implemented in `src/session-manager.ts` and `src/session-state-store.ts`.

Urgent state fields:
- `urgentFeedback: string | null`
- `urgentImages: ImageAttachment[] | null`
- `urgentAt: string | null`

SessionManager methods:
- `queueUrgentFeedback()`
- `consumeUrgentFeedback()`
- `hasUrgentFeedback()`
- `clearUrgentFeedback()`

### Delivery semantics
- If the agent is already blocked in `get_feedback`, `queueUrgentFeedback()` resolves that waiter immediately with `[URGENT] <content>`
- Otherwise the urgent message is queued for the next `check_interrupts` or `get_feedback`
- Urgent feedback uses a single-slot queue in session state, so a later urgent message replaces the previous queued urgent message
- Normal queued feedback remains a separate queue path

### HTTP / UI / plugin paths
Implemented in `src/ui-server.ts`.

- `POST /sessions/:sessionId/urgent-feedback`
- `POST /sessions/:sessionId/cancel-urgent`
- `GET /api/interrupts/:sessionId`
- `GET /api/stream/:sessionId`

Current urgent request shape is the implemented UI/server contract:
```json
{ "content": "..." }
```

The plugin wait SSE path returns urgent feedback before queued feedback.

### Web UI behavior
Client behavior is implemented in `src/ui/feedback-html.ts`; the page is served by `src/ui-server.ts`.

Current UI behavior:
- `Interrupt` button sends urgent feedback to `/sessions/:sessionId/urgent-feedback`
- `Send Feedback` remains the normal non-urgent path
- `Interrupt` is hidden when the routed session is already waiting on `get_feedback`
- An urgent banner shows pending urgent feedback and offers `Cancel`
- The earlier client bug where `Interrupt` did nothing was fixed on 2026-04-19 by changing the handler to use the actual `textbox` DOM reference instead of an undefined `textareaEl`

### Prompt wiring
Daemon prompt updates live in:
- `opencode-plugin/src/daemon-overlay.ts`
- `opencode-plugin/src/daemon-prompt.ts`

The plugin exposes a real `check_interrupts` tool in `opencode-plugin/src/index.ts` and enables it for the dedicated daemon agent plus augmented agents.

## Validation Status
Observed in a live TaskSync session on 2026-04-19:
- waiting-state urgent delivery reached `get_feedback` as `[URGENT] Here is an interrupt. Stop and ask questions..`
- mid-task urgent delivery reached `check_interrupts` during a real refactor as `[URGENT] Interrupt test. Just a check. Continue on your task..`

After the later `ui-server.ts` extraction and rebuild, the TaskSync server process still needs restart for the live process to use the latest built code.

## What Is Not Implemented Yet
- The web UI urgent path does not currently submit image attachments, even though session state and response formatting can carry urgent images
- Telegram does not yet expose a dedicated `Interrupt` action
- This remains cooperative: the model must actually call `check_interrupts` at natural breakpoints for mid-task redirects to be noticed quickly

## Operational Invariant
`check_interrupts` is supplementary only. It never replaces the daemon loop requirement that every turn ends with `get_feedback`.

## Related Files
- `src/index.ts` — MCP `get_feedback` / `check_interrupts` tool handlers
- `src/ui-server.ts` — urgent HTTP endpoints, plugin interrupt polling endpoint, plugin SSE wait path
- `src/session-manager.ts`
- `src/session-state-store.ts`
- `src/ui/feedback-html.ts`
- `opencode-plugin/src/index.ts`
- `opencode-plugin/src/daemon-overlay.ts`
- `opencode-plugin/src/daemon-prompt.ts`