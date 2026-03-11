Date: 2026-03-11

Feedback UI refactor/session summary:
- `feedback-html.ts` was reduced significantly by extracting high-churn pieces into helper modules while preserving the single exported `FEEDBACK_HTML` contract used by `index.ts` and `feedback-server.ts`.
- New helper modules created:
  - `feedback-html-enhanced-styles.ts` for toast/history/markdown CSS
  - `feedback-html-composer-history-script.ts` for core UI/composer/toast/theme/history-controls behavior
  - `feedback-html-history-markdown-script.ts` for markdown/history rendering helpers
- The markdown/history helper must be exported with `String.raw` so regex literals keep their backslashes when nested into the larger `FEEDBACK_HTML` template; otherwise the browser receives malformed regex syntax.
- `feedback-html.ts` now keeps the template shell, base layout, and stable session/SSE tail.
- UX improvements completed this session:
  - toast notifications replacing inline status presentation
  - send/clear busy states
  - safe lightweight markdown rendering in history
  - active-session summary/title updates immediately on Route Here and stays in sync on SSE state refresh
  - textarea auto-resize on restore/input/send/clear
- Current repo state at wrap-up:
  - modified tracked file: `feedback-html.ts`
  - untracked new files: `feedback-html-enhanced-styles.ts`, `feedback-html-composer-history-script.ts`, `feedback-html-history-markdown-script.ts`
  - changes not yet committed
- Remaining notable UX backlog after this session:
  - keyboard shortcuts overlay
  - favicon/tab waiting indicator
  - session quick-switch dropdown
  - history search/filter
  - collapsible mobile sidebar
  - copy-to-clipboard on history entries
  - live OS theme preference tracking
