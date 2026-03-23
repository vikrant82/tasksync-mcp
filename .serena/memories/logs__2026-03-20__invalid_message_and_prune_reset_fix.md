Date: 2026-03-20

Applied two requested fixes in `index.ts`:

1) Clearer invalid-session guidance
- Updated `mcp.session.invalid` 404 JSON-RPC error message from generic "Session not found" to:
  "Session not found. Session may have expired due to inactivity; reinitialize TaskSync."
- Location: MCP handler invalid-session branch.

2) Inactivity reset after feedback delivery / fresh activity
- Fixed prune reference logic so sessions are evaluated using the most recent timestamp, not only `lastFeedbackRequestAt` precedence.
- Added helper selection logic:
  - `selectLatestReferenceTimestamp(...)`
  - `getSessionReferenceInfo(...)`
  - `getOrphanedSessionReferenceInfo(...)`
- Candidate ordering now includes:
  - `lastActivityAt`
  - `lastSeenAt`
  - `lastFeedbackRequestAt`
  - `createdAt`
- Auto-prune now uses selected latest timestamp and logs `basedOn` as the actual source.
- This prevents immediate prune after feedback delivery, because `lastActivityAt` is updated by healthy events and becomes the newest reference.

Build status:
- `npm run build` passed after changes.

Behavioral outcome expected:
- Waiting sessions still protected from auto-prune.
- Non-waiting sessions still pruned aggressively after configured inactivity.
- Freshly active sessions (post-feedback delivery) now get a reset inactivity window.