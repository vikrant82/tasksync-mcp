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
  let pendingImages = [];

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
    if (imageInputEl) imageInputEl.disabled = isBusy;
    if (mdToolbarEl) mdToolbarEl.querySelectorAll('button').forEach(function(btn) { btn.disabled = isBusy; });
    sendButtonEl.classList.toggle('btn-busy', isBusy && mode === 'send');
    clearButtonEl.classList.toggle('btn-busy', isBusy && mode === 'clear');
    sendButtonEl.textContent = isBusy && mode === 'send' ? 'Sending…' : 'Send Feedback';
    clearButtonEl.textContent = isBusy && mode === 'clear' ? 'Clearing…' : 'Clear Draft';
  }

  function readErrorMessage(err) {
    if (err && typeof err.message === 'string' && err.message) return err.message;
    return String(err || 'Unknown error');
  }

  // ── Image attachment support ──
  const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image
  const MAX_IMAGES = 10;

  function readFileAsBase64(file) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function() {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1] || '';
        resolve({ data: base64, mimeType: file.type, previewUrl: dataUrl });
      };
      reader.onerror = function() { reject(new Error('Failed to read file')); };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFiles(files) {
    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!VALID_IMAGE_TYPES.has(file.type)) {
        showStatus('Unsupported image type: ' + file.type, 'error');
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        showStatus('Image too large (max 10MB): ' + file.name, 'error');
        continue;
      }
      validFiles.push(file);
    }

    const remaining = MAX_IMAGES - pendingImages.length;
    if (remaining <= 0) {
      showStatus('Maximum ' + MAX_IMAGES + ' images allowed', 'error');
      return;
    }
    const toProcess = validFiles.slice(0, remaining);
    if (toProcess.length < validFiles.length) {
      showStatus('Only ' + toProcess.length + ' of ' + validFiles.length + ' images added (limit ' + MAX_IMAGES + ')', 'info');
    }

    for (const file of toProcess) {
      try {
        const imageData = await readFileAsBase64(file);
        pendingImages.push(imageData);
      } catch (err) {
        showStatus('Error reading image: ' + readErrorMessage(err), 'error');
      }
    }

    renderImagePreviews();
  }

  function renderImagePreviews() {
    imagePreviewsEl.innerHTML = '';
    pendingImages.forEach(function(img, idx) {
      const wrapper = document.createElement('div');
      wrapper.className = 'image-preview';
      const imgEl = document.createElement('img');
      imgEl.src = img.previewUrl;
      imgEl.alt = 'Attached image ' + (idx + 1);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'image-preview-remove';
      removeBtn.setAttribute('aria-label', 'Remove image ' + (idx + 1));
      removeBtn.textContent = '\\u00d7';
      removeBtn.addEventListener('click', function() {
        pendingImages.splice(idx, 1);
        renderImagePreviews();
      });
      wrapper.appendChild(imgEl);
      wrapper.appendChild(removeBtn);
      imagePreviewsEl.appendChild(wrapper);
    });
  }

  function clearPendingImages() {
    pendingImages = [];
    renderImagePreviews();
    if (imageInputEl) imageInputEl.value = '';
  }

  // ── Markdown toolbar helpers ──
  function mdWrapSelection(before, after) {
    const start = textbox.selectionStart;
    const end = textbox.selectionEnd;
    const selected = textbox.value.substring(start, end);
    if (selected) {
      const replacement = before + selected + after;
      textbox.setRangeText(replacement, start, end, 'select');
      textbox.selectionStart = start;
      textbox.selectionEnd = start + replacement.length;
    } else {
      const placeholder = before + after;
      textbox.setRangeText(placeholder, start, end, 'end');
      textbox.selectionStart = start + before.length;
      textbox.selectionEnd = start + before.length;
    }
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdInsertAtCursor(text) {
    const start = textbox.selectionStart;
    textbox.setRangeText(text, start, textbox.selectionEnd, 'end');
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdToggleLinePrefix(prefix) {
    const start = textbox.selectionStart;
    const end = textbox.selectionEnd;
    const value = textbox.value;
    const lineStart = value.lastIndexOf('\\n', start - 1) + 1;
    const lineEnd = value.indexOf('\\n', end);
    const actualLineEnd = lineEnd === -1 ? value.length : lineEnd;
    const line = value.substring(lineStart, actualLineEnd);

    if (line.startsWith(prefix)) {
      textbox.setRangeText(line.substring(prefix.length), lineStart, actualLineEnd, 'end');
    } else {
      textbox.setRangeText(prefix + line, lineStart, actualLineEnd, 'end');
    }
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdInsertCodeBlock() {
    const start = textbox.selectionStart;
    const end = textbox.selectionEnd;
    const selected = textbox.value.substring(start, end);
    const needsNewlineBefore = start > 0 && textbox.value[start - 1] !== '\\n';
    const prefix = needsNewlineBefore ? '\\n' : '';
    const replacement = prefix + '\`\`\`\\n' + (selected || '') + '\\n\`\`\`\\n';
    textbox.setRangeText(replacement, start, end, 'end');
    if (!selected) {
      const cursorPos = start + prefix.length + 4;
      textbox.selectionStart = cursorPos;
      textbox.selectionEnd = cursorPos;
    }
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdInsertLink() {
    const start = textbox.selectionStart;
    const end = textbox.selectionEnd;
    const selected = textbox.value.substring(start, end);
    if (selected && (selected.startsWith('http://') || selected.startsWith('https://'))) {
      const replacement = '[link text](' + selected + ')';
      textbox.setRangeText(replacement, start, end, 'select');
      textbox.selectionStart = start + 1;
      textbox.selectionEnd = start + 10;
    } else {
      const text = selected || 'link text';
      const replacement = '[' + text + '](url)';
      textbox.setRangeText(replacement, start, end, 'select');
      if (!selected) {
        textbox.selectionStart = start + 1;
        textbox.selectionEnd = start + 10;
      } else {
        textbox.selectionStart = start + text.length + 3;
        textbox.selectionEnd = start + text.length + 6;
      }
    }
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdInsertHr() {
    const start = textbox.selectionStart;
    const value = textbox.value;
    const needsNewline = start > 0 && value[start - 1] !== '\\n';
    const hr = (needsNewline ? '\\n' : '') + '---\\n';
    textbox.setRangeText(hr, start, textbox.selectionEnd, 'end');
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdDedentLine() {
    const pos = textbox.selectionStart;
    const value = textbox.value;
    const lineStart = value.lastIndexOf('\\n', pos - 1) + 1;
    if (value.substring(lineStart, lineStart + 2) === '  ') {
      textbox.setRangeText('', lineStart, lineStart + 2, 'start');
    } else if (value[lineStart] === ' ') {
      textbox.setRangeText('', lineStart, lineStart + 1, 'start');
    }
    textbox.focus();
    textbox.dispatchEvent(new Event('input'));
  }

  function mdContinueList() {
    const pos = textbox.selectionStart;
    if (pos !== textbox.selectionEnd) return false;
    const value = textbox.value;
    const lineStart = value.lastIndexOf('\\n', pos - 1) + 1;
    const currentLine = value.substring(lineStart, pos);

    const bulletMatch = currentLine.match(/^(\\s*)([-*+])\\s(.*)/);
    if (bulletMatch) {
      if (!bulletMatch[3]) {
        textbox.setRangeText('', lineStart, pos, 'end');
        return true;
      }
      textbox.setRangeText('\\n' + bulletMatch[1] + bulletMatch[2] + ' ', pos, pos, 'end');
      return true;
    }

    const numMatch = currentLine.match(/^(\\s*)(\\d+)\\.\\s(.*)/);
    if (numMatch) {
      if (!numMatch[3]) {
        textbox.setRangeText('', lineStart, pos, 'end');
        return true;
      }
      const nextNum = parseInt(numMatch[2], 10) + 1;
      textbox.setRangeText('\\n' + numMatch[1] + nextNum + '. ', pos, pos, 'end');
      return true;
    }

    return false;
  }

  function mdToolbarAction(action) {
    switch (action) {
      case 'bold': mdWrapSelection('**', '**'); break;
      case 'italic': mdWrapSelection('_', '_'); break;
      case 'code': mdWrapSelection('\`', '\`'); break;
      case 'codeblock': mdInsertCodeBlock(); break;
      case 'ul': mdToggleLinePrefix('- '); break;
      case 'ol': mdToggleLinePrefix('1. '); break;
      case 'heading': mdToggleLinePrefix('## '); break;
      case 'link': mdInsertLink(); break;
      case 'hr': mdInsertHr(); break;
      case 'quote': mdToggleLinePrefix('> '); break;
    }
  }

  // ── Paste handler for images ──
  textbox.addEventListener('paste', function(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageFiles = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && VALID_IMAGE_TYPES.has(items[i].type)) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      handleImageFiles(imageFiles);
    }
  });

  // ── Drag & drop handlers ──
  function isImageDrag(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return e.dataTransfer.types.indexOf('Files') !== -1;
  }

  textbox.addEventListener('dragover', function(e) {
    if (!isImageDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    textbox.classList.add('composer-drop-active');
  });

  textbox.addEventListener('dragleave', function(e) {
    textbox.classList.remove('composer-drop-active');
  });

  textbox.addEventListener('drop', function(e) {
    textbox.classList.remove('composer-drop-active');
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    handleImageFiles(e.dataTransfer.files);
  });

  // ── File input handler ──
  if (imageInputEl) {
    imageInputEl.addEventListener('change', function() {
      if (imageInputEl.files && imageInputEl.files.length > 0) {
        handleImageFiles(imageInputEl.files);
        imageInputEl.value = '';
      }
    });
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
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      mdToolbarAction('bold');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      mdToolbarAction('italic');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      mdToolbarAction('link');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '\`') {
      e.preventDefault();
      mdToolbarAction('code');
      return;
    }
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) {
        mdDedentLine();
      } else {
        mdInsertAtCursor('  ');
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (mdContinueList()) {
        e.preventDefault();
        return;
      }
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
    const hasImages = pendingImages.length > 0;
    if (!text && !hasImages) return;
    const explicitSessionId = selectedSessionId || activeSessionInputEl.value.trim();
    setComposerBusy(true, 'send');
    try {
      const payload = { content: text, sessionId: explicitSessionId || undefined };
      if (hasImages) {
        payload.images = pendingImages.map(function(img) {
          return { data: img.data, mimeType: img.mimeType };
        });
      }
      const res = await fetch('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showStatus('Feedback sent!', 'success');
        textbox.value = '';
        clearPendingImages();
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
      clearPendingImages();
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
