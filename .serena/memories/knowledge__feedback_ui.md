# Feedback UI Architecture & UX

Updated: 2026-03-27

## File Structure
- `feedback-html.ts`: Main HTML template shell, base layout, stable session/SSE code. Exports `FEEDBACK_HTML`.
- `feedback-html-enhanced-styles.ts`: All CSS (toast, history, markdown, image preview/lightbox, session badges)
- `feedback-html-composer-history-script.ts`: Core UI behavior (composer, toast, theme, history, image handling)
- `feedback-html-history-markdown-script.ts`: Markdown/history rendering helpers

## Layout
- Wide-screen two-column: left (composer + history), right (sessions + settings)
- History: bounded, collapsible, scrollable with smart auto-scroll and "Jump to latest"
- Live updates via EventSource `/events` (SSE)

## Session Management
- "Route Here" button (shows "Current" when active), "Set Default", "Rename", "Prune Stale"
- Session rows: alias/ID, metadata (created, last activity, wait duration), status chips
- Stale sessions (>1h inactive) visually dimmed (55% opacity)
- Prune button shows stale count, disabled when 0
- Wait banner: live elapsed timer ("Agent waiting for feedback (2m 34s)")

## Image Support
- Input: clipboard paste, drag & drop, file picker
- Preview: 80×80 thumbnails with hover-to-remove
- Validation: MIME type check, 10MB max, 10 images max
- Submission: `POST /feedback` with `{ content, images: [{data, mimeType}], sessionId }`
- History: thumbnails (max 240×180) with lightbox zoom on click
- Image-only submissions allowed (no text required)

## Markdown Toolbar
- Buttons: Bold, Italic, Code, CodeBlock | Bullet, OL, Heading | Link, HR, Quote
- Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+`
- Tab: 2 spaces, Shift+Tab: dedent, Escape: exit textarea
- Enter: auto-continue lists (empty item stops)

## Notifications
- Sound: chime on waiting transition (mutable)
- Desktop: browser notifications (permission required)
- Modes: focused session only, or all sessions

## Backend Contract
- `/events`: full state payloads with `waitStartedAt` per session
- `/feedback/history`: bounded submitted feedback history
- `/feedback`: POST for feedback submission (50MB JSON limit for base64 images)
