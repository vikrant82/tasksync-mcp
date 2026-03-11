/**
 * High-churn feedback UI script extracted from feedback-html.ts.
 * Covers composer state, toasts, local draft persistence, and markdown rendering helpers.
 */

import { FEEDBACK_HTML_HISTORY_MARKDOWN_SCRIPT } from "./feedback-html-history-markdown-script.js";

export const FEEDBACK_HTML_COMPOSER_HISTORY_SCRIPT = `
  const previousWaitBySession = new Map();
  let audioContext = null;
  let audioUnlocked = false;
  let composerBusy = false;
  let toastCounter = 0;

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

  function autoResizeTextbox() {
    textbox.style.height = 'auto';
    const minHeight = 200;
    const computedMaxHeight = Number.parseFloat(window.getComputedStyle(textbox).maxHeight);
    const maxHeight = Number.isFinite(computedMaxHeight)
      ? computedMaxHeight
      : window.innerHeight * 0.55;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textbox.scrollHeight));
    textbox.style.height = nextHeight + 'px';
    textbox.style.overflowY = textbox.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }

  autoResizeTextbox();

  // ── Draft persistence on input ──
  textbox.addEventListener('input', () => {
    localStorage.setItem(STORAGE_DRAFT, textbox.value);
    autoResizeTextbox();
  });

  function setComposerBusy(isBusy, mode) {
    composerBusy = isBusy;
    textbox.disabled = isBusy;
    sendButtonEl.disabled = isBusy;
    clearButtonEl.disabled = isBusy;
    sendButtonEl.classList.toggle('btn-busy', isBusy && mode === 'send');
    clearButtonEl.classList.toggle('btn-busy', isBusy && mode === 'clear');
    sendButtonEl.textContent = isBusy && mode === 'send' ? 'Sending…' : 'Send Feedback';
    clearButtonEl.textContent = isBusy && mode === 'clear' ? 'Clearing…' : 'Clear Draft';
  }

  function readErrorMessage(err) {
    if (err && typeof err.message === 'string' && err.message) return err.message;
    return String(err || 'Unknown error');
  }

  // ── Theme initialization ──
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_THEME, theme);
    if (theme === 'light') {
      themeIconEl.textContent = '\u2600';
      themeLabelEl.textContent = 'Dark';
    } else {
      themeIconEl.textContent = '\u263e';
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
    return historyScrollEl.scrollTop < 32;
  }

  function scrollHistoryToBottom() {
    historyScrollEl.scrollTop = 0;
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
    if (composerBusy) return;
    const text = textbox.value.trim();
    if (!text) return;
    const explicitSessionId = selectedSessionId || activeSessionInputEl.value.trim();
    setComposerBusy(true, 'send');
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, sessionId: explicitSessionId || undefined })
      });
      if (res.ok) {
        showStatus('Feedback sent!', 'success');
        textbox.value = '';
        autoResizeTextbox();
        localStorage.removeItem(STORAGE_DRAFT);
        textbox.focus();
      } else {
        showStatus('Failed to send: ' + (await res.text()), 'error');
      }
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    } finally {
      setComposerBusy(false, 'send');
    }
  });

  async function clearFeedback() {
    if (composerBusy) return;
    const explicitSessionId = selectedSessionId || activeSessionInputEl.value.trim();
    setComposerBusy(true, 'clear');
    try {
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', sessionId: explicitSessionId || undefined })
      });
      if (!res.ok) {
        throw new Error('Failed to clear draft: ' + (await res.text()));
      }
      textbox.value = '';
      autoResizeTextbox();
      localStorage.removeItem(STORAGE_DRAFT);
      showStatus('Feedback draft cleared', 'success');
      textbox.focus();
    } catch (err) {
      showStatus('Error: ' + readErrorMessage(err), 'error');
    } finally {
      setComposerBusy(false, 'clear');
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
    const tone = type || 'info';
    Array.from(toastViewportEl.children).forEach((existingToast) => {
      const existingMessage = existingToast.querySelector('.toast-message');
      if (!existingMessage) return;
      if (existingToast.dataset.tone === tone && existingMessage.textContent === msg) {
        existingToast.remove();
      }
    });

    const toast = document.createElement('div');
    toast.className = 'toast ' + tone;
    toast.dataset.toastId = String(++toastCounter);
    toast.dataset.tone = tone;

    const message = document.createElement('div');
    message.className = 'toast-message';
    message.textContent = msg;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'toast-close';
    closeButton.setAttribute('aria-label', 'Dismiss notification');
    closeButton.textContent = '×';

    function dismissToast() {
      if (!toast.isConnected) return;
      toast.classList.add('fade-out');
      window.setTimeout(() => toast.remove(), 180);
    }

    closeButton.addEventListener('click', dismissToast);
    toast.appendChild(message);
    toast.appendChild(closeButton);
    toastViewportEl.appendChild(toast);
    while (toastViewportEl.children.length > 3) {
      toastViewportEl.firstElementChild.remove();
    }
    window.setTimeout(dismissToast, tone === 'error' ? 5200 : 3200);
  }
${FEEDBACK_HTML_HISTORY_MARKDOWN_SCRIPT}
`;
