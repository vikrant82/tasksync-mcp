/**
 * Shared HTML template for the TaskSync feedback web UI.
 * Used by both the standalone feedback-server and the embedded MCP server.
 *
 * The placeholder ACTIVE_SESSION_INFO is replaced at serve time with the current session label.
 */

import { FEEDBACK_HTML_ENHANCED_STYLES } from "./styles.js";
import { FEEDBACK_HTML_COMPOSER_HISTORY_SCRIPT } from "./scripts.js";

export const FEEDBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TaskSync Feedback</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-surface: #161b22;
    --fg: #c9d1d9;
    --fg-muted: #8b949e;
    --accent: #58a6ff;
    --accent-subtle: rgba(88,166,255,0.15);
    --border: #30363d;
    --success: #3fb950;
    --success-subtle: rgba(63,185,80,0.15);
    --danger: #f85149;
    --danger-subtle: rgba(248,81,73,0.15);
    --warning: #d29922;
    --warning-subtle: rgba(210,153,34,0.15);
    --radius: 6px;
    --transition-fast: 0.15s ease;
    --transition-normal: 0.25s ease;
  }

  :root[data-theme="light"] {
    --bg: #ffffff;
    --bg-surface: #f6f8fa;
    --fg: #1f2328;
    --fg-muted: #656d76;
    --accent: #0969da;
    --accent-subtle: rgba(9,105,218,0.12);
    --border: #d0d7de;
    --success: #1a7f37;
    --success-subtle: rgba(26,127,55,0.12);
    --danger: #cf222e;
    --danger-subtle: rgba(207,34,46,0.12);
    --warning: #9a6700;
    --warning-subtle: rgba(154,103,0,0.12);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1rem;
    transition: background var(--transition-normal), color var(--transition-normal);
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: var(--accent); }
  .subtitle { color: var(--fg-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .container { width: 100%; max-width: 1400px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr); gap: 1rem; align-items: start; }
  .main-column, .sidebar-column { display: flex; flex-direction: column; gap: 1rem; }
  .panel {
    margin-top: 0;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem;
    transition: background var(--transition-normal), border-color var(--transition-normal);
  }
  .panel h2 { font-size: 0.95rem; color: var(--fg-muted); margin-bottom: 0.5rem; }
  .session-meta { font-size: 0.8rem; color: var(--fg-muted); margin-bottom: 0.5rem; }
  .notify-controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; font-size: 0.78rem; color: var(--fg-muted); margin: 0.35rem 0 0.6rem; }
  .notify-controls label { display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; }
  .session-actions { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .session-actions input {
    flex: 1;
    padding: 0.45rem 0.55rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: monospace;
    font-size: 0.8rem;
    transition: border-color var(--transition-fast);
  }
  .session-actions input:focus { border-color: var(--accent); outline: none; }
  .session-list { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; max-height: 260px; overflow-y: auto; }
  .session-item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem;
    background: rgba(255,255,255,0.02);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);
  }
  :root[data-theme="light"] .session-item { background: var(--bg); }
  .session-item.active { border-color: var(--accent); }
  .session-item.stale { opacity: 0.55; }
  .session-item.alert { border-color: rgba(63,185,80,0.55); box-shadow: 0 0 0 2px rgba(63,185,80,0.08) inset; }
  :root[data-theme="light"] .session-item.alert { border-color: rgba(26,127,55,0.5); box-shadow: 0 0 0 2px rgba(26,127,55,0.06) inset; }
  .session-name { font-size: 0.82rem; font-weight: 600; color: var(--fg); margin-bottom: 0.15rem; }
  .session-item.route-target .session-name { font-weight: 800; color: var(--accent); }
  .session-id { font-family: monospace; font-size: 0.8rem; word-break: break-all; color: var(--fg-muted); }
  .session-meta { font-size: 0.72rem; color: var(--fg-muted); margin: 0.15rem 0; opacity: 0.8; }
  .session-flags { font-size: 0.75rem; color: var(--fg-muted); margin: 0.25rem 0; }
  .flag {
    display: inline-block;
    margin-right: 0.35rem;
    margin-bottom: 0.2rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 0.68rem;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }
  .flag-waiting { color: #b6f0bf; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.14); }
  .flag-idle { color: #b9d8ff; border-color: rgba(88,166,255,0.35); background: rgba(88,166,255,0.1); }
  .flag-queue { color: #ffd58a; border-color: rgba(255,196,99,0.45); background: rgba(255,196,99,0.14); }
  .flag-noqueue { color: #c9d1d9; border-color: rgba(139,148,158,0.45); background: rgba(139,148,158,0.1); }
  .flag-route { color: #d2b8ff; border-color: rgba(186,140,255,0.45); background: rgba(186,140,255,0.14); }
  .flag-stale { color: #f0883e; border-color: rgba(240,136,62,0.45); background: rgba(240,136,62,0.14); }
  .flag-disconnected { color: #f85149; border-color: rgba(248,81,73,0.45); background: rgba(248,81,73,0.14); }
  .flag-remote { color: #79c0ff; border-color: rgba(121,192,255,0.45); background: rgba(121,192,255,0.14); }
  :root[data-theme="light"] .flag-waiting { color: #1a7f37; border-color: rgba(26,127,55,0.4); background: rgba(26,127,55,0.08); }
  :root[data-theme="light"] .flag-idle { color: #0969da; border-color: rgba(9,105,218,0.3); background: rgba(9,105,218,0.06); }
  :root[data-theme="light"] .flag-queue { color: #9a6700; border-color: rgba(154,103,0,0.4); background: rgba(154,103,0,0.08); }
  :root[data-theme="light"] .flag-noqueue { color: #656d76; border-color: rgba(101,109,118,0.4); background: rgba(101,109,118,0.06); }
  :root[data-theme="light"] .flag-route { color: #8250df; border-color: rgba(130,80,223,0.4); background: rgba(130,80,223,0.08); }
  :root[data-theme="light"] .flag-stale { color: #bc4c00; border-color: rgba(188,76,0,0.4); background: rgba(188,76,0,0.08); }
  :root[data-theme="light"] .flag-disconnected { color: #cf222e; border-color: rgba(207,34,46,0.4); background: rgba(207,34,46,0.08); }
  :root[data-theme="light"] .flag-remote { color: #0550ae; border-color: rgba(5,80,174,0.4); background: rgba(5,80,174,0.08); }
  .session-alert-badge { display: inline-block; margin-left: 0.4rem; padding: 0.05rem 0.35rem; border-radius: 999px; font-size: 0.68rem; color: #b6f0bf; border: 1px solid rgba(63,185,80,0.45); background: rgba(63,185,80,0.14); }
  :root[data-theme="light"] .session-alert-badge { color: #1a7f37; border-color: rgba(26,127,55,0.4); background: rgba(26,127,55,0.08); }
  .session-buttons { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.3rem; }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-small { padding: 0.35rem 0.65rem; font-size: 0.8rem; }
  .session-link { color: var(--accent); font-size: 0.75rem; text-decoration: none; }
  .session-link:hover { text-decoration: underline; }
  .wait-banner {
    display: none;
    margin: 0.75rem 0 1rem;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 0.85rem;
    transition: background var(--transition-normal), border-color var(--transition-normal), color var(--transition-normal);
  }
  .wait-banner.waiting { display: block; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.12); color: #b6f0bf; animation: pulse 2.4s ease-in-out infinite; will-change: opacity; }
  .wait-banner.idle { display: block; border-color: rgba(88,166,255,0.35); background: rgba(88,166,255,0.1); color: #b9d8ff; }
  :root[data-theme="light"] .wait-banner.waiting { border-color: rgba(26,127,55,0.4); background: rgba(26,127,55,0.08); color: #1a7f37; }
  :root[data-theme="light"] .wait-banner.idle { border-color: rgba(9,105,218,0.3); background: rgba(9,105,218,0.06); color: #0969da; }
  .feedback-box.waiting { border-color: rgba(63,185,80,0.45); box-shadow: 0 0 0 3px rgba(63,185,80,0.08); }
  :root[data-theme="light"] .feedback-box.waiting { border-color: rgba(26,127,55,0.4); box-shadow: 0 0 0 3px rgba(26,127,55,0.06); }
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.6; }
    100% { opacity: 1; }
  }
   @media (prefers-reduced-motion: reduce) {
    .wait-banner.waiting { animation: none; }
    * { transition-duration: 0.01ms !important; }
  }

  /* Agent context panel */
  .agent-context-panel {
    margin: 0.5rem 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-surface);
    overflow: hidden;
    transition: border-color var(--transition-normal);
  }
  .agent-context-panel:has(.agent-context-content:not(:empty)) {
    border-color: rgba(121,192,255,0.35);
  }
  .agent-context-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.45rem 0.75rem;
    background: rgba(121,192,255,0.06);
    border-bottom: 1px solid var(--border);
    font-size: 0.78rem;
    color: var(--fg-muted);
  }
  .agent-context-title {
    font-weight: 500;
    color: #79c0ff;
  }
  :root[data-theme="light"] .agent-context-title {
    color: #0969da;
  }
  :root[data-theme="light"] .agent-context-panel:has(.agent-context-content:not(:empty)) {
    border-color: rgba(9,105,218,0.3);
  }
  :root[data-theme="light"] .agent-context-header {
    background: rgba(9,105,218,0.04);
  }
  .agent-context-content {
    padding: 0.6rem 0.75rem;
    font-size: 0.82rem;
    line-height: 1.55;
    max-height: 300px;
    overflow-y: auto;
    word-break: break-word;
    color: var(--fg);
  }
  .agent-context-content p { margin: 0.3em 0; }
  .agent-context-content pre { margin: 0.4em 0; padding: 0.5em; background: var(--bg-input); border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
  .agent-context-content code { font-size: 0.9em; background: var(--bg-input); padding: 0.1em 0.3em; border-radius: 3px; }
  .agent-context-content pre code { background: none; padding: 0; }
  .agent-context-content ul, .agent-context-content ol { margin: 0.3em 0; padding-left: 1.4em; }
  .agent-context-content blockquote { margin: 0.3em 0; padding-left: 0.7em; border-left: 3px solid var(--border); color: var(--fg-muted); }
  .agent-context-content h1, .agent-context-content h2, .agent-context-content h3,
  .agent-context-content h4, .agent-context-content h5, .agent-context-content h6 { margin: 0.4em 0 0.2em; font-size: 0.92em; }
  .agent-context-content:empty { display: none; }
  .agent-context-content.collapsed { display: none; }
  textarea {
    width: 100%;
    min-height: 200px;
    max-height: 55vh;
    padding: 0.75rem;
    background: var(--bg-surface);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.9rem;
    resize: none;
    overflow-y: hidden;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--accent-subtle);
  }
  .quick-actions-label { font-size: 0.78rem; color: var(--fg-muted); margin-right: 0.1rem; }
  .quick-actions[hidden] { display: none; }
  .quick-actions .btn-secondary,
  .quick-actions .btn-primary,
  .quick-actions .btn-danger {
    min-width: 8rem;
  }
  .queued-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--warning, #e2a308);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--warning, #e2a308) 12%, transparent);
    font-size: 0.85rem;
  }
  .queued-banner[hidden] { display: none; }
  .queued-banner-body {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
    overflow: hidden;
  }
  .queued-banner-label { font-weight: 600; white-space: nowrap; color: var(--fg-muted); }
  .queued-banner-preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
  }
  .urgent-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--danger, #ef4444);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
    font-size: 0.85rem;
  }
  .urgent-banner[hidden] { display: none; }
  .urgent-banner-label { font-weight: 600; white-space: nowrap; color: var(--danger, #ef4444); }
  .btn-warning {
    padding: 0.5rem 1.2rem;
    font-size: 0.97rem;
    font-weight: 600;
    border-radius: var(--radius);
    border: 1.5px solid var(--warning, #e2a308);
    background: color-mix(in srgb, var(--warning, #e2a308) 18%, transparent);
    color: var(--fg);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }
  .btn-warning:hover {
    background: color-mix(in srgb, var(--warning, #e2a308) 30%, transparent);
    border-color: var(--warning, #e2a308);
  }
  .btn-warning:active { transform: scale(0.97); }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.75rem;
  }
  .action-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .action-group-submit { margin-left: auto; }
  button {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: var(--radius);
    font-size: 0.9rem;
    cursor: pointer;
    font-weight: 500;
    transition: opacity var(--transition-fast), box-shadow var(--transition-fast);
  }
  button:hover { opacity: 0.85; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-primary { background: var(--accent); color: #fff; }
  :root:not([data-theme="light"]) .btn-primary { color: #000; }
  .btn-secondary { background: var(--border); color: var(--fg); }
  :root[data-theme="light"] .btn-secondary { background: #e1e4e8; }
  button:disabled { cursor: progress; opacity: 0.75; }
  .btn-busy {
    position: relative;
    pointer-events: none;
  }
  .btn-busy::after {
    content: '';
    display: inline-block;
    width: 0.8rem;
    height: 0.8rem;
    margin-left: 0.45rem;
    border-radius: 999px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    vertical-align: -0.1rem;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
${FEEDBACK_HTML_ENHANCED_STYLES}
  .filepath { color: var(--fg-muted); font-size: 0.75rem; margin-bottom: 1rem; font-family: monospace; }
  .session-name-highlight { color: var(--accent); font-weight: 700; font-size: 0.85rem; letter-spacing: 0.02em; }
  kbd { background: var(--border); padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.8rem; }

  /* Focus-visible for all interactive elements */
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  input[type="checkbox"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Inline rename input */
  .rename-inline {
    padding: 0.25rem 0.4rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    font-size: 0.8rem;
    font-family: inherit;
    width: 100%;
    margin-top: 0.25rem;
  }
  .rename-inline:focus { outline: none; box-shadow: 0 0 0 2px var(--accent-subtle); }

  /* Connection status indicator */
  .connection-status {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--fg-muted);
  }
  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    transition: background var(--transition-fast);
  }
  .connection-dot.disconnected { background: var(--danger); }
  .connection-dot.reconnecting { background: var(--warning); }

  /* Theme toggle button */
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 0.78rem;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }
  .theme-toggle:hover { border-color: var(--accent); color: var(--fg); }

  /* Custom scrollbar styling */
  .session-list::-webkit-scrollbar,
  .history-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .session-list::-webkit-scrollbar-track,
  .history-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .session-list::-webkit-scrollbar-thumb,
  .history-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }
  .session-list::-webkit-scrollbar-thumb:hover,
  .history-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--fg-muted);
  }

  /* Empty state styling */
  .empty-state {
    text-align: center;
    padding: 1.5rem 1rem;
    color: var(--fg-muted);
    font-size: 0.85rem;
  }
  .empty-state-icon {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
    opacity: 0.5;
  }

  /* Session search/filter */
  .session-filter {
    width: 100%;
    padding: 0.35rem 0.5rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.78rem;
    margin-bottom: 0.45rem;
    transition: border-color var(--transition-fast);
  }
  .session-filter:focus { border-color: var(--accent); outline: none; }

  @media (max-width: 980px) {
    .layout { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    body { padding: 1rem 0.5rem; }
    textarea { min-height: 140px; }
    .session-buttons { gap: 0.25rem; }
    .btn-small { padding: 0.3rem 0.5rem; font-size: 0.75rem; }
    .session-actions { flex-wrap: wrap; }
    .session-actions input { min-width: 0; }
    .quick-actions-label { width: 100%; }
    .action-row { align-items: stretch; }
    .action-group { width: 100%; }
    .action-group-submit { margin-left: 0; }
    .action-group-submit .btn-primary { width: 100%; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>TaskSync Feedback</h1>
  <div class="subtitle">Type your feedback below. Press <kbd>Cmd+Enter</kbd> to submit. <span class="connection-status" id="connection-status"><span class="connection-dot" id="connection-dot"></span> <span id="connection-label">Connecting...</span></span></div>
  <div id="active-session-summary" class="filepath">ACTIVE_SESSION_INFO</div>
  <div id="wait-banner" class="wait-banner idle" role="status" aria-live="polite">Checking agent wait state...</div>
  <div id="agent-context-panel" class="agent-context-panel" style="display:none;" role="region" aria-labelledby="agent-context-heading">
    <div class="agent-context-header">
      <span id="agent-context-heading" class="agent-context-title">Last assistant message</span>
      <button type="button" id="agent-context-toggle" class="btn-secondary btn-small" aria-expanded="true" aria-controls="agent-context-content">Collapse</button>
    </div>
    <div id="agent-context-content" class="agent-context-content"></div>
  </div>
  <div class="layout">
    <div class="main-column">
      <div class="panel">
        <h2 id="composer-heading">Send feedback</h2>
        <form id="form" aria-labelledby="composer-heading">
          <label for="feedback" class="sr-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Feedback message</label>
          <div id="quick-actions" class="quick-actions" hidden>
            <span class="quick-actions-label">Quick replies</span>
            <button type="button" id="approve-button" class="btn-secondary">Approve</button>
            <button type="button" id="continue-button" class="btn-secondary">Continue</button>
            <button type="button" id="stop-button" class="btn-danger">Stop</button>
            <button type="button" id="pause-button" class="btn-secondary">Pause Session</button>
          </div>
          <div id="queued-banner" class="queued-banner" hidden>
            <div class="queued-banner-body">
              <span class="queued-banner-label">Queued:</span>
              <span id="queued-banner-preview" class="queued-banner-preview"></span>
            </div>
            <button type="button" id="cancel-queued-btn" class="btn-danger btn-small">Cancel</button>
          </div>
          <div id="urgent-banner" class="urgent-banner" hidden>
            <div class="queued-banner-body">
              <span class="urgent-banner-label">Urgent (pending):</span>
              <span id="urgent-banner-preview" class="queued-banner-preview"></span>
            </div>
            <button type="button" id="cancel-urgent-btn" class="btn-danger btn-small">Cancel</button>
          </div>
          <div class="md-toolbar" id="md-toolbar" role="toolbar" aria-label="Markdown formatting">
            <button type="button" data-md="bold" class="md-btn-bold" title="Bold (Ctrl+B)">B</button>
            <button type="button" data-md="italic" class="md-btn-italic" title="Italic (Ctrl+I)">I</button>
            <button type="button" data-md="code" title="Inline code (Ctrl+\`)">&#60;/&#62;</button>
            <button type="button" data-md="codeblock" title="Code block">\`\`\`</button>
            <span class="md-toolbar-sep" role="separator"></span>
            <button type="button" data-md="ul" title="Bullet list">&#8226; list</button>
            <button type="button" data-md="ol" title="Numbered list">1.</button>
            <button type="button" data-md="heading" class="md-btn-heading" title="Heading"># H</button>
            <span class="md-toolbar-sep" role="separator"></span>
            <button type="button" data-md="link" title="Link (Ctrl+K)">&#128279;</button>
            <button type="button" data-md="hr" title="Horizontal rule">&#8212;</button>
            <button type="button" data-md="quote" title="Blockquote">&#8220;</button>
            <span class="md-toolbar-hint">Tab indents &middot; Esc to exit</span>
          </div>
          <textarea id="feedback" class="feedback-box" placeholder="Type your feedback here... (paste or drag images)" autofocus aria-describedby="keyboard-hint"></textarea>
          <span id="keyboard-hint" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Press Cmd+Enter or Ctrl+Enter to submit. Tab to indent. Escape to exit textarea.</span>
          <div id="image-previews" class="image-previews"></div>
          <div class="action-row">
            <div class="action-group">
              <label class="image-attach-label" tabindex="0" role="button" aria-label="Attach image">
                <input type="file" id="image-input" accept="image/png,image/jpeg,image/gif,image/webp" multiple style="display:none" />
                Attach Image
              </label>
              <button type="button" id="clear-button" class="btn-secondary" onclick="clearFeedback()">Clear Draft</button>
            </div>
            <div class="action-group action-group-submit">
              <button type="button" id="interrupt-button" class="btn-warning" onclick="sendUrgentFeedback()" title="Send as urgent interrupt (agent sees it immediately, even mid-task)">Interrupt</button>
              <button type="submit" id="send-button" class="btn-primary">Send Feedback</button>
            </div>
          </div>
        </form>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </div>
      <div class="panel">
        <div class="history-panel-header">
          <h2 id="history-heading">Conversation history</h2>
          <div class="history-controls">
            <span id="history-summary" class="history-summary" aria-live="polite">Loading...</span>
            <button type="button" id="history-jump" class="btn-secondary btn-small history-jump hidden" aria-label="Jump to latest message">Jump to latest</button>
            <button type="button" id="history-toggle" class="btn-secondary btn-small" aria-expanded="true" aria-controls="history-scroll">Collapse</button>
          </div>
        </div>
        <div id="history-scroll" class="history-scroll" role="log" aria-labelledby="history-heading" aria-live="polite">
          <div id="history-list" class="history-list">
            <div class="history-item"><div class="history-content">Loading...</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-column">
      <div class="panel">
        <h2 id="sessions-heading">Sessions</h2>
        <div id="session-meta" class="session-meta" aria-live="polite">Loading sessions...</div>
        <div class="session-actions">
          <label for="active-session-input" class="sr-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Session ID to set as default</label>
          <input id="active-session-input" placeholder="Session ID to set as default" />
          <button type="button" class="btn-secondary btn-small" onclick="setActiveFromInput()">Set Default</button>
          <button type="button" class="btn-secondary btn-small" onclick="loadSessions()">Refresh</button>
           <button type="button" class="btn-secondary btn-small" onclick="pruneStaleSessions()" id="prune-stale-btn" title="Remove sessions inactive for over 30 minutes">Prune Stale</button>
        </div>
        <label for="session-filter" class="sr-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Filter sessions</label>
        <input id="session-filter" class="session-filter" placeholder="Filter sessions..." type="search" />
        <ul id="session-list" class="session-list" role="list" aria-labelledby="sessions-heading" aria-live="polite"></ul>
      </div>
      <div class="panel">
        <h2 id="settings-heading">Settings</h2>
         <div class="notify-controls">
           <label><input id="notify-sound" type="checkbox" checked /> Sound alert</label>
            <label><input id="notify-desktop" type="checkbox" /> Desktop alert</label>
           <label><input id="show-agent-context" type="checkbox" /> Show assistant messages</label>
           <label>Protocol reminder:
             <select id="protocol-reminder-every" aria-label="Protocol reminder frequency">
               <option value="0">Off</option>
               <option value="1">Every feedback</option>
               <option value="2">Every 2nd feedback</option>
               <option value="3">Every 3rd feedback</option>
               <option value="5">Every 5th feedback</option>
               <option value="10">Every 10th feedback</option>
             </select>
           </label>
           <label>Mode:
             <select id="notify-mode" aria-label="Notification mode">
               <option value="focused">Focused session</option>
               <option value="all">All sessions</option>
             </select>
           </label>
           <label>Auto-prune after:
              <select id="disconnect-after" aria-label="Auto-prune inactive sessions after">
                <option value="0" selected>Never</option>
                <option value="5">5 min</option>
                <option value="10">10 min</option>
                <option value="20">20 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="1440">24 hours</option>
              </select>
           </label>
           <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Toggle light/dark theme">
             <span id="theme-icon">&#9790;</span> <span id="theme-label">Light</span>
           </button>
         </div>
      </div>
    </div>
  </div>
</div>
<footer class="app-footer">
  <a href="TASKSYNC_GITHUB_URL" target="_blank" rel="noopener noreferrer">TaskSync</a> <span class="version">vTASKSYNC_VERSION</span>
</footer>
<div id="toast-viewport" class="toast-viewport" aria-live="polite" aria-atomic="false"></div>
<script>
  // ── DOM references ──
  const form = document.getElementById('form');
  const textbox = document.getElementById('feedback');
  const statusEl = document.getElementById('status');
  const toastViewportEl = document.getElementById('toast-viewport');
  const sendButtonEl = document.getElementById('send-button');
  const interruptButtonEl = document.getElementById('interrupt-button');
  const clearButtonEl = document.getElementById('clear-button');
  const imagePreviewsEl = document.getElementById('image-previews');
  const imageInputEl = document.getElementById('image-input');
  const quickActionsEl = document.getElementById('quick-actions');
  const approveButtonEl = document.getElementById('approve-button');
  const continueButtonEl = document.getElementById('continue-button');
  const stopButtonEl = document.getElementById('stop-button');
  const pauseButtonEl = document.getElementById('pause-button');
  const mdToolbarEl = document.getElementById('md-toolbar');
  const historyListEl = document.getElementById('history-list');
  const historyScrollEl = document.getElementById('history-scroll');
  const historySummaryEl = document.getElementById('history-summary');
  const historyJumpEl = document.getElementById('history-jump');
  const historyToggleEl = document.getElementById('history-toggle');
  const waitBannerEl = document.getElementById('wait-banner');
  const activeSessionSummaryEl = document.getElementById('active-session-summary');
  const sessionMetaEl = document.getElementById('session-meta');
  const sessionListEl = document.getElementById('session-list');
  const activeSessionInputEl = document.getElementById('active-session-input');
  const sessionFilterEl = document.getElementById('session-filter');
  const queuedBannerEl = document.getElementById('queued-banner');
  const queuedBannerPreviewEl = document.getElementById('queued-banner-preview');
  const cancelQueuedBtnEl = document.getElementById('cancel-queued-btn');
  const connectionDotEl = document.getElementById('connection-dot');
  const connectionLabelEl = document.getElementById('connection-label');
  const themeToggleEl = document.getElementById('theme-toggle');
  const themeIconEl = document.getElementById('theme-icon');
  const themeLabelEl = document.getElementById('theme-label');
  const disconnectAfterEl = document.getElementById('disconnect-after');
  const protocolReminderEveryEl = document.getElementById('protocol-reminder-every');
  const agentContextPanelEl = document.getElementById('agent-context-panel');
  const agentContextContentEl = document.getElementById('agent-context-content');
  const agentContextToggleEl = document.getElementById('agent-context-toggle');
  const showAgentContextEl = document.getElementById('show-agent-context');

  // ── SSE and state tracking ──
  let uiEventSource = null;
  let lastRenderedHistorySignature = '';
  let lastRenderedSessionSignature = '';
  let channelsAvailable = false;

  // ── Session routing ──
  const pathSessionMatch = window.location.pathname.match(/^\\/session\\/([^/]+)$/);
  const pathSessionParam = pathSessionMatch ? decodeURIComponent(pathSessionMatch[1]) : '';
  let selectedSessionId = String(pathSessionParam || '').trim();

  // ── Notification elements and storage keys ──
  const notifySoundEl = document.getElementById('notify-sound');
  const notifyDesktopEl = document.getElementById('notify-desktop');
  const notifyModeEl = document.getElementById('notify-mode');
  const STORAGE_NOTIFY_SOUND = 'tasksync.notify.sound';
  const STORAGE_NOTIFY_DESKTOP = 'tasksync.notify.desktop';
  const STORAGE_NOTIFY_MODE = 'tasksync.notify.mode';
  const STORAGE_HISTORY_COLLAPSED = 'tasksync.history.collapsed';
  const STORAGE_SHOW_AGENT_CONTEXT = 'tasksync.show_agent_context';
  const STORAGE_AGENT_CONTEXT_COLLAPSED = 'tasksync.agent_context.collapsed';
   const STORAGE_DRAFT = pathSessionParam ? 'tasksync.draft.' + pathSessionParam : 'tasksync.draft';
  const STORAGE_THEME = 'tasksync.theme';

  // ── Notification state ──
  let lastWaitSignature = '';
  const notifiedSessions = new Set();
${FEEDBACK_HTML_COMPOSER_HISTORY_SCRIPT}
  // ── Image lightbox ──
  function openLightbox(src) {
    const overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Full-size image';
    overlay.appendChild(img);
    overlay.addEventListener('click', function() { overlay.remove(); });
    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', handler);
      }
    });
    document.body.appendChild(overlay);
  }

  function renderSessionItem(s, active, filterText) {
    const isActive = s.sessionId === active;
    const isRoute = s.sessionId === selectedSessionId;
    const alias = (typeof s.alias === 'string') ? s.alias.trim() : '';
    const displayName = alias || s.sessionId;

    if (filterText) {
      const lower = filterText.toLowerCase();
      const matchesAlias = alias.toLowerCase().includes(lower);
      const matchesId = s.sessionId.toLowerCase().includes(lower);
      if (!matchesAlias && !matchesId) return '';
    }

    if (isRoute) {
      notifiedSessions.delete(s.sessionId);
    }
    const hasAlert = notifiedSessions.has(s.sessionId);
    const waitingFlag = s.waitingForFeedback
      ? '<span class="flag flag-waiting">waiting</span>'
      : '<span class="flag flag-idle">idle</span>';
    const queueFlag = s.hasQueuedFeedback
      ? '<span class="flag flag-queue">queued</span>'
      : '<span class="flag flag-noqueue">no-queue</span>';
    const routeFlag = isRoute
      ? '<span class="flag flag-route">route-target</span>'
      : '';
    const staleThreshold = 30 * 60 * 1000;
    const isDisconnected = s.status === 'disconnected';
    const isStale = !isDisconnected && !s.waitingForFeedback && s.lastActivityAt && (Date.now() - new Date(s.lastActivityAt).getTime()) > staleThreshold;
    const staleFlag = isStale ? '<span class="flag flag-stale" title="No activity for over 30 minutes">stale</span>' : '';
    const disconnectedFlag = isDisconnected ? '<span class="flag flag-disconnected" title="Client disconnected' + (s.disconnectedAt ? ' ' + formatElapsed(s.disconnectedAt) + ' ago' : '') + '">disconnected</span>' : '';
    const remoteFlag = s.remoteEnabled ? '<span class="flag flag-remote" title="Remote notifications enabled">remote</span>' : '';
    const sessionUrl = s.sessionUrl || ('/session/' + encodeURIComponent(s.sessionId));
    const metaCreated = s.createdAt ? formatTimeShort(new Date(s.createdAt)) : '';
    const metaActivity = s.lastActivityAt ? formatElapsed(s.lastActivityAt) + ' ago' : '';
    const metaWait = (s.waitingForFeedback && s.waitStartedAt) ? formatElapsed(s.waitStartedAt) : '';
    const metaDisconnected = (isDisconnected && s.disconnectedAt) ? formatElapsed(s.disconnectedAt) + ' ago' : '';
    const metaParts = [];
    if (metaCreated) metaParts.push('Created ' + metaCreated);
    if (metaActivity) metaParts.push('Active ' + metaActivity);
    if (metaWait) metaParts.push('Waiting ' + metaWait);
    if (metaDisconnected) metaParts.push('Disconnected ' + metaDisconnected);
    const metaLine = metaParts.length > 0
      ? '<div class="session-meta">' + metaParts.join(' · ') + '</div>'
      : '';
    return '<li class="session-item ' + (isRoute ? 'route-target ' : '') + (isActive ? 'active ' : '') + (isStale ? 'stale ' : '') + (hasAlert ? 'alert' : '') + '">'
      + '<div class="session-name">' + escapeHtml(displayName) + '</div>'
      + (alias ? ('<div class="session-id">' + escapeHtml(s.sessionId) + '</div>') : '')
      + '<div class="session-flags">' + waitingFlag + queueFlag + routeFlag + staleFlag + disconnectedFlag + remoteFlag + (hasAlert ? ' <span class="session-alert-badge">new wait</span>' : '') + '</div>'
      + metaLine
      + '<a class="session-link" href="' + sessionUrl + '" target="_blank" rel="noopener">Open in new window</a>'
      + '<div class="session-buttons">'
      + '<button type="button" class="btn-secondary btn-small" data-action="rename" data-session-id="' + escapeHtml(s.sessionId) + '" data-session-alias="' + escapeHtml(alias) + '">Rename</button>'
      + (isRoute
        ? '<button type="button" class="btn-secondary btn-small" disabled title="Already the active route target">Current</button>'
        : '<button type="button" class="btn-secondary btn-small" data-action="route" data-session-id="' + escapeHtml(s.sessionId) + '">Route Here</button>')
      + '<button type="button" class="btn-secondary btn-small" data-action="set-default" data-session-id="' + escapeHtml(s.sessionId) + '">Set Default</button>'
      + (channelsAvailable
        ? '<button type="button" class="btn-secondary btn-small" data-action="toggle-remote" data-session-id="' + escapeHtml(s.sessionId) + '" data-remote-enabled="' + (s.remoteEnabled ? 'true' : 'false') + '">' + (s.remoteEnabled ? 'Disable Remote' : 'Enable Remote') + '</button>'
        : '')
      + '<button type="button" class="btn-danger btn-small" data-action="disconnect" data-session-id="' + escapeHtml(s.sessionId) + '">Disconnect</button>'
      + '</div>'
      + '</li>';
  }

  function renderSessionList(sessions, active) {
    const filterText = sessionFilterEl.value.trim();
    if (sessions.length === 0) {
      sessionListEl.innerHTML = '<li class="empty-state"><div class="empty-state-icon">&#128268;</div>No active streamable sessions</li>';
      updatePruneButton(0);
      return;
    }
    const staleThreshold = 30 * 60 * 1000;
    const staleCount = sessions.filter(function(s) { return !s.waitingForFeedback && s.lastActivityAt && (Date.now() - new Date(s.lastActivityAt).getTime()) > staleThreshold; }).length;
    updatePruneButton(staleCount);
    const html = sessions.map((s) => renderSessionItem(s, active, filterText)).filter(Boolean).join('');
    if (!html) {
      sessionListEl.innerHTML = '<li class="empty-state">No sessions match filter</li>';
      return;
    }
    sessionListEl.innerHTML = html;
  }

  function updatePruneButton(staleCount) {
    const btn = document.getElementById('prune-stale-btn');
    if (!btn) return;
    btn.textContent = staleCount > 0 ? 'Prune Stale (' + staleCount + ')' : 'Prune Stale';
    btn.disabled = staleCount === 0;
  }

  function detectNotificationTransitions(sessions, targetSessionId) {
    for (const s of sessions) {
      const wasWaiting = Boolean(previousWaitBySession.get(s.sessionId));
      const isWaitingNow = Boolean(s.waitingForFeedback);
      if (!wasWaiting && isWaitingNow) {
        const mode = notifyModeEl.value || 'focused';
        const shouldNotify = mode === 'all' || s.sessionId === targetSessionId;
        if (shouldNotify) {
          notifyWaitingTransition(s.sessionId);
          notifiedSessions.add(s.sessionId);
        }
      }
      previousWaitBySession.set(s.sessionId, isWaitingNow);
    }
    for (const prevId of Array.from(previousWaitBySession.keys())) {
      if (!sessions.some((s) => s.sessionId === prevId)) {
        previousWaitBySession.delete(prevId);
        notifiedSessions.delete(prevId);
      }
    }
  }

  function updateWaitBanner(targetSessionId, sessions) {
    const waitingSessions = sessions.filter((s) => Boolean(s.waitingForFeedback));
    const targetSession = sessions.find((s) => s.sessionId === targetSessionId);
    const targetWaiting = Boolean(targetSession && targetSession.waitingForFeedback);
    const anyWaiting = waitingSessions.length > 0;
    const firstWaitingSession = waitingSessions[0] || null;

    // Stop existing timer — will restart if still needed
    if (waitTimerInterval) { clearInterval(waitTimerInterval); waitTimerInterval = null; }
    if (quickActionsEl) quickActionsEl.hidden = !targetWaiting;
    if (interruptButtonEl) interruptButtonEl.hidden = targetWaiting;

    if (targetWaiting) {
      const startedAt = targetSession.waitStartedAt;
      currentWaitStartedAt = startedAt;
      const renderText = function() {
        const elapsed = startedAt ? ' (' + formatElapsed(startedAt) + ')' : '';
        waitBannerEl.textContent = 'Agent waiting for feedback' + elapsed;
      };
      waitBannerEl.className = 'wait-banner waiting';
      renderText();
      if (startedAt) waitTimerInterval = setInterval(renderText, 1000);
      textbox.classList.add('waiting');
      document.title = 'TaskSync - Agent Waiting';
      const signature = targetSessionId + ':waiting';
      if (lastWaitSignature !== signature) {
        notifyWaitingTransition(targetSessionId);
        lastWaitSignature = signature;
      }
    } else if (anyWaiting) {
      const startedAt = firstWaitingSession.waitStartedAt;
      currentWaitStartedAt = startedAt;
      const renderText = function() {
        const elapsed = startedAt ? ' (' + formatElapsed(startedAt) + ')' : '';
        waitBannerEl.textContent = 'A different session is waiting' + elapsed + ': ' + firstWaitingSession.sessionId + '. Use Route Here to focus it.';
      };
      waitBannerEl.className = 'wait-banner waiting';
      renderText();
      if (startedAt) waitTimerInterval = setInterval(renderText, 1000);
      textbox.classList.remove('waiting');
      document.title = 'TaskSync - Session Waiting';
    } else {
      waitBannerEl.className = 'wait-banner idle';
      waitBannerEl.textContent = 'No session is currently blocked on get_feedback.';
      textbox.classList.remove('waiting');
      document.title = 'TaskSync Feedback';
      lastWaitSignature = 'idle';
      currentWaitStartedAt = null;
    }
  }

  function updateQueuedBanner(sessions) {
    if (!queuedBannerEl) return;
    const target = selectedSessionId || '';
    const session = Array.isArray(sessions)
      ? sessions.find(function(s) { return s.sessionId === target; })
      : null;
    if (session && session.queuedFeedbackPreview) {
      queuedBannerPreviewEl.textContent = '"' + session.queuedFeedbackPreview + '"';
      queuedBannerEl.hidden = false;
    } else {
      queuedBannerEl.hidden = true;
    }
  }

  function updateUrgentBanner(sessions) {
    var urgentBannerEl = document.getElementById('urgent-banner');
    var urgentPreviewEl = document.getElementById('urgent-banner-preview');
    if (!urgentBannerEl || !urgentPreviewEl) return;
    var target = selectedSessionId || '';
    var session = Array.isArray(sessions)
      ? sessions.find(function(s) { return s.sessionId === target; })
      : null;
    if (session && session.urgentFeedbackPreview) {
      urgentPreviewEl.textContent = '"' + session.urgentFeedbackPreview + '"';
      urgentBannerEl.hidden = false;
    } else {
      urgentBannerEl.hidden = true;
    }
  }

  function resolveSelectedSession(sessions, active, fallbackSessionId) {
    if (selectedSessionId && !sessions.some((s) => s.sessionId === selectedSessionId)) {
      selectedSessionId = (active && active !== '(none)') ? active : '';
    }
    if (!selectedSessionId) {
      selectedSessionId = fallbackSessionId || active || '';
    }
    activeSessionInputEl.value = selectedSessionId;
  }

  function updateActiveSessionSummary(active, sessions) {
    if (!activeSessionSummaryEl) return;
    const list = Array.isArray(sessions) ? sessions : [];
    const targetSessionId = selectedSessionId || active || '(none)';
    const targetSession = list.find((session) => session.sessionId === targetSessionId);
    const alias = targetSession && targetSession.alias ? targetSession.alias : '';
    const displayLabel = alias ? (alias + ' (' + targetSessionId + ')') : targetSessionId;
    activeSessionSummaryEl.innerHTML = 'Active session: <span class="session-name-highlight">' + escapeHtml(displayLabel) + '</span> | Known sessions: ' + list.length;
  }

  function updateSessionMeta(active, sessions) {
    const routeHint = selectedSessionId ? (' | Route: ' + selectedSessionId) : '';
    sessionMetaEl.textContent = 'Default (fallback): ' + active + routeHint + ' | Total sessions: ' + sessions.length;
  }

  // ── Session filter ──
  sessionFilterEl.addEventListener('input', () => {
    if (lastSessionsData) {
      renderSessionList(lastSessionsData, lastActiveId);
    }
  });

  // ── loadSessions: initial load & manual refresh (uses shared helpers) ──
  async function loadSessions() {
    try {
      const res = await fetch('/sessions');
      if (!res.ok) {
        sessionMetaEl.textContent = 'Unable to load sessions';
        sessionListEl.innerHTML = '';
        return;
      }

      const payload = await res.json();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const active = payload.defaultUiSessionId || payload.activeUiSessionId || '(none)';
      channelsAvailable = !!payload.channelsAvailable;

      lastSessionsData = sessions;
      lastActiveId = active;

      resolveSelectedSession(sessions, active, '');
      updateActiveSessionSummary(active, sessions);
      updateSessionMeta(active, sessions);

      const targetSessionId = selectedSessionId || active;
      detectNotificationTransitions(sessions, targetSessionId);
      updateWaitBanner(targetSessionId, sessions);

      const sessionSignature = JSON.stringify(sessions.map((s) => [s.sessionId, s.alias, s.waitingForFeedback, s.hasQueuedFeedback, s.hasUrgentFeedback, s.remoteEnabled, s.status, s.disconnectedAt])) + ':' + selectedSessionId + ':' + channelsAvailable;
      if (sessionSignature !== lastRenderedSessionSignature) {
        renderSessionList(sessions, active);
        lastRenderedSessionSignature = sessionSignature;
      }
    } catch (err) {
      console.error('Error loading sessions:', err);
      sessionMetaEl.textContent = 'Error loading sessions';
      sessionListEl.innerHTML = '';
    }
  }

  // ── Session management actions ──
  async function setActiveSession(sessionId) {
    try {
      const res = await fetch('/sessions/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      if (!res.ok) {
        showStatus('Failed to set active session', 'error');
        return;
      }

      activeSessionInputEl.value = sessionId;
      selectedSessionId = sessionId;
      lastActiveId = sessionId;
      notifiedSessions.delete(sessionId);
      updateActiveSessionSummary(lastActiveId, lastSessionsData || []);
      updateSessionMeta(lastActiveId, lastSessionsData || []);
      updateUrlSession(sessionId);
      connectEvents();
      showStatus('Default session updated', 'success');
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  async function disconnectSession(sessionId) {
    if (!confirm('Disconnect session "' + sessionId + '"? This will terminate the session.')) {
      return;
    }
    try {
      const res = await fetch('/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
      if (!res.ok) {
        showStatus('Failed to disconnect session', 'error');
        return;
      }

      showStatus('Session disconnected', 'success');
      if (selectedSessionId === sessionId) {
        selectedSessionId = '';
        activeSessionInputEl.value = '';
        updateActiveSessionSummary(lastActiveId, lastSessionsData || []);
        updateSessionMeta(lastActiveId, lastSessionsData || []);
        updateUrlSession('');
      }
      connectEvents();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  async function toggleRemoteMode(sessionId, enable) {
    try {
      const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/remote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable })
      });
      if (!res.ok) {
        showStatus('Failed to toggle remote mode', 'error');
        return;
      }
      showStatus(enable ? 'Remote notifications enabled' : 'Remote notifications disabled', 'success');
      loadSessions();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  // ── Prune stale sessions ──
  async function pruneStaleSessions() {
    const maxAgeMs = 30 * 60 * 1000;
    if (!confirm('Remove all sessions inactive for over 30 minutes?')) return;
    try {
      const res = await fetch('/sessions/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeMs }),
      });
      if (!res.ok) {
        showStatus('Failed to prune sessions', 'error');
        return;
      }
      const data = await res.json();
      if (data.prunedCount > 0) {
        showStatus('Pruned ' + data.prunedCount + ' stale session(s)', 'success');
        if (data.pruned.includes(selectedSessionId)) {
          selectedSessionId = '';
          activeSessionInputEl.value = '';
          updateUrlSession('');
        }
        connectEvents();
      } else {
        showStatus('No stale sessions found', 'success');
      }
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  // ── Inline rename (replaces window.prompt) ──
  function startInlineRename(sessionId, currentAlias) {
    const existingInput = sessionListEl.querySelector('.rename-inline');
    if (existingInput) {
      existingInput.closest('li')?.querySelector('.session-name')?.style.removeProperty('display');
      existingInput.remove();
    }

    const sessionItem = sessionListEl.querySelector('button[data-action="rename"][data-session-id="' + CSS.escape(sessionId) + '"]')?.closest('.session-item');
    if (!sessionItem) return;

    const nameEl = sessionItem.querySelector('.session-name');
    if (!nameEl) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-inline';
    input.value = currentAlias || '';
    input.placeholder = 'Session alias (empty to clear)';

    nameEl.style.display = 'none';
    nameEl.insertAdjacentElement('afterend', input);
    input.focus();
    input.select();

    async function commitRename() {
      const nextAlias = input.value;
      nameEl.style.removeProperty('display');
      input.remove();

      try {
        const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/alias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias: nextAlias })
        });
        if (!res.ok) {
          showStatus('Failed to rename session', 'error');
          return;
        }
        const payload = await res.json();
        const alias = (payload && typeof payload.alias === 'string') ? payload.alias : '';
        showStatus(alias ? 'Session alias updated' : 'Session alias cleared', 'success');
      } catch (err) {
        showStatus('Error: ' + err.message, 'error');
      }
    }

    function cancelRename() {
      nameEl.style.removeProperty('display');
      input.remove();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== input) {
          commitRename();
        }
      }, 100);
    });
  }

  function routeToSession(sessionId) {
    selectedSessionId = sessionId;
    activeSessionInputEl.value = sessionId;
    notifiedSessions.delete(sessionId);
    updateActiveSessionSummary(lastActiveId, lastSessionsData || []);
    updateSessionMeta(lastActiveId, lastSessionsData || []);
    updateQueuedBanner(lastSessionsData || []);
    updateUrgentBanner(lastSessionsData || []);
    updateUrlSession(sessionId);
    connectEvents();
    showStatus('Routing feedback to selected session', 'success');
  }

  function setActiveFromInput() {
    const sessionId = activeSessionInputEl.value.trim();
    if (!sessionId) {
      showStatus('Enter a session ID first', 'error');
      return;
    }
    routeToSession(sessionId);
    setActiveSession(sessionId);
  }

  // ── Event delegation for session list actions ──
  sessionListEl.addEventListener('click', (event) => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof HTMLElement)) return;
    const button = rawTarget.closest('button[data-action]');
    if (!button) return;

    const action = button.getAttribute('data-action');
    const sessionId = button.getAttribute('data-session-id') || '';
    if (!sessionId) return;

    if (action === 'route') {
      routeToSession(sessionId);
      return;
    }

    if (action === 'rename') {
      const currentAlias = button.getAttribute('data-session-alias') || '';
      startInlineRename(sessionId, currentAlias);
      return;
    }

    if (action === 'set-default') {
      setActiveSession(sessionId);
      return;
    }

    if (action === 'disconnect') {
      disconnectSession(sessionId);
    }

    if (action === 'toggle-remote') {
      const currentlyEnabled = button.getAttribute('data-remote-enabled') === 'true';
      toggleRemoteMode(sessionId, !currentlyEnabled);
    }
  });

  // ── History rendering ──
  function renderHistory(history) {
    const entries = Array.isArray(history) ? history : [];
    const shouldAutoScroll = !historyCollapsed && (lastRenderedHistorySignature === '' || isHistoryNearBottom());
    const newSignature = JSON.stringify(entries.map((entry) => [entry?.createdAt || '', entry?.content || '', (entry?.images || []).length]));
    if (newSignature === lastRenderedHistorySignature) return;
    lastRenderedHistorySignature = newSignature;

    historySummaryEl.textContent = entries.length === 0
      ? 'No messages yet'
      : (entries.length === 1 ? '1 message' : (entries.length + ' messages'));

    if (entries.length === 0) {
      historyListEl.innerHTML = '<div class="history-item"><div class="history-content">No submitted feedback yet for this session.</div></div>';
      updateHistoryJumpVisibility();
      return;
    }

    historyListEl.innerHTML = entries.slice().reverse().map((entry) => {
      const createdAt = entry && typeof entry.createdAt === 'string' ? entry.createdAt : '';
      const content = entry && typeof entry.content === 'string' ? entry.content : '';
      const images = entry && Array.isArray(entry.images) ? entry.images : [];
      const label = formatHistoryTimestamp(createdAt);
      let imagesHtml = '';
      if (images.length > 0) {
        imagesHtml = '<div class="history-images">' + images.map(function(img) {
          if (!img || !img.data || !img.mimeType) return '';
          const src = 'data:' + escapeHtml(img.mimeType) + ';base64,' + img.data;
          return '<img src="' + src + '" alt="Attached image" loading="lazy" onclick="openLightbox(this.src)" />';
        }).join('') + '</div>';
      }
      return '<div class="history-item">'
        + '<div class="history-meta">You \\u2022 ' + escapeHtml(label) + (images.length > 0 ? ' \\u2022 ' + images.length + ' image' + (images.length > 1 ? 's' : '') : '') + '</div>'
        + '<div class="history-content">' + renderMarkdownContent(content) + '</div>'
        + imagesHtml
        + '</div>';
    }).join('');

    if (shouldAutoScroll) {
      requestAnimationFrame(() => {
        scrollHistoryToBottom();
        updateHistoryJumpVisibility();
      });
      return;
    }

    updateHistoryJumpVisibility();
  }

  // ── applyUiState: SSE-driven state update (uses shared helpers) ──
  function applyUiState(payload) {
    if (!payload || typeof payload !== 'object') return;
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const active = payload.activeUiSessionId || '(none)';
    channelsAvailable = !!payload.channelsAvailable;

    lastSessionsData = sessions;
    lastActiveId = active;

    resolveSelectedSession(sessions, active, payload.sessionId || '');
    updateActiveSessionSummary(active, sessions);
    const history = Array.isArray(payload.history) ? payload.history : [];
    renderHistory(history);
    updateSessionMeta(active, sessions);

    const targetSessionId = selectedSessionId || active;
    detectNotificationTransitions(sessions, targetSessionId);
    updateWaitBanner(targetSessionId, sessions);
    updateQueuedBanner(sessions);
    updateUrgentBanner(sessions);
    updateAgentContextPanel(payload.agentContext || null, payload.agentContextSource || null);

    const sessionSignature = JSON.stringify(sessions.map((s) => [s.sessionId, s.alias, s.waitingForFeedback, s.hasQueuedFeedback, s.hasUrgentFeedback, s.remoteEnabled])) + ':' + selectedSessionId + ':' + channelsAvailable;
    if (sessionSignature !== lastRenderedSessionSignature) {
      renderSessionList(sessions, active);
      lastRenderedSessionSignature = sessionSignature;
    }
  }

  // ── Connection status helpers ──
  function setConnectionStatus(state) {
    connectionDotEl.className = 'connection-dot' + (state === 'connected' ? '' : (' ' + state));
    connectionLabelEl.textContent = state === 'connected' ? 'Connected' : (state === 'reconnecting' ? 'Reconnecting...' : 'Disconnected');
  }

  // ── SSE connection with smart reconnection ──
  function connectEvents() {
    if (uiEventSource) {
      uiEventSource.close();
    }
    const suffix = selectedSessionId ? ('?sessionId=' + encodeURIComponent(selectedSessionId)) : '';
    uiEventSource = new EventSource('/events' + suffix);
    uiEventSource.addEventListener('state', (event) => {
      try {
        setConnectionStatus('connected');
        applyUiState(JSON.parse(event.data));
      } catch {
        // Ignore JSON parse errors from SSE events
      }
    });
    uiEventSource.addEventListener('open', () => {
      setConnectionStatus('connected');
    });
    uiEventSource.onerror = () => {
      setConnectionStatus('reconnecting');
    };
  }

  // ── Markdown toolbar delegation ──
  mdToolbarEl.addEventListener('mousedown', function(e) {
    e.preventDefault();
  });
  mdToolbarEl.addEventListener('click', function(e) {
    const btn = e.target.closest('button[data-md]');
    if (!btn) return;
    mdToolbarAction(btn.getAttribute('data-md'));
  });

  // ── Cancel queued feedback ──
  if (cancelQueuedBtnEl) {
    cancelQueuedBtnEl.addEventListener('click', async function() {
      const sessionId = selectedSessionId;
      if (!sessionId) return;
      try {
        const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/cancel-queued', { method: 'POST' });
        if (res.ok) {
          queuedBannerEl.hidden = true;
          showStatus('Queued message cancelled', 'success');
        }
      } catch (err) {
        showStatus('Failed to cancel', 'error');
      }
    });
  }

  // ── Cancel urgent feedback ──
  var cancelUrgentBtnEl = document.getElementById('cancel-urgent-btn');
  if (cancelUrgentBtnEl) {
    cancelUrgentBtnEl.addEventListener('click', async function() {
      const sessionId = selectedSessionId;
      if (!sessionId) return;
      try {
        const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/cancel-urgent', { method: 'POST' });
        if (res.ok) {
          var urgentBannerEl = document.getElementById('urgent-banner');
          if (urgentBannerEl) urgentBannerEl.hidden = true;
          showStatus('Urgent message cancelled', 'success');
        }
      } catch (err) {
        showStatus('Failed to cancel urgent', 'error');
      }
    });
  }

  // ── Send urgent (interrupt) feedback ──
  window.sendUrgentFeedback = async function() {
    const sessionId = selectedSessionId;
    if (!sessionId) { showStatus('Select a session first', 'error'); return; }
    const content = textbox.value.trim();
    if (!content) { showStatus('Type a message first', 'error'); return; }
    try {
      const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/urgent-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      });
      if (res.ok) {
        const data = await res.json();
        textbox.value = '';
        textbox.style.height = 'auto';
        if (data.delivered) {
          showStatus('Urgent message delivered to agent', 'success');
        } else {
          showStatus('Urgent message queued (agent will see it on next check_interrupts)', 'success');
        }
      } else {
        const data = await res.json().catch(function() { return {}; });
        showStatus(data.error || 'Failed to send urgent', 'error');
      }
    } catch (err) {
      showStatus('Failed to send urgent: ' + err.message, 'error');
    }
  };

  // ── Auto-prune timeout: load from server, save on change ──
  async function loadDisconnectAfter() {
    try {
      const res = await fetch('/settings');
      if (res.ok) {
        const data = await res.json();
        if (disconnectAfterEl && typeof data.disconnectAfterMinutes === 'number') {
          disconnectAfterEl.value = String(data.disconnectAfterMinutes);
        }
        if (protocolReminderEveryEl && typeof data.protocolReminderEveryN === 'number') {
          protocolReminderEveryEl.value = String(data.protocolReminderEveryN);
        }
      }
    } catch { /* ignore */ }
  }
  if (disconnectAfterEl) {
    disconnectAfterEl.addEventListener('change', async () => {
      const minutes = parseInt(disconnectAfterEl.value, 10);
      if (isNaN(minutes)) return;
      try {
        const res = await fetch('/settings/disconnect-after', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes })
        });
         if (res.ok) {
           showStatus(minutes === 0 ? 'Auto-prune disabled (use Prune Stale for manual cleanup)' : 'Auto-prune timeout updated to ' + minutes + ' min', 'success');
         } else {
          showStatus('Failed to update auto-prune timeout', 'error');
        }
      } catch (err) {
        showStatus('Error: ' + err.message, 'error');
      }
    });
  }

  if (protocolReminderEveryEl) {
    protocolReminderEveryEl.addEventListener('change', async () => {
      try {
        const res = await fetch('/settings/protocol-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ everyN: parseInt(protocolReminderEveryEl.value, 10) || 0 })
        });
        if (res.ok) {
          const everyN = parseInt(protocolReminderEveryEl.value, 10) || 0;
          showStatus(everyN > 0 ? 'Protocol reminder cadence updated' : 'Protocol reminder disabled', 'success');
        } else {
          showStatus('Failed to update protocol reminder setting', 'error');
        }
      } catch (err) {
        showStatus('Error: ' + err.message, 'error');
      }
    });
  }

  // ── Bootstrap ──
  loadDisconnectAfter();
  loadSessions();
  connectEvents();
</script>
</body>
</html>`;
