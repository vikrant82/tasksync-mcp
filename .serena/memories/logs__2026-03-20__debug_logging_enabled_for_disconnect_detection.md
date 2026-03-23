Date: 2026-03-20

Objective: Improve observability to detect clients no longer connected and not waiting for feedback, for auto-prune policy.

Actions taken:
- Enabled TaskSync debug logging for this session by launching server with:
  - TASKSYNC_LOG_LEVEL=debug
  - TASKSYNC_LOG_FILE=/home/chauv/.config/opencode/tasksync-mcp/tasksync.log
  - command: node dist/index.js --port=3011 --ui-port=3457
- Verified health endpoint returns status ok on port 3011.
- Verified running process: `node dist/index.js --port=3011 --ui-port=3457`.
- Verified debug output file exists and is populated:
  - /home/chauv/.config/opencode/tasksync-mcp/.tasksync/server-debug.out

Key debug events now visible for this objective:
- Waiting lifecycle: `feedback.waiting`, `feedback.delivered.to_waiter`
- Disconnect signals: `mcp.request.aborted`, `session.disconnect.signal`
- Transport close detail: `mcp.request.closed` with `writableEnded`
- Keepalive traces during waits: `feedback.keepalive.started|sent|stopped`

Current policy direction (user-specified simplification):
- If a client issued `get_feedback` and feedback has not yet been submitted/resolved, keep session alive indefinitely.
- Only non-waiting sessions are auto-prunable after configurable inactivity window (default target: 10 minutes, UX-configurable).

Next planned experiment:
- Connect a client, then manually quit it, and inspect whether logs contain a unique explicit quit signal versus generic disconnect/abort pattern.