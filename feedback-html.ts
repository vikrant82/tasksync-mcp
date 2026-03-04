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
  .container { width: 100%; max-width: 640px; }
  .panel { margin-top: 1rem; background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; }
  .panel h2 { font-size: 0.95rem; color: var(--muted); margin-bottom: 0.5rem; }
  .session-meta { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.5rem; }
  .session-actions { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .session-actions input { flex: 1; padding: 0.45rem 0.55rem; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font-family: monospace; font-size: 0.8rem; }
  .session-list { list-style: none; display: flex; flex-direction: column; gap: 0.45rem; max-height: 220px; overflow-y: auto; }
  .session-item { border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; background: rgba(255,255,255,0.02); }
  .session-item.active { border-color: var(--accent); }
  .session-id { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
  .session-flags { font-size: 0.75rem; color: var(--muted); margin: 0.25rem 0; }
  .session-buttons { display: flex; gap: 0.4rem; }
  .btn-danger { background: #f85149; color: #fff; }
  .btn-small { padding: 0.35rem 0.65rem; font-size: 0.8rem; }
  .session-link { color: var(--accent); font-size: 0.75rem; text-decoration: none; }
  .session-link:hover { text-decoration: underline; }
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
  .current { margin-top: 1.5rem; }
  .current h2 { font-size: 0.95rem; color: var(--muted); margin-bottom: 0.5rem; }
  .current pre { background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; font-size: 0.8rem; white-space: pre-wrap; word-wrap: break-word; max-height: 300px; overflow-y: auto; color: var(--muted); }
  .filepath { color: var(--muted); font-size: 0.75rem; margin-bottom: 1rem; font-family: monospace; }
  kbd { background: var(--border); padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="container">
  <h1>TaskSync Feedback</h1>
  <div class="subtitle">Type your feedback below. Press <kbd>Cmd+Enter</kbd> to submit.</div>
  <div class="filepath">Feedback transport: FEEDBACK_PATH</div>
  <form id="form">
    <textarea id="feedback" placeholder="Type your feedback here..." autofocus></textarea>
    <div class="actions">
      <button type="submit" class="btn-primary">Send Feedback</button>
      <button type="button" class="btn-secondary" onclick="clearFeedback()">Clear Draft</button>
    </div>
  </form>
  <div id="status" class="status"></div>
  <div class="panel">
    <h2>Sessions</h2>
    <div id="session-meta" class="session-meta">Loading sessions...</div>
    <div class="session-actions">
      <input id="active-session-input" placeholder="Session ID to activate" />
      <button type="button" class="btn-secondary btn-small" onclick="setActiveFromInput()">Set Active</button>
      <button type="button" class="btn-secondary btn-small" onclick="loadSessions()">Refresh</button>
    </div>
    <ul id="session-list" class="session-list"></ul>
  </div>
  <div class="current">
    <h2>Current session feedback draft:</h2>
    <pre id="current-content">Loading...</pre>
  </div>
</div>
<script>
  const form = document.getElementById('form');
  const textbox = document.getElementById('feedback');
  const statusEl = document.getElementById('status');
  const currentEl = document.getElementById('current-content');
  const sessionMetaEl = document.getElementById('session-meta');
  const sessionListEl = document.getElementById('session-list');
  const activeSessionInputEl = document.getElementById('active-session-input');
  const pathSessionMatch = window.location.pathname.match(/^\/session\/([^/]+)$/);
  const pathSessionParam = pathSessionMatch ? decodeURIComponent(pathSessionMatch[1]) : '';
  let selectedSessionId = String(pathSessionParam || '').trim();

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
        loadCurrent();
        loadSessions();
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
      loadCurrent();
      loadSessions();
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
      const active = payload.activeUiSessionId || '(none)';
      if (!selectedSessionId) {
        selectedSessionId = payload.activeUiSessionId || '';
      }
      activeSessionInputEl.value = selectedSessionId;
      const routeHint = selectedSessionId ? (' | Route: ' + selectedSessionId) : '';
      sessionMetaEl.textContent = 'Active: ' + active + routeHint + ' | Total sessions: ' + sessions.length;

      if (sessions.length === 0) {
        sessionListEl.innerHTML = '<li class="session-item">No active streamable sessions</li>';
        return;
      }

      sessionListEl.innerHTML = sessions.map((s) => {
        const isActive = s.sessionId === active;
        const isRoute = s.sessionId === selectedSessionId;
        const flags = [
          s.waitingForFeedback ? 'waiting' : 'idle',
          s.hasQueuedFeedback ? 'queued' : 'no-queue'
        ].join(' | ');
        const sessionUrl = s.sessionUrl || ('/session/' + encodeURIComponent(s.sessionId));
        return '<li class="session-item ' + (isActive ? 'active' : '') + '">'
          + '<div class="session-id">' + escapeHtml(s.sessionId) + '</div>'
          + '<div class="session-flags">' + flags + (isRoute ? ' | route-target' : '') + '</div>'
          + '<a class="session-link" href="' + sessionUrl + '" target="_blank" rel="noopener">Open this session in new window</a>'
          + '<div class="session-buttons">'
          + '<button type="button" class="btn-secondary btn-small" onclick="routeToSession(\'' + escapeJs(s.sessionId) + '\')">Route Here</button>'
          + '<button type="button" class="btn-secondary btn-small" onclick="setActiveSession(\'' + escapeJs(s.sessionId) + '\')">Set Active</button>'
          + '<button type="button" class="btn-danger btn-small" onclick="disconnectSession(\'' + escapeJs(s.sessionId) + '\')">Disconnect</button>'
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
      const res = await fetch('/sessions/active', {
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
      updateUrlSession(sessionId);
      showStatus('Active session updated', 'success');
      loadSessions();
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
      loadSessions();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  function routeToSession(sessionId) {
    selectedSessionId = sessionId;
    activeSessionInputEl.value = sessionId;
    updateUrlSession(sessionId);
    showStatus('Routing feedback to selected session', 'success');
    loadSessions();
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeJs(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    setTimeout(() => { statusEl.className = 'status'; }, 3000);
  }

  async function loadCurrent() {
    try {
      const suffix = selectedSessionId ? ('?sessionId=' + encodeURIComponent(selectedSessionId)) : '';
      const res = await fetch('/feedback' + suffix);
      currentEl.textContent = (await res.text()) || '(empty)';
    } catch { currentEl.textContent = '(error loading)'; }
  }

  loadCurrent();
  loadSessions();
  setInterval(loadCurrent, 3000);
  setInterval(loadSessions, 5000);
</script>
</body>
</html>`;
