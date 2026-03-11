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
`;
