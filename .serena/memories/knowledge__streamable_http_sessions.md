Updated: 2026-03-20

## Session health telemetry and stale detection v2 (implemented)

Files changed:
- session-state-store.ts
- index.ts
- feedback-html.ts

### Why this changed
Prior stale detection relied on `lastActivityAt` (updated on all requests), so repeated abort/reconnect traffic masked stale sessions.

### Data model changes
`PersistedSessionMetadata` now includes:
- `lastSeenAt: string` (any request seen)
- `lastHealthyAt: string` (meaningful healthy progress)
- `lastDisconnectSignalAt: string | null`
- `consecutiveAbortCount: number`
- `disconnectSignalCount: number`
- `health: "active" | "waiting" | "degraded" | "stale" | "closed"`
- Existing `lastActivityAt` retained for compatibility; now tracks "seen" activity.

### Health computation (index.ts)
- Added thresholds:
  - `UI_STALE_THRESHOLD_MS = 45m`
  - `UI_DEGRADED_THRESHOLD_MS = 10m`
  - `DEGRADE_ABORT_THRESHOLD = 5`
- Added helpers:
  - `getLastHealthyMs(...)`
  - `computeSessionHealth(...)`
  - `refreshSessionHealth(...)`
  - `markSessionSeen(...)`
  - `markSessionHealthy(...)`
  - `markSessionDisconnectSignal(...)`

### Signal mapping
Healthy signals:
- queued feedback returned to waiter (`queued_feedback_returned`)
- live feedback returned (`live_feedback_returned`)
- UI feedback submission (`ui_feedback_submitted`)
- normal response close handling (`response_closed` / waiter clear path)

Disconnect signals:
- request aborted
- response disconnected
- wait interrupted
- stream closed callback
- non-healthy waiter clear reasons

### Logging added/expanded
- `session.health.transition` (from/to + counters + timestamps)
- `session.health.healthy_signal`
- `session.disconnect.signal`
- Existing prune/delete logs enriched with telemetry context.

### Pruning behavior changes
- UI prune and auto-prune now use `lastHealthyAt` age (fallback to legacy `lastActivityAt` if absent).
- UI prune response/log now records it is based on `lastHealthyAt`.

### UI behavior changes (feedback-html.ts)
- Session payload now consumes `health`, `staleAgeMs`, and disconnect counters.
- New `degraded` visual state and badge.
- `stale` now based on backend `health === "stale"` (not direct lastActivityAt time diff).
- Metadata now shows Seen/Healthy times and disconnect signal count.
- Prune prompt text updated to "no healthy activity" wording.

### Notes
- `sessionStateStore.markSessionClosed()` is now invoked on explicit MCP DELETE path.
- Build passed (`npm run build`).