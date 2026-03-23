Date: 2026-03-20

Verified post-simplification behavior from tasksync.log and session-state:

- Current server health: status=ok, streamable-http, sessions reduced from 2 to 1.
- Settings confirmed in persisted state: disconnectAfterMinutes=10.

Key timeline:
- opencode-56 (non-waiting) showed disconnect bursts with waitingIntent=false, then was auto-pruned:
  - session.auto-pruned @ 07:01:57Z (inactiveMs=631284, disconnectAfterMinutes=10)
  - session.auto-pruned.orphaned @ 07:06:57Z (inactiveMs=931315)
- Subsequent requests using opencode-56 produced mcp.session.invalid (GET/POST), matching user symptom: tool unavailable on stale session.

- opencode-55 remained waiting for long period:
  - repeated 5-min abort/disconnect pattern with waitingIntent=true
  - not auto-pruned while waiting (expected simple policy behavior)
- At 09:36:12Z user feedback posted/delivered to waiter; waitingIntent flipped false.
- Shortly after, opencode-55 was auto-pruned:
  - session.auto-pruned @ 09:36:58Z (inactiveMs=9848371, basedOn=lastFeedbackRequestAt, disconnectAfterMinutes=10)

- New reconnect session opencode-57 created and active; persisted state shows waitingIntent=true for opencode-57.

Conclusion:
Simple policy is working as intended:
1) Never auto-prune waiting sessions.
2) Aggressively prune non-waiting sessions after configured inactivity window.

Optional refinement suggested:
- Improve mcp.session.invalid response messaging to explicitly indicate session expired due to inactivity and client should reinitialize.