/**
 * Shared HTML template for the TaskSync feedback web UI.
 * Used by both the standalone feedback-server and the embedded MCP server.
 *
 * The placeholder FEEDBACK_PATH is replaced at serve time with the actual file path.
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
  <div class="filepath">Writing to: FEEDBACK_PATH</div>
  <form id="form">
    <textarea id="feedback" placeholder="Type your feedback here..." autofocus></textarea>
    <div class="actions">
      <button type="submit" class="btn-primary">Send Feedback</button>
      <button type="button" class="btn-secondary" onclick="clearFeedback()">Clear File</button>
    </div>
  </form>
  <div id="status" class="status"></div>
  <div class="current">
    <h2>Current feedback.md contents:</h2>
    <pre id="current-content">Loading...</pre>
  </div>
</div>
<script>
  const form = document.getElementById('form');
  const textbox = document.getElementById('feedback');
  const statusEl = document.getElementById('status');
  const currentEl = document.getElementById('current-content');

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
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });
      if (res.ok) {
        showStatus('Feedback sent!', 'success');
        textbox.value = '';
        loadCurrent();
      } else {
        showStatus('Failed to send: ' + (await res.text()), 'error');
      }
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  });

  async function clearFeedback() {
    try {
      await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' })
      });
      showStatus('Feedback file cleared', 'success');
      loadCurrent();
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    }
  }

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + type;
    setTimeout(() => { statusEl.className = 'status'; }, 3000);
  }

  async function loadCurrent() {
    try {
      const res = await fetch('/feedback');
      currentEl.textContent = (await res.text()) || '(empty)';
    } catch { currentEl.textContent = '(error loading)'; }
  }

  loadCurrent();
  setInterval(loadCurrent, 3000);
</script>
</body>
</html>`;
