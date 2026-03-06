Updated 2026-03-06.

Current feedback UI behavior:
- Wide-screen two-column layout.
- Left column: feedback composer and conversation history.
- Right column: sessions and settings.
- Old help panel removed.
- Old standalone 'Current session feedback' panel removed.
- History is bounded, collapsible, and scrollable.
- History includes compact timestamps, smart auto-scroll near bottom, and a 'Jump to latest' button when scrolled up.
- Live UI updates use EventSource `/events` rather than polling.
- Session route targeting is resolved against live sessions to avoid stale/dead session routing.
- Manual refresh for sessions still exists, but main live state comes from SSE.

Backend expectations for UI:
- `/events` emits full state payloads.
- `/feedback/history` returns bounded submitted feedback history for the selected session.
- `/feedback` remains POST-only for feedback submission.
