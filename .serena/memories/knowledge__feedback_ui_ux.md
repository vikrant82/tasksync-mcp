Updated 2026-03-10.

Current feedback UI behavior:
- Wide-screen two-column layout.
- Left column: feedback composer and conversation history.
- Right column: sessions and settings.
- History is bounded, collapsible, and scrollable with compact timestamps, smart auto-scroll, and 'Jump to latest'.
- Live UI updates use EventSource `/events` rather than polling.
- Session route targeting resolved against live sessions. "Route Here" button shows "Current" (disabled) for active route target.
- Wait banner shows live elapsed timer (e.g., "Agent waiting for feedback (2m 34s)") with 1s update interval.
- Session list items show metadata: created time, last activity (relative), and waiting duration.
- Stale sessions (>1h inactive) are visually dimmed (55% opacity) with a stale count on the "Prune Stale" button.
- "Prune Stale" button disabled when no stale sessions exist.
- Server auto-prunes sessions inactive >4 hours (every 5 minutes).
- Session IDs are human-readable: `{client-slug}-{generation}` (e.g., `opencode-1`, `copilot-3`).
- `formatElapsed()` helper for human-readable durations (e.g., "2m 34s").
- Notification sound on waiting state transition (can be muted in settings).

Backend expectations for UI:
- `/events` emits full state payloads including `waitStartedAt` per session.
- `/feedback/history` returns bounded submitted feedback history for the selected session.
- `/feedback` remains POST-only for feedback submission.