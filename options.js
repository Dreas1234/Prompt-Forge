// Prompt Forge — options.js

'use strict';

// Groq elements
const groqInput     = document.getElementById('apiKeyInput');
const groqSaveBtn   = document.getElementById('saveBtn');
const groqToggle    = document.getElementById('toggleVis');
const groqStatus    = document.getElementById('status');
const groqCard      = document.getElementById('groqCard');

// Anthropic elements
const anthInput     = document.getElementById('anthropicKeyInput');
const anthSaveBtn   = document.getElementById('saveAnthropicBtn');
const anthToggle    = document.getElementById('toggleAnthropicVis');
const anthStatus    = document.getElementById('anthropicStatus');
const claudeCard    = document.getElementById('claudeCard');

// Engine selector
const engineOpts    = document.getElementById('engineOptions');

/* ── Load saved settings ─────────────────────────────── */

chrome.storage.sync.get(['groqApiKey', 'anthropicApiKey'], (data) => {
  if (data.groqApiKey) {
    groqInput.value = data.groqApiKey;
  }
  if (data.anthropicApiKey) {
    anthInput.value = data.anthropicApiKey;
    setStatus(anthStatus, 'Key loaded.', 'ok');
  }
});

chrome.storage.local.get('pfEngine', ({ pfEngine }) => {
  setActiveEngine(pfEngine || 'claude');
});

/* ── Engine selector ──────────────────────────────────── */

engineOpts.addEventListener('click', (e) => {
  const btn = e.target.closest('.engine-option');
  if (!btn) return;
  const engine = btn.dataset.engine;
  chrome.storage.local.set({ pfEngine: engine });
  setActiveEngine(engine);
});

function setActiveEngine(engine) {
  engineOpts.querySelectorAll('.engine-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.engine === engine);
  });
  if (claudeCard) claudeCard.style.display = engine === 'claude' ? '' : 'none';
  if (groqCard)   groqCard.style.display   = engine === 'groq'   ? '' : 'none';
}

/* ── Anthropic key ────────────────────────────────────── */

anthToggle.addEventListener('click', () => {
  const isPw = anthInput.type === 'password';
  anthInput.type = isPw ? 'text' : 'password';
  anthToggle.textContent = isPw ? 'Hide' : 'Show';
});

anthSaveBtn.addEventListener('click', saveAnthropicKey);
anthInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAnthropicKey(); });

function saveAnthropicKey() {
  const key = anthInput.value.trim();
  if (!key) {
    chrome.storage.sync.remove('anthropicApiKey', () => setStatus(anthStatus, 'Key cleared.', 'ok'));
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    setStatus(anthStatus, 'Key should start with "sk-ant-" — check and try again.', 'error');
    return;
  }
  chrome.storage.sync.set({ anthropicApiKey: key }, () => {
    if (chrome.runtime.lastError) {
      setStatus(anthStatus, 'Error: ' + chrome.runtime.lastError.message, 'error');
    } else {
      setStatus(anthStatus, 'Key saved.', 'ok');
    }
  });
}

/* ── Groq key ─────────────────────────────────────────── */

groqToggle.addEventListener('click', () => {
  const isPw = groqInput.type === 'password';
  groqInput.type = isPw ? 'text' : 'password';
  groqToggle.textContent = isPw ? 'Hide' : 'Show';
});

groqSaveBtn.addEventListener('click', saveGroqKey);
groqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGroqKey(); });

function saveGroqKey() {
  const key = groqInput.value.trim();
  if (!key) {
    chrome.storage.sync.remove('groqApiKey', () => setStatus(groqStatus, 'Key cleared.', 'ok'));
    return;
  }
  if (!key.startsWith('gsk_')) {
    setStatus(groqStatus, 'Key should start with "gsk_" — check and try again.', 'error');
    return;
  }
  chrome.storage.sync.set({ groqApiKey: key }, () => {
    if (chrome.runtime.lastError) {
      setStatus(groqStatus, 'Error: ' + chrome.runtime.lastError.message, 'error');
    } else {
      setStatus(groqStatus, 'Key saved.', 'ok');
    }
  });
}

/* ── Status helper ────────────────────────────────────── */

const clearTimers = {};

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = type;
  clearTimeout(clearTimers[el.id]);
  if (type === 'ok') {
    clearTimers[el.id] = setTimeout(() => {
      el.textContent = '';
      el.className = '';
    }, 4000);
  }
}
