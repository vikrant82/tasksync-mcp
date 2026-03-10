/**
 * Shared HTML template for the TaskSync feedback web UI.
 * Used by both the standalone feedback-server and the embedded MCP server.
 *
 * The placeholder ACTIVE_SESSION_INFO is replaced at serve time with the current session label.
 */

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
  :root[data-theme="light"] .flag-waiting { color: #1a7f37; border-color: rgba(26,127,55,0.4); background: rgba(26,127,55,0.08); }
  :root[data-theme="light"] .flag-idle { color: #0969da; border-color: rgba(9,105,218,0.3); background: rgba(9,105,218,0.06); }
  :root[data-theme="light"] .flag-queue { color: #9a6700; border-color: rgba(154,103,0,0.4); background: rgba(154,103,0,0.08); }
  :root[data-theme="light"] .flag-noqueue { color: #656d76; border-color: rgba(101,109,118,0.4); background: rgba(101,109,118,0.06); }
  :root[data-theme="light"] .flag-route { color: #8250df; border-color: rgba(130,80,223,0.4); background: rgba(130,80,223,0.08); }
  :root[data-theme="light"] .flag-stale { color: #bc4c00; border-color: rgba(188,76,0,0.4); background: rgba(188,76,0,0.08); }
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
  .wait-banner.waiting { display: block; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.12); color: #b6f0bf; animation: pulse 1.8s ease-in-out infinite; }
  .wait-banner.idle { display: block; border-color: rgba(88,166,255,0.35); background: rgba(88,166,255,0.1); color: #b9d8ff; }
  :root[data-theme="light"] .wait-banner.waiting { border-color: rgba(26,127,55,0.4); background: rgba(26,127,55,0.08); color: #1a7f37; }
  :root[data-theme="light"] .wait-banner.idle { border-color: rgba(9,105,218,0.3); background: rgba(9,105,218,0.06); color: #0969da; }
  .feedback-box.waiting { border-color: rgba(63,185,80,0.45); box-shadow: 0 0 0 3px rgba(63,185,80,0.08); }
  :root[data-theme="light"] .feedback-box.waiting { border-color: rgba(26,127,55,0.4); box-shadow: 0 0 0 3px rgba(26,127,55,0.06); }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(63,185,80,0.24); }
    70% { box-shadow: 0 0 0 8px rgba(63,185,80,0); }
    100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wait-banner.waiting { animation: none; }
    * { transition-duration: 0.01ms !important; }
  }
  textarea {
    width: 100%;
    min-height: 200px;
    padding: 0.75rem;
    background: var(--bg-surface);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.9rem;
    resize: vertical;
    outline: none;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }
  textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
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
  .status {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    font-size: 0.85rem;
    display: none;
    transition: opacity var(--transition-fast);
  }
  .status.success { display: block; background: var(--success-subtle); color: var(--success); border: 1px solid rgba(63,185,80,0.3); }
  :root[data-theme="light"] .status.success { border-color: rgba(26,127,55,0.3); }
  .status.error { display: block; background: var(--danger-subtle); color: var(--danger); border: 1px solid rgba(248,81,73,0.3); }
  :root[data-theme="light"] .status.error { border-color: rgba(207,34,46,0.3); }
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
  .history-content { white-space: pre-wrap; word-break: break-word; font-size: 0.84rem; }
  .filepath { color: var(--fg-muted); font-size: 0.75rem; margin-bottom: 1rem; font-family: monospace; }
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
  }
</style>
</head>
<body>
<div class="container">
  <h1>TaskSync Feedback</h1>
  <div class="subtitle">Type your feedback below. Press <kbd>Cmd+Enter</kbd> to submit. <span class="connection-status" id="connection-status"><span class="connection-dot" id="connection-dot"></span> <span id="connection-label">Connecting...</span></span></div>
  <div class="filepath">ACTIVE_SESSION_INFO</div>
  <div id="wait-banner" class="wait-banner idle" role="status" aria-live="polite">Checking agent wait state...</div>
  <div class="layout">
    <div class="main-column">
      <div class="panel">
        <h2 id="composer-heading">Send feedback</h2>
        <form id="form" aria-labelledby="composer-heading">
          <label for="feedback" class="sr-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Feedback message</label>
          <textarea id="feedback" class="feedback-box" placeholder="Type your feedback here..." autofocus aria-describedby="keyboard-hint"></textarea>
          <span id="keyboard-hint" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;">Press Cmd+Enter or Ctrl+Enter to submit, Escape to blur</span>
          <div class="actions">
            <button type="submit" class="btn-primary">Send Feedback</button>
            <button type="button" class="btn-secondary" onclick="clearFeedback()">Clear Draft</button>
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
          <button type="button" class="btn-secondary btn-small" onclick="pruneStaleSessions()" id="prune-stale-btn" title="Remove sessions inactive for over 1 hour">Prune Stale</button>
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
          <label>Mode:
            <select id="notify-mode" aria-label="Notification mode">
              <option value="focused">Focused session</option>
              <option value="all">All sessions</option>
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
<script>
  // ── DOM references ──
  const form = document.getElementById('form');
  const textbox = document.getElementById('feedback');
  const statusEl = document.getElementById('status');
  const historyListEl = document.getElementById('history-list');
  const historyScrollEl = document.getElementById('history-scroll');
  const historySummaryEl = document.getElementById('history-summary');
  const historyJumpEl = document.getElementById('history-jump');
  const historyToggleEl = document.getElementById('history-toggle');
  const waitBannerEl = document.getElementById('wait-banner');
  const sessionMetaEl = document.getElementById('session-meta');
  const sessionListEl = document.getElementById('session-list');
  const activeSessionInputEl = document.getElementById('active-session-input');
  const sessionFilterEl = document.getElementById('session-filter');
  const connectionDotEl = document.getElementById('connection-dot');
  const connectionLabelEl = document.getElementById('connection-label');
  const themeToggleEl = document.getElementById('theme-toggle');
  const themeIconEl = document.getElementById('theme-icon');
  const themeLabelEl = document.getElementById('theme-label');

  // ── SSE and state tracking ──
  let uiEventSource = null;
  let lastRenderedHistorySignature = '';
  let lastRenderedSessionSignature = '';

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
   const STORAGE_DRAFT = pathSessionParam ? 'tasksync.draft.' + pathSessionParam : 'tasksync.draft';
  const STORAGE_THEME = 'tasksync.theme';

  // ── Notification state ──
  let lastWaitSignature = '';
  const notifiedSessions = new Set();
  const previousWaitBySession = new Map();
  let audioContext = null;
  let audioUnlocked = false;

  // ── Wait timer state ──
  let waitTimerInterval = null;
  let currentWaitStartedAt = null;

   function formatElapsed(isoStart) {
     const ms = Date.now() - new Date(isoStart).getTime();
     if (ms < 0) return '0s';
     const totalSec = Math.floor(ms / 1000);
     const h = Math.floor(totalSec / 3600);
     const m = Math.floor((totalSec % 3600) / 60);
     const s = totalSec % 60;
     if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
     if (m > 0) return m + 'm ' + s + 's';
     return s + 's';
   }

   function formatTimeShort(date) {
     const h = date.getHours();
     const m = String(date.getMinutes()).padStart(2, '0');
     const ampm = h >= 12 ? 'PM' : 'AM';
     const h12 = h % 12 || 12;
     return h12 + ':' + m + ' ' + ampm;
   }

  // ── Last known sessions for filter re-rendering ──
  let lastSessionsData = null;
  let lastActiveId = '(none)';

  // ── Initialize settings from localStorage ──
  notifySoundEl.checked = localStorage.getItem(STORAGE_NOTIFY_SOUND) !== '0';
  notifyDesktopEl.checked = localStorage.getItem(STORAGE_NOTIFY_DESKTOP) === '1';
  notifyModeEl.value = localStorage.getItem(STORAGE_NOTIFY_MODE) || 'focused';
  let historyCollapsed = localStorage.getItem(STORAGE_HISTORY_COLLAPSED) === '1';

  // ── Restore draft from localStorage ──
  const savedDraft = localStorage.getItem(STORAGE_DRAFT);
  if (savedDraft) {
    textbox.value = savedDraft;
  }

  // ── Draft persistence on input ──
  textbox.addEventListener('input', () => {
    localStorage.setItem(STORAGE_DRAFT, textbox.value);
  });

  // ── Theme initialization ──
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_THEME, theme);
    if (theme === 'light') {
      themeIconEl.textContent = '\\u2600';
      themeLabelEl.textContent = 'Dark';
    } else {
      themeIconEl.textContent = '\\u263e';
      themeLabelEl.textContent = 'Light';
    }
  }

  function getPreferredTheme() {
    const stored = localStorage.getItem(STORAGE_THEME);
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  applyTheme(getPreferredTheme());

  themeToggleEl.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // ── Settings change handlers ──
  notifySoundEl.addEventListener('change', () => {
    localStorage.setItem(STORAGE_NOTIFY_SOUND, notifySoundEl.checked ? '1' : '0');
    if (notifySoundEl.checked) {
      unlockAudioContext();
    }
  });

  notifyDesktopEl.addEventListener('change', async () => {
    if (notifyDesktopEl.checked) {
      const granted = await ensureDesktopPermission();
      if (!granted) {
        notifyDesktopEl.checked = false;
      }
    }
    localStorage.setItem(STORAGE_NOTIFY_DESKTOP, notifyDesktopEl.checked ? '1' : '0');
  });

  notifyModeEl.addEventListener('change', () => {
    localStorage.setItem(STORAGE_NOTIFY_MODE, notifyModeEl.value || 'focused');
  });

  // ── History collapse controls ──
  function updateHistoryCollapseUi() {
    historyScrollEl.classList.toggle('collapsed', historyCollapsed);
    historyToggleEl.textContent = historyCollapsed ? 'Expand' : 'Collapse';
    historyToggleEl.setAttribute('aria-expanded', String(!historyCollapsed));
  }

  function isHistoryNearBottom() {
    return (historyScrollEl.scrollHeight - historyScrollEl.scrollTop - historyScrollEl.clientHeight) < 32;
  }

  function scrollHistoryToBottom() {
    historyScrollEl.scrollTop = historyScrollEl.scrollHeight;
  }

  function updateHistoryJumpVisibility() {
    const hidden = historyCollapsed || isHistoryNearBottom();
    historyJumpEl.classList.toggle('hidden', hidden);
  }

  historyToggleEl.addEventListener('click', () => {
    historyCollapsed = !historyCollapsed;
    localStorage.setItem(STORAGE_HISTORY_COLLAPSED, historyCollapsed ? '1' : '0');
    updateHistoryCollapseUi();
    updateHistoryJumpVisibility();
  });

  historyJumpEl.addEventListener('click', () => {
    scrollHistoryToBottom();
    updateHistoryJumpVisibility();
  });

  historyScrollEl.addEventListener('scroll', () => {
    updateHistoryJumpVisibility();
  });

  updateHistoryCollapseUi();
  updateHistoryJumpVisibility();

  // ── Audio context management ──
  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    try {
      audioContext = new AudioContextCtor();
      audioUnlocked = audioContext.state === 'running';
      return audioContext;
    } catch {
      return null;
    }
  }

  async function unlockAudioContext() {
    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    audioUnlocked = ctx.state === 'running';
    return audioUnlocked;
  }

  async function ensureDesktopPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  // Browser autoplay policies require a user gesture before WebAudio can play.
  async function primeAlertsFromGesture() {
    if (notifySoundEl.checked && !audioUnlocked) {
      await unlockAudioContext();
    }
    if (notifyDesktopEl.checked && 'Notification' in window && Notification.permission === 'default') {
      const granted = await ensureDesktopPermission();
      if (!granted) {
        notifyDesktopEl.checked = false;
        localStorage.setItem(STORAGE_NOTIFY_DESKTOP, '0');
      }
    }
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, primeAlertsFromGesture, { passive: true });
  });

  // ── Sound & desktop notification helpers ──
  function playSoundAlert() {
    if (!notifySoundEl.checked) return;
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.04;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.14);
    } catch {
      // Ignore browser audio API failures.
    }
  }

  function showDesktopAlert(sessionId) {
    if (!notifyDesktopEl.checked) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('TaskSync: Agent waiting', {
        body: 'Session ' + sessionId + ' is waiting for feedback.',
      });
    } catch {
      // Ignore notification failures.
    }
  }

  function notifyWaitingTransition(sessionId) {
    playSoundAlert();
    showDesktopAlert(sessionId);
  }

  // ── URL management ──
  function updateUrlSession(sessionId) {
    const url = new URL(window.location.href);
    if (sessionId) {
      url.pathname = '/session/' + encodeURIComponent(sessionId);
      url.searchParams.delete('sessionId');
    } else {
      url.pathname = '/';
      url.searchParams.delete('sessionId');
    }
    window.history.replaceState({}, '', url.toString());
  }

  // ── Keyboard shortcuts ──
  textbox.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
      return;
    }
    if (e.key === 'Escape') {
      textbox.blur();
    }
  });

  // ── Form submission ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = textbox.value.trim();
    if (!text) return;
    const explicitSessionId = selectedSessionId || activeSessionInputEl.value.trim();
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, sessionId: explicitSessionId || undefined })
      });
      if (res.ok) {
        showStatus('Feedback sent!', 'success');
        textbox.value = '';
        localStorage.removeItem(STORAGE_DRAFT);
      } else {
        showStatus('Failed to send: ' + (await res.text()), 'error');
      }
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  });

  async function clearFeedback() {
    const explicitSessionId = selectedSessionId || activeSessionInputEl.value.trim();
    try {
      await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', sessionId: explicitSessionId || undefined })
      });
      textbox.value = '';
      localStorage.removeItem(STORAGE_DRAFT);
      showStatus('Feedback draft cleared', 'success');
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  // ── Shared rendering helpers (Phase 1: deduplication) ──
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    setTimeout(() => { statusEl.className = 'status'; }, 3000);
  }

  function formatHistoryTimestamp(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
    const staleThreshold = 60 * 60 * 1000;
    const isStale = s.lastActivityAt && (Date.now() - new Date(s.lastActivityAt).getTime()) > staleThreshold;
    const staleFlag = isStale ? '<span class="flag flag-stale" title="No activity for over 1 hour">stale</span>' : '';
    const sessionUrl = s.sessionUrl || ('/session/' + encodeURIComponent(s.sessionId));
    const metaCreated = s.createdAt ? formatTimeShort(new Date(s.createdAt)) : '';
    const metaActivity = s.lastActivityAt ? formatElapsed(s.lastActivityAt) + ' ago' : '';
    const metaWait = (s.waitingForFeedback && s.waitStartedAt) ? formatElapsed(s.waitStartedAt) : '';
    const metaParts = [];
    if (metaCreated) metaParts.push('Created ' + metaCreated);
    if (metaActivity) metaParts.push('Active ' + metaActivity);
    if (metaWait) metaParts.push('Waiting ' + metaWait);
    const metaLine = metaParts.length > 0
      ? '<div class="session-meta">' + metaParts.join(' · ') + '</div>'
      : '';
    return '<li class="session-item ' + (isRoute ? 'route-target ' : '') + (isActive ? 'active ' : '') + (isStale ? 'stale ' : '') + (hasAlert ? 'alert' : '') + '">'
      + '<div class="session-name">' + escapeHtml(displayName) + '</div>'
      + (alias ? ('<div class="session-id">' + escapeHtml(s.sessionId) + '</div>') : '')
      + '<div class="session-flags">' + waitingFlag + queueFlag + routeFlag + staleFlag + (hasAlert ? ' <span class="session-alert-badge">new wait</span>' : '') + '</div>'
      + metaLine
      + '<a class="session-link" href="' + sessionUrl + '" target="_blank" rel="noopener">Open in new window</a>'
      + '<div class="session-buttons">'
      + '<button type="button" class="btn-secondary btn-small" data-action="rename" data-session-id="' + escapeHtml(s.sessionId) + '" data-session-alias="' + escapeHtml(alias) + '">Rename</button>'
      + (isRoute
        ? '<button type="button" class="btn-secondary btn-small" disabled title="Already the active route target">Current</button>'
        : '<button type="button" class="btn-secondary btn-small" data-action="route" data-session-id="' + escapeHtml(s.sessionId) + '">Route Here</button>')
      + '<button type="button" class="btn-secondary btn-small" data-action="set-default" data-session-id="' + escapeHtml(s.sessionId) + '">Set Default</button>'
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
    const staleThreshold = 60 * 60 * 1000;
    const staleCount = sessions.filter(function(s) { return s.lastActivityAt && (Date.now() - new Date(s.lastActivityAt).getTime()) > staleThreshold; }).length;
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

  function resolveSelectedSession(sessions, active, fallbackSessionId) {
    if (selectedSessionId && !sessions.some((s) => s.sessionId === selectedSessionId)) {
      selectedSessionId = (active && active !== '(none)') ? active : '';
    }
    if (!selectedSessionId) {
      selectedSessionId = fallbackSessionId || active || '';
    }
    activeSessionInputEl.value = selectedSessionId;
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

      lastSessionsData = sessions;
      lastActiveId = active;

      resolveSelectedSession(sessions, active, '');
      updateSessionMeta(active, sessions);

      const targetSessionId = selectedSessionId || active;
      detectNotificationTransitions(sessions, targetSessionId);
      updateWaitBanner(targetSessionId, sessions);

      const sessionSignature = JSON.stringify(sessions.map((s) => [s.sessionId, s.alias, s.waitingForFeedback, s.hasQueuedFeedback])) + ':' + selectedSessionId;
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
      notifiedSessions.delete(sessionId);
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
        updateUrlSession('');
      }
      connectEvents();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  // ── Prune stale sessions ──
  async function pruneStaleSessions() {
    const maxAgeMs = 60 * 60 * 1000;
    if (!confirm('Remove all sessions inactive for over 1 hour?')) return;
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
  });

  // ── History rendering ──
  function renderHistory(history) {
    const entries = Array.isArray(history) ? history : [];
    const shouldAutoScroll = !historyCollapsed && (lastRenderedHistorySignature === '' || isHistoryNearBottom());
    const newSignature = JSON.stringify(entries.map((entry) => [entry?.createdAt || '', entry?.content || '']));
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
      const label = formatHistoryTimestamp(createdAt);
      return '<div class="history-item">'
        + '<div class="history-meta">You \\u2022 ' + escapeHtml(label) + '</div>'
        + '<div class="history-content">' + escapeHtml(content) + '</div>'
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

    lastSessionsData = sessions;
    lastActiveId = active;

    resolveSelectedSession(sessions, active, payload.sessionId || '');
    const history = Array.isArray(payload.history) ? payload.history : [];
    renderHistory(history);
    updateSessionMeta(active, sessions);

    const targetSessionId = selectedSessionId || active;
    detectNotificationTransitions(sessions, targetSessionId);
    updateWaitBanner(targetSessionId, sessions);

    const sessionSignature = JSON.stringify(sessions.map((s) => [s.sessionId, s.alias, s.waitingForFeedback, s.hasQueuedFeedback])) + ':' + selectedSessionId;
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

  // ── Bootstrap ──
  loadSessions();
  connectEvents();
</script>
</body>
</html>`;
