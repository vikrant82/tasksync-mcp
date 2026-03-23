Updated: 2026-03-20

This memory consolidates important details from deprecated handoff memories that were removed as stale.

## Consolidated outcomes

### 1) Feedback UI image support workstream (former `handoff__feedback_ui_image_support`)
- Full image pipeline was implemented on branch `image_support`:
  - UI: paste / drag-drop / file attach images
  - POST `/feedback` accepts `images[]` with `{data: base64, mimeType}`
  - Backend propagates images through queued/waiter flow
  - `get_feedback` returns mixed MCP blocks (`TextContent` + `ImageContent`)
  - History renders thumbnails + lightbox
- Markdown toolbar was implemented with buttons and keyboard shortcuts.
- Docs were updated in README + API/UI docs during that stream.
- Key design decisions from that workstream:
  - Base64 transport in browser for simplicity
  - `ImageAttachment = { data, mimeType }`
  - Limits: 10 images, 10MB each, 50MB JSON body limit
  - Image-only submissions allowed

### 2) Frontend enhancements workstream (former `handoff__frontend_enhancements`)
- Major UX/accessibility/UI refactor completed:
  - Two-column layout, session metadata visibility, improved waiting indicators
  - Accessibility improvements (aria-live/focus-visible labels)
  - UX polish (draft persistence, inline rename, shortcuts, filters)
  - Visual system improvements (theme toggle, responsive behavior)
- Stale session management landed:
  - UI stale flag for inactive sessions
  - UI prune action/button
  - Backend `POST /sessions/prune` endpoint

## Active follow-up direction
- Improve stale/disconnected-session discovery logic to reduce false positives/false negatives.
- Existing heuristic is primarily time since `lastActivityAt` plus `waitingForFeedback`; this should evolve to incorporate richer connection-health signals.

## Why this memory exists
- Preserve useful context while deleting stale handoff memories and avoiding handoff clutter in memory list.