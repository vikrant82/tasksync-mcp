Date: 2026-03-18

## Feedback UI Architecture

### Helper Module Structure
- `feedback-html.ts`: Main template shell, base layout, stable session/SSE tail. Single exported `FEEDBACK_HTML` contract used by `index.ts` and `feedback-server.ts`.
- `feedback-html-enhanced-styles.ts`: All CSS — toast, history, markdown, image preview/lightbox styles
- `feedback-html-composer-history-script.ts`: Core UI/composer/toast/theme/history-controls behavior, image paste/drop/file handling
- `feedback-html-history-markdown-script.ts`: Markdown/history rendering helpers (exported with `String.raw` for regex literals)

### Image Support (branch `image_support`)
- Frontend state: `pendingImages[]` array with `{data, mimeType, previewUrl}` entries
- Input methods: clipboard paste, drag & drop, file picker (Attach Image button)
- Validation: `VALID_IMAGE_TYPES` set, `MAX_IMAGE_SIZE` 10MB, `MAX_IMAGES` 10
- Preview: 80×80 thumbnails with hover-to-remove buttons
- Submission: `POST /feedback` with `{ content, images: [{data, mimeType}], sessionId }`
- Image-only submissions allowed (no text required)
- History display: thumbnails (max 240×180) with lightbox zoom on click

### UX Features Completed
- Toast notifications (replacing inline status)
- Send/clear busy states
- Safe lightweight markdown rendering in history
- Auto-resize textarea on restore/input/send/clear
- Active-session summary/title updates on Route Here and SSE refresh

### Markdown Toolbar (branch `image_support`)
- Toolbar div with `role="toolbar"` between label and textarea
- Buttons: Bold, Italic, Code, CodeBlock | Bullet, OL, Heading | Link, HR, Quote
- Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Ctrl+K (link), Ctrl+` (code)
- Tab inserts 2 spaces, Shift+Tab dedents, Escape exits textarea
- Enter auto-continues bullet/numbered lists; empty item removes bullet
- `mdWrapSelection()`, `mdInsertAtCursor()`, `mdToggleLinePrefix()`, `mdInsertCodeBlock()`, `mdInsertLink()`, `mdInsertHr()`, `mdDedentLine()`, `mdContinueList()`, `mdToolbarAction()` helpers in composer script
- CSS: `.md-toolbar`, `.md-toolbar button`, `.md-toolbar-sep`, `.md-toolbar-hint` in styles module

### Remaining UX Backlog
See `tasks__ux_enhancements_backlog` memory
