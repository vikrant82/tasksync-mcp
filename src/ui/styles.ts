/**
 * High-churn feedback UI styles extracted from feedback-html.ts.
 * Keeps toast + history/markdown presentation isolated from the base layout CSS.
 */

export const FEEDBACK_HTML_ENHANCED_STYLES = `
  .status {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .toast-viewport {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(22rem, calc(100vw - 2rem));
    z-index: 1000;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--fg);
    box-shadow: 0 12px 32px rgba(0,0,0,0.28);
    animation: toast-in 180ms ease-out;
  }
  .toast.success { border-color: rgba(63,185,80,0.32); background: var(--success-subtle); color: var(--success); }
  :root[data-theme="light"] .toast.success { border-color: rgba(26,127,55,0.32); }
  .toast.error { border-color: rgba(248,81,73,0.32); background: var(--danger-subtle); color: var(--danger); }
  :root[data-theme="light"] .toast.error { border-color: rgba(207,34,46,0.32); }
  .toast.info { border-color: rgba(88,166,255,0.28); }
  .toast-message {
    flex: 1;
    font-size: 0.85rem;
    line-height: 1.35;
    word-break: break-word;
  }
  .toast-close {
    padding: 0.1rem 0.35rem;
    background: transparent;
    color: var(--fg-muted);
    font-size: 1rem;
    line-height: 1;
  }
  .toast-close:hover { opacity: 1; color: var(--fg); }
  .toast.fade-out {
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 160ms ease, transform 160ms ease;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .history-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .history-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; }
  .history-summary { font-size: 0.78rem; color: var(--fg-muted); }
  .history-scroll { max-height: 360px; overflow-y: auto; padding-right: 0.2rem; }
  .history-scroll.collapsed { display: none; }
  .history-controls { display: inline-flex; align-items: center; gap: 0.45rem; }
  .history-jump.hidden { display: none; }
  .history-item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    background: rgba(255,255,255,0.02);
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }
  :root[data-theme="light"] .history-item { background: var(--bg); }
  .history-meta { font-size: 0.74rem; color: var(--fg-muted); margin-bottom: 0.35rem; }
  .history-content { white-space: normal; word-break: break-word; font-size: 0.84rem; line-height: 1.5; }
  .history-content > :first-child { margin-top: 0; }
  .history-content > :last-child { margin-bottom: 0; }
  .history-content p,
  .history-content ul,
  .history-content ol,
  .history-content pre,
  .history-content blockquote,
  .history-content h1,
  .history-content h2,
  .history-content h3,
  .history-content h4,
  .history-content h5,
  .history-content h6 { margin: 0 0 0.7rem; }
  .history-content ul,
  .history-content ol { padding-left: 1.2rem; }
  .history-content li + li { margin-top: 0.25rem; }
  .history-content blockquote {
    margin-left: 0;
    padding-left: 0.8rem;
    border-left: 3px solid var(--border);
    color: var(--fg-muted);
  }
  .history-content code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
    background: rgba(255,255,255,0.08);
    padding: 0.08rem 0.3rem;
    border-radius: 0.3rem;
  }
  :root[data-theme="light"] .history-content code { background: rgba(27,31,35,0.08); }
  .history-content pre {
    overflow-x: auto;
    padding: 0.75rem;
    border-radius: var(--radius);
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
  }
  :root[data-theme="light"] .history-content pre { background: rgba(27,31,35,0.04); }
  .history-content pre code {
    display: block;
    padding: 0;
    background: transparent;
    border-radius: 0;
    white-space: pre;
  }
  .history-content a {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 0.14rem;
  }
   .history-content a:hover { opacity: 0.9; }

  /* Image attachments in composer */
  .image-previews {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .image-previews:empty { display: none; }
  .image-preview {
    position: relative;
    width: 80px;
    height: 80px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    overflow: hidden;
    background: var(--bg);
    transition: border-color var(--transition-fast);
  }
  .image-preview:hover { border-color: var(--accent); }
  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .image-preview-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: none;
    background: rgba(0,0,0,0.65);
    color: #fff;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity var(--transition-fast);
    padding: 0;
  }
  .image-preview:hover .image-preview-remove { opacity: 1; }
  .image-preview-remove:hover { background: var(--danger); }
  .image-attach-label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: var(--radius);
    font-size: 0.9rem;
    cursor: pointer;
    font-weight: 500;
    background: var(--border);
    color: var(--fg);
    transition: opacity var(--transition-fast);
  }
  :root[data-theme="light"] .image-attach-label { background: #e1e4e8; }
  .image-attach-label:hover { opacity: 0.85; }
  .composer-drop-active {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 3px var(--accent-subtle) !important;
    background: var(--accent-subtle) !important;
  }

  /* Images in history entries */
  .history-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .history-images img {
    max-width: 240px;
    max-height: 180px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  .history-images img:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }

   /* Markdown toolbar */
  .md-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0.3rem 0.35rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    flex-wrap: wrap;
  }
  .md-toolbar + textarea {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .md-toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 26px;
    padding: 0 0.35rem;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--fg-muted);
    font-size: 0.78rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }
  .md-toolbar button:hover {
    background: var(--accent-subtle);
    color: var(--fg);
    border-color: var(--border);
    opacity: 1;
  }
  .md-toolbar button:active {
    background: var(--accent-subtle);
    border-color: var(--accent);
  }
  .md-toolbar button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .md-toolbar .md-toolbar-sep {
    width: 1px;
    height: 16px;
    margin: 0 0.25rem;
    background: var(--border);
    flex-shrink: 0;
  }
  .md-toolbar .md-btn-bold { font-weight: 700; }
  .md-toolbar .md-btn-italic { font-style: italic; }
  .md-toolbar .md-btn-heading { font-weight: 600; font-size: 0.82rem; }
  .md-toolbar-hint {
    margin-left: auto;
    font-size: 0.68rem;
    color: var(--fg-muted);
    opacity: 0.6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    white-space: nowrap;
  }
  @media (max-width: 480px) {
    .md-toolbar { gap: 1px; padding: 0.2rem; }
    .md-toolbar button { min-width: 24px; height: 24px; font-size: 0.72rem; }
    .md-toolbar-hint { display: none; }
  }

  /* Image lightbox overlay */
  .image-lightbox {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0,0,0,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
    animation: lightbox-in 150ms ease-out;
  }
  .image-lightbox img {
    max-width: 90vw;
    max-height: 90vh;
    border-radius: var(--radius);
    box-shadow: 0 8px 40px rgba(0,0,0,0.5);
  }
  @keyframes lightbox-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .app-footer {
    text-align: center;
    padding: 0.75rem 1rem;
    font-size: 0.75rem;
    color: #888;
    border-top: 1px solid #eee;
  }
  .app-footer a { color: #888; text-decoration: none; }
  .app-footer a:hover { text-decoration: underline; color: #555; }
  .app-footer .version { opacity: 0.7; }
  @media (prefers-color-scheme: dark) {
    .app-footer { border-top-color: #333; color: #666; }
    .app-footer a { color: #666; }
    .app-footer a:hover { color: #999; }
  }
`;
