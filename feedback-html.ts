/**
 * Shared HTML template for the TaskSync feedback web UI.
 * Used by both the standalone feedback-server and the embedded MCP server.
 *
 * The placeholder FEEDBACK_PATH is replaced at serve time with transport info text.
 */

export const FEEDBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TaskSync Feedback</title>
<style>
  :root { --bg: #0d1117; --fg: #c9d1d9; --accent: #58a6ff; --border: #30363d; --input-bg: #161b22; --success: #3fb950; --muted: #8b949e; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: var(--accent); }
  .subtitle { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .container { width: 100%; max-width: 1400px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr); gap: 1rem; align-items: start; }
  .main-column, .sidebar-column { display: flex; flex-direction: column; gap: 1rem; }
  .panel { margin-top: 0; background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; }
  .panel h2 { font-size: 0.95rem; color: var(--muted); margin-bottom: 0.5rem; }
  .session-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.5rem; }
  .notify-controls { display: flex; gap: 0.75rem; align-items: center; font-size: 0.78rem; color: var(--muted); margin: 0.35rem 0 0.6rem; }
  .notify-controls label { display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; }
  .session-actions { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .session-actions input { flex: 1; padding: 0.45rem 0.55rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-family: monospace; font-size: 0.8rem; }
  .session-list { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; max-height: 220px; overflow-y: auto; }
  .session-item { border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; background: rgba(255,255,255,0.02); }
  .session-item.active { border-color: var(--accent); }
  .session-item.alert { border-color: rgba(63,185,80,0.55); box-shadow: 0 0 0 2px rgba(63,185,80,0.08) inset; }
  .session-name { font-size: 0.82rem; font-weight: 600; color: var(--fg); margin-bottom: 0.15rem; }
  .session-id { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
  .session-flags { font-size: 0.75rem; color: var(--muted); margin: 0.25rem 0; }
  .flag { display: inline-block; margin-right: 0.35rem; margin-bottom: 0.2rem; padding: 0.05rem 0.4rem; border-radius: 999px; border: 1px solid var(--border); font-size: 0.68rem; }
  .flag-waiting { color: #b6f0bf; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.14); }
  .flag-idle { color: #b9d8ff; border-color: rgba(88,166,255,0.35); background: rgba(88,166,255,0.1); }
  .flag-queue { color: #ffd58a; border-color: rgba(255,196,99,0.45); background: rgba(255,196,99,0.14); }
  .flag-noqueue { color: #c9d1d9; border-color: rgba(139,148,158,0.45); background: rgba(139,148,158,0.1); }
  .flag-route { color: #d2b8ff; border-color: rgba(186,140,255,0.45); background: rgba(186,140,255,0.14); }
  .session-alert-badge { display: inline-block; margin-left: 0.4rem; padding: 0.05rem 0.35rem; border-radius: 999px; font-size: 0.68rem; color: #b6f0bf; border: 1px solid rgba(63,185,80,0.45); background: rgba(63,185,80,0.14); }
  .session-buttons { display: flex; gap: 0.4rem; }
  .btn-danger { background: #f85149; color: #fff; }
  .btn-small { padding: 0.35rem 0.65rem; font-size: 0.8rem; }
  .session-link { color: var(--accent); font-size: 0.75rem; text-decoration: none; }
  .session-link:hover { text-decoration: underline; }
  .wait-banner { display: none; margin: 0.75rem 0 1rem; padding: 0.6rem 0.75rem; border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; }
  .wait-banner.waiting { display: block; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.12); color: #b6f0bf; animation: pulse 1.8s ease-in-out infinite; }
  .wait-banner.idle { display: block; border-color: rgba(88,166,255,0.35); background: rgba(88,166,255,0.1); color: #b9d8ff; }
  .feedback-box.waiting { border-color: rgba(63,185,80,0.45); box-shadow: 0 0 0 3px rgba(63,185,80,0.08); }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(63,185,80,0.24); }
    70% { box-shadow: 0 0 0 8px rgba(63,185,80,0); }
    100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); }
  }
  textarea { width: 100%; min-height: 200px; padding: 0.75rem; background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 0.9rem; resize: vertical; outline: none; transition: border-color 0.2s; }
  textarea:focus { border-color: var(--accent); }
  .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  button { padding: 0.5rem 1rem; border: none; border-radius: 6px; font-size: 0.9rem; cursor: pointer; font-weight: 500; transition: opacity 0.2s; }
  button:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: #000; }
  .btn-secondary { background: var(--border); color: var(--fg); }
  .status { margin-top: 0.75rem; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; display: none; }
  .status.success { display: block; background: rgba(63,185,80,0.15); color: var(--success); border: 1px solid rgba(63,185,80,0.3); }
  .status.error { display: block; background: rgba(248,81,73,0.15); color: #f85149; border: 1px solid rgba(248,81,73,0.3); }
  .history-list { display: flex; flex-direction: column; gap: 0.6rem; }
  .history-panel-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; }
  .history-summary { font-size: 0.78rem; color: var(--muted); }
  .history-scroll { max-height: 360px; overflow-y: auto; padding-right: 0.2rem; }
  .history-scroll.collapsed { display: none; }
  .history-controls { display: inline-flex; align-items: center; gap: 0.45rem; }
  .history-jump.hidden { display: none; }
  .history-item { border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; background: rgba(255,255,255,0.02); }
  .history-meta { font-size: 0.74rem; color: var(--muted); margin-bottom: 0.35rem; }
  .history-content { white-space: pre-wrap; word-break: break-word; font-size: 0.84rem; }
  .filepath { color: var(--muted); font-size: 0.75rem; margin-bottom: 1rem; font-family: monospace; }
  kbd { background: var(--border); padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.8rem; }
  @media (max-width: 980px) {
    .layout { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>TaskSync Feedback</h1>
  <div class="subtitle">Type your feedback below. Press <kbd>Cmd+Enter</kbd> to submit.</div>
  <div class="filepath">Feedback transport: FEEDBACK_PATH</div>
  <div class="filepath">ACTIVE_SESSION_INFO</div>
  <div id="wait-banner" class="wait-banner idle">Checking agent wait state...</div>
  <div class="layout">
    <div class="main-column">
      <div class="panel">
        <h2>Send feedback</h2>
        <form id="form">
          <textarea id="feedback" class="feedback-box" placeholder="Type your feedback here..." autofocus></textarea>
          <div class="actions">
            <button type="submit" class="btn-primary">Send Feedback</button>
            <button type="button" class="btn-secondary" onclick="clearFeedback()">Clear Draft</button>
          </div>
        </form>
        <div id="status" class="status"></div>
      </div>
      <div class="panel">
        <div class="history-panel-header">
          <h2>Conversation history</h2>
          <div class="history-controls">
            <span id="history-summary" class="history-summary">Loading...</span>
            <button type="button" id="history-jump" class="btn-secondary btn-small history-jump hidden">Jump to latest</button>
            <button type="button" id="history-toggle" class="btn-secondary btn-small">Collapse</button>
          </div>
        </div>
        <div id="history-scroll" class="history-scroll">
          <div id="history-list" class="history-list">
            <div class="history-item"><div class="history-content">Loading...</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-column">
      <div class="panel">
        <h2>Sessions</h2>
        <div id="session-meta" class="session-meta">Loading sessions...</div>
        <div class="session-actions">
          <input id="active-session-input" placeholder="Session ID to set as default" />
          <button type="button" class="btn-secondary btn-small" onclick="setActiveFromInput()">Set Default</button>
          <button type="button" class="btn-secondary btn-small" onclick="loadSessions()">Refresh</button>
        </div>
        <ul id="session-list" class="session-list"></ul>
      </div>
      <div class="panel">
        <h2>Settings</h2>
        <div class="notify-controls">
          <label><input id="notify-sound" type="checkbox" checked /> Sound alert</label>
          <label><input id="notify-desktop" type="checkbox" /> Desktop alert</label>
          <label>Mode:
            <select id="notify-mode">
              <option value="focused">Focused session</option>
              <option value="all">All sessions</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
  const form = document.getElementById('form');
  const textbox = document.getElementById('feedback');
  const statusEl = document.getElementById('status');
  const historyListEl = document.getElementById('history-list');
  const historyScrollEl = document.getElementById('history-scroll');
  const historySummaryEl = document.getElementById('history-summary');
  const historyJumpEl = document.getElementById('history-jump');
  const historyToggleEl = document.getElementById('history-toggle');
  let uiEventSource = null;
  let lastRenderedHistorySignature = '';
  const waitBannerEl = document.getElementById('wait-banner');
  const sessionMetaEl = document.getElementById('session-meta');
  const sessionListEl = document.getElementById('session-list');
  const activeSessionInputEl = document.getElementById('active-session-input');
  const pathSessionMatch = window.location.pathname.match(/^\\/session\\/([^/]+)$/);
  const pathSessionParam = pathSessionMatch ? decodeURIComponent(pathSessionMatch[1]) : '';
  let selectedSessionId = String(pathSessionParam || '').trim();
  const notifySoundEl = document.getElementById('notify-sound');
  const notifyDesktopEl = document.getElementById('notify-desktop');
  const notifyModeEl = document.getElementById('notify-mode');
  const STORAGE_NOTIFY_SOUND = 'tasksync.notify.sound';
  const STORAGE_NOTIFY_DESKTOP = 'tasksync.notify.desktop';
  const STORAGE_NOTIFY_MODE = 'tasksync.notify.mode';
  const STORAGE_HISTORY_COLLAPSED = 'tasksync.history.collapsed';
  let lastWaitSignature = '';
  const notifiedSessions = new Set();
  const previousWaitBySession = new Map();
  let audioContext = null;
  let audioUnlocked = false;

  notifySoundEl.checked = localStorage.getItem(STORAGE_NOTIFY_SOUND) !== '0';
  notifyDesktopEl.checked = localStorage.getItem(STORAGE_NOTIFY_DESKTOP) === '1';
  notifyModeEl.value = localStorage.getItem(STORAGE_NOTIFY_MODE) || 'focused';
  let historyCollapsed = localStorage.getItem(STORAGE_HISTORY_COLLAPSED) === '1';

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

  function updateHistoryCollapseUi() {
    historyScrollEl.classList.toggle('collapsed', historyCollapsed);
    historyToggleEl.textContent = historyCollapsed ? 'Expand' : 'Collapse';
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

  // Cmd+Enter to submit
  textbox.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

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
        connectEvents();
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
      showStatus('Feedback draft cleared', 'success');
      connectEvents();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

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

      if (selectedSessionId && !sessions.some((s) => s.sessionId === selectedSessionId)) {
        selectedSessionId = (active && active !== '(none)') ? active : '';
      }

      if (!selectedSessionId) {
        selectedSessionId = payload.defaultUiSessionId || payload.activeUiSessionId || '';
      }
      activeSessionInputEl.value = selectedSessionId;
      const routeHint = selectedSessionId ? (' | Route: ' + selectedSessionId) : '';
      sessionMetaEl.textContent = 'Default (fallback): ' + active + routeHint + ' | Total sessions: ' + sessions.length;

      const targetSessionId = selectedSessionId || active;
      const waitingSessions = sessions.filter((s) => Boolean(s.waitingForFeedback));

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

      const targetSession = sessions.find((s) => s.sessionId === targetSessionId);
      const targetWaiting = Boolean(targetSession && targetSession.waitingForFeedback);
      const anyWaiting = waitingSessions.length > 0;
      const firstWaitingSessionId = waitingSessions[0]?.sessionId || '(none)';

      if (targetWaiting) {
        waitBannerEl.className = 'wait-banner waiting';
        waitBannerEl.textContent = 'Agent is waiting for feedback on session: ' + targetSessionId;
        textbox.classList.add('waiting');
        document.title = 'TaskSync - Agent Waiting';

        const signature = targetSessionId + ':waiting';
        if (lastWaitSignature !== signature) {
          notifyWaitingTransition(targetSessionId);
          lastWaitSignature = signature;
        }
      } else if (anyWaiting) {
        waitBannerEl.className = 'wait-banner waiting';
        waitBannerEl.textContent = 'A different session is waiting for feedback: ' + firstWaitingSessionId + '. Use Route Here to focus it.';
        textbox.classList.remove('waiting');
        document.title = 'TaskSync - Session Waiting';
      } else {
        waitBannerEl.className = 'wait-banner idle';
        waitBannerEl.textContent = 'No session is currently blocked on get_feedback.';
        textbox.classList.remove('waiting');
        document.title = 'TaskSync Feedback';
        lastWaitSignature = 'idle';
      }

      if (sessions.length === 0) {
        sessionListEl.innerHTML = '<li class="session-item">No active streamable sessions</li>';
        return;
      }

      sessionListEl.innerHTML = sessions.map((s) => {
        const isActive = s.sessionId === active;
        const isRoute = s.sessionId === selectedSessionId;
        const alias = (typeof s.alias === 'string') ? s.alias.trim() : '';
        const displayName = alias || s.sessionId;
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
        const sessionUrl = s.sessionUrl || ('/session/' + encodeURIComponent(s.sessionId));
        return '<li class="session-item ' + (isActive ? 'active ' : '') + (hasAlert ? 'alert' : '') + '">' 
          + '<div class="session-name">' + escapeHtml(displayName) + '</div>'
          + (alias ? ('<div class="session-id">' + escapeHtml(s.sessionId) + '</div>') : '')
          + '<div class="session-flags">' + waitingFlag + queueFlag + routeFlag + (hasAlert ? ' <span class="session-alert-badge">new wait</span>' : '') + '</div>'
          + '<a class="session-link" href="' + sessionUrl + '" target="_blank" rel="noopener">Open this session in new window</a>'
          + '<div class="session-buttons">'
          + '<button type="button" class="btn-secondary btn-small" data-action="rename" data-session-id="' + escapeHtml(s.sessionId) + '" data-session-alias="' + escapeHtml(alias) + '">Rename</button>'
          + '<button type="button" class="btn-secondary btn-small" data-action="route" data-session-id="' + escapeHtml(s.sessionId) + '">Route Here</button>'
          + '<button type="button" class="btn-secondary btn-small" data-action="set-default" data-session-id="' + escapeHtml(s.sessionId) + '">Set Default</button>'
          + '<button type="button" class="btn-danger btn-small" data-action="disconnect" data-session-id="' + escapeHtml(s.sessionId) + '">Disconnect</button>'
          + '</div>'
          + '</li>';
      }).join('');
    } catch {
      sessionMetaEl.textContent = 'Error loading sessions';
      sessionListEl.innerHTML = '';
    }
  }

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

  async function renameSession(sessionId, currentAlias) {
    const nextAliasRaw = window.prompt('Set session alias (empty clears alias):', currentAlias || '');
    if (nextAliasRaw === null) return;

    try {
      const res = await fetch('/sessions/' + encodeURIComponent(sessionId) + '/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: nextAliasRaw })
      });

      if (!res.ok) {
        showStatus('Failed to rename session', 'error');
        return;
      }

      const payload = await res.json();
      const alias = (payload && typeof payload.alias === 'string') ? payload.alias : '';
      if (alias) {
        showStatus('Session alias updated', 'success');
      } else {
        showStatus('Session alias cleared', 'success');
      }
      connectEvents();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
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
      renameSession(sessionId, currentAlias);
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
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

  function renderHistory(history) {
    const entries = Array.isArray(history) ? history : [];
    const shouldAutoScroll = !historyCollapsed && (lastRenderedHistorySignature === '' || isHistoryNearBottom());
    lastRenderedHistorySignature = JSON.stringify(entries.map((entry) => [entry?.createdAt || '', entry?.content || '']));
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
        + '<div class="history-meta">You • ' + escapeHtml(label) + '</div>'
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

  function applyUiState(payload) {
    if (!payload || typeof payload !== 'object') return;
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    const active = payload.activeUiSessionId || '(none)';

    if (selectedSessionId && !sessions.some((s) => s.sessionId === selectedSessionId)) {
      selectedSessionId = (active && active !== '(none)') ? active : '';
    }
    if (!selectedSessionId) {
      selectedSessionId = payload.sessionId || active || '';
    }

    activeSessionInputEl.value = selectedSessionId;
    const history = Array.isArray(payload.history) ? payload.history : [];
    renderHistory(history);

    const routeHint = selectedSessionId ? (' | Route: ' + selectedSessionId) : '';
    sessionMetaEl.textContent = 'Default (fallback): ' + active + routeHint + ' | Total sessions: ' + sessions.length;

    const targetSessionId = selectedSessionId || active;
    const waitingSessions = sessions.filter((s) => Boolean(s.waitingForFeedback));
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

    const targetSession = sessions.find((s) => s.sessionId === targetSessionId);
    const targetWaiting = Boolean(targetSession && targetSession.waitingForFeedback);
    const anyWaiting = waitingSessions.length > 0;
    const firstWaitingSessionId = waitingSessions[0]?.sessionId || '(none)';
    if (targetWaiting) {
      waitBannerEl.className = 'wait-banner waiting';
      waitBannerEl.textContent = 'Agent is waiting for feedback on session: ' + targetSessionId;
      textbox.classList.add('waiting');
      document.title = 'TaskSync - Agent Waiting';
      const signature = targetSessionId + ':waiting';
      if (lastWaitSignature !== signature) {
        notifyWaitingTransition(targetSessionId);
        lastWaitSignature = signature;
      }
    } else if (anyWaiting) {
      waitBannerEl.className = 'wait-banner waiting';
      waitBannerEl.textContent = 'A different session is waiting for feedback: ' + firstWaitingSessionId + '. Use Route Here to focus it.';
      textbox.classList.remove('waiting');
      document.title = 'TaskSync - Session Waiting';
    } else {
      waitBannerEl.className = 'wait-banner idle';
      waitBannerEl.textContent = 'No session is currently blocked on get_feedback.';
      textbox.classList.remove('waiting');
      document.title = 'TaskSync Feedback';
      lastWaitSignature = 'idle';
    }

    if (sessions.length === 0) {
      sessionListEl.innerHTML = '<li class="session-item">No active streamable sessions</li>';
      return;
    }

    sessionListEl.innerHTML = sessions.map((s) => {
      const isActive = s.sessionId === active;
      const isRoute = s.sessionId === selectedSessionId;
      const alias = (typeof s.alias === 'string') ? s.alias.trim() : '';
      const displayName = alias || s.sessionId;
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
      const sessionUrl = s.sessionUrl || ('/session/' + encodeURIComponent(s.sessionId));
      return '<li class="session-item ' + (isActive ? 'active ' : '') + (hasAlert ? 'alert' : '') + '>'
        + '<div class="session-name">' + escapeHtml(displayName) + '</div>'
        + (alias ? ('<div class="session-id">' + escapeHtml(s.sessionId) + '</div>') : '')
        + '<div class="session-flags">' + waitingFlag + queueFlag + routeFlag + (hasAlert ? ' <span class="session-alert-badge">new wait</span>' : '') + '</div>'
        + '<a class="session-link" href="' + sessionUrl + '" target="_blank" rel="noopener">Open this session in new window</a>'
        + '<div class="session-buttons">'
        + '<button type="button" class="btn-secondary btn-small" data-action="rename" data-session-id="' + escapeHtml(s.sessionId) + '" data-session-alias="' + escapeHtml(alias) + '">Rename</button>'
        + '<button type="button" class="btn-secondary btn-small" data-action="route" data-session-id="' + escapeHtml(s.sessionId) + '">Route Here</button>'
        + '<button type="button" class="btn-secondary btn-small" data-action="set-default" data-session-id="' + escapeHtml(s.sessionId) + '">Set Default</button>'
        + '<button type="button" class="btn-danger btn-small" data-action="disconnect" data-session-id="' + escapeHtml(s.sessionId) + '">Disconnect</button>'
        + '</div>'
        + '</li>';
    }).join('');
  }

  function connectEvents() {
    if (uiEventSource) {
      uiEventSource.close();
    }
    const suffix = selectedSessionId ? ('?sessionId=' + encodeURIComponent(selectedSessionId)) : '';
    uiEventSource = new EventSource('/events' + suffix);
    uiEventSource.addEventListener('state', (event) => {
      try {
        applyUiState(JSON.parse(event.data));
      } catch {}
    });
    uiEventSource.onerror = () => {
      showStatus('Live updates reconnecting...', 'error');
    };
  }

  loadSessions();
  connectEvents();
</script>
</body>
</html>`;
