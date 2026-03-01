// Prompt Forge — options.js
// Handles saving / loading the Groq API key in chrome.storage.sync

'use strict';

const input     = document.getElementById('apiKeyInput');
const saveBtn   = document.getElementById('saveBtn');
const toggleBtn = document.getElementById('toggleVis');
const status    = document.getElementById('status');

/* ── Load saved key on open ───────────────────────────── */

chrome.storage.sync.get('groqApiKey', ({ groqApiKey }) => {
  if (groqApiKey) {
    input.value = groqApiKey;
    setStatus('Key loaded.', 'ok');
  }
});

/* ── Show / hide key ──────────────────────────────────── */

toggleBtn.addEventListener('click', () => {
  const isPassword = input.type === 'password';
  input.type       = isPassword ? 'text' : 'password';
  toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
});

/* ── Save ─────────────────────────────────────────────── */

saveBtn.addEventListener('click', save);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});

function save() {
  const key = input.value.trim();

  if (!key) {
    // Clear the stored key
    chrome.storage.sync.remove('groqApiKey', () => {
      setStatus('API key cleared.', 'ok');
    });
    return;
  }

  if (!key.startsWith('gsk_')) {
    setStatus('Key should start with "gsk_" — double-check and try again.', 'error');
    return;
  }

  chrome.storage.sync.set({ groqApiKey: key }, () => {
    if (chrome.runtime.lastError) {
      setStatus('Error saving: ' + chrome.runtime.lastError.message, 'error');
    } else {
      setStatus('✓ Key saved successfully.', 'ok');
    }
  });
}

/* ── Status helper ────────────────────────────────────── */

let clearTimer = null;

function setStatus(msg, type) {
  status.textContent = msg;
  status.className   = type; // 'ok' | 'error' | ''
  clearTimeout(clearTimer);
  if (type === 'ok') {
    clearTimer = setTimeout(() => {
      status.textContent = '';
      status.className   = '';
    }, 4000);
  }
}
