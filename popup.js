// Prompt Forge — popup.js
// Handles all UI interactions and communicates with the background service worker.
// When a Groq API key is set, runs the full AI optimization pipeline.
// Without a key, falls back to searching proven prompt patterns.

'use strict';

/* ── DOM refs ─────────────────────────────────────────── */

const promptInput        = document.getElementById('promptInput');
const categoryChips      = document.getElementById('categoryChips');
const optimizeBtn        = document.getElementById('optimizeBtn');
const btnText            = document.getElementById('btnText');
const btnSpinner         = document.getElementById('btnSpinner');
const resultsSection     = document.getElementById('resultsSection');
const resultTitle        = document.getElementById('resultTitle');
const resultContent      = document.getElementById('resultContent');
const resultCategory     = document.getElementById('resultCategory');
const copyBtn            = document.getElementById('copyBtn');
const errorSection       = document.getElementById('errorSection');
const errorMessage       = document.getElementById('errorMessage');
const inspirationList    = document.getElementById('inspirationList');
const inspirationsSection = document.getElementById('inspirationsSection');
const statusBar          = document.getElementById('statusBar');

/* ── Settings button ──────────────────────────────────── */

document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/* ── State ────────────────────────────────────────────── */

let selectedCategory = '';
let currentResult    = null;
let hasApiKey        = false;

// Check for API key on load to decide which flow to use
chrome.storage.sync.get('groqApiKey', ({ groqApiKey }) => {
  hasApiKey = !!(groqApiKey && groqApiKey.startsWith('gsk_'));
  btnText.textContent = hasApiKey ? 'Optimize Prompt' : 'Search Prompts';
  promptInput.placeholder = hasApiKey
    ? 'Describe what you need — AI will optimize it\n\ne.g. "help me review code for security issues"'
    : 'Search proven prompt patterns\n\ne.g. "code review" or "data analysis"';
});

/* ── Category chip logic ──────────────────────────────── */

categoryChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;

  document.querySelectorAll('.chip').forEach(c => {
    c.classList.remove('active');
    c.setAttribute('aria-pressed', 'false');
  });

  chip.classList.add('active');
  chip.setAttribute('aria-pressed', 'true');
  selectedCategory = chip.dataset.category;
});

/* ── Optimize on button click or Ctrl/Cmd+Enter ──────── */

optimizeBtn.addEventListener('click', triggerOptimize);

promptInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    triggerOptimize();
  }
});

async function triggerOptimize() {
  const prompt = promptInput.value.trim();

  if (!prompt) {
    showError('Please enter a prompt to optimize.');
    return;
  }
  if (prompt.length < 4) {
    showError('Prompt is too short — add a bit more detail.');
    return;
  }

  if (hasApiKey) {
    await runAIOptimize(prompt, selectedCategory);
  } else {
    await runSearchOnly(prompt, selectedCategory);
  }
}

/* ── AI optimization flow (with Groq API key) ─────────── */

async function runAIOptimize(prompt, category) {
  setLoading(true, 'Optimizing…');
  hideError();
  hideResults();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OPTIMIZE_WITH_CONTEXT',
      payload: {
        prompt,
        chatHistory: [],
        lastAssistantMessage: null,
        mode: 'auto',
        answers: category ? [`Category: ${category}`] : [],
      },
    });

    if (!response.success) {
      // If API key error, fall back to search
      if (response.error === 'NO_API_KEY') {
        hasApiKey = false;
        btnText.textContent = 'Search Prompts';
        await runSearchOnly(prompt, category);
        return;
      }
      throw new Error(response.error || 'Optimization failed — try again.');
    }

    renderAIResult(response.data);
  } catch (err) {
    const msg = (err?.message || String(err)).replace(/^Error:\s*/i, '');
    showError(msg || 'Unexpected error. Please try again.');
  } finally {
    setLoading(false);
  }
}

function renderAIResult(data) {
  const { optimized, inspiredBy = [], rationale = '' } = data;

  currentResult = { content: optimized, title: 'AI-Optimized Prompt' };

  resultTitle.textContent   = 'AI-Optimized Prompt';
  resultContent.textContent = optimized;

  // Show rationale if available
  if (rationale) {
    resultCategory.textContent = rationale;
    resultCategory.classList.remove('hidden');
  } else {
    resultCategory.classList.add('hidden');
  }

  // Source info
  const sourceLink = document.getElementById('sourceLink');
  if (sourceLink) {
    const sources = inspiredBy.length > 0
      ? `patterns from: ${inspiredBy.slice(0, 3).join(', ')}`
      : 'AI-optimized';
    sourceLink.textContent = sources;
  }

  statusBar.textContent = '';

  // No inspirations in AI mode — the result IS the optimization
  inspirationsSection.classList.add('hidden');

  resetCopyBtn(copyBtn, 'Copy');
  resultsSection.classList.remove('hidden');
}

/* ── Search-only flow (no API key) ────────────────────── */

async function runSearchOnly(prompt, category) {
  setLoading(true, 'Searching…');
  hideError();
  hideResults();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'OPTIMIZE_PROMPT',
      payload: { prompt, category },
    });

    if (!response.success) {
      throw new Error(response.error || 'Search failed — please try again.');
    }

    renderSearchResults(response.data);
  } catch (err) {
    const msg = (err?.message || String(err)).replace(/^Error:\s*/i, '');
    showError(msg || 'Unexpected error. Please try again.');
  } finally {
    setLoading(false);
  }
}

function renderSearchResults(data) {
  const { optimized, inspirations = [], total = 0, fromMCP } = data;

  currentResult = optimized;

  resultTitle.textContent   = optimized.title || 'Best Match';
  resultContent.textContent = optimized.content;

  if (optimized.category) {
    resultCategory.textContent = optimized.category;
    resultCategory.classList.remove('hidden');
  } else {
    resultCategory.classList.add('hidden');
  }

  // Source info
  const sources = [];
  if (data.fromREST)    sources.push('prompts.chat');
  if (fromMCP)          sources.push('MCP');
  if (data.fromGitHub)  sources.push('GitHub');
  if (data.fromBuiltIn) sources.push('built-in');
  statusBar.textContent = total > 1
    ? `${total} prompts found via ${sources.join(' + ') || 'search'}`
    : '';
  const sourceLink = document.getElementById('sourceLink');
  if (sourceLink) sourceLink.textContent = sources.length > 0
    ? `via ${sources.join(' + ')}` : '';

  // Inspiration list
  inspirationList.innerHTML = '';
  if (inspirations.length > 0) {
    inspirations.forEach(item => {
      inspirationList.appendChild(buildInspirationItem(item));
    });
    inspirationsSection.classList.remove('hidden');
  } else {
    inspirationsSection.classList.add('hidden');
  }

  resetCopyBtn(copyBtn, 'Copy');
  resultsSection.classList.remove('hidden');
}

function buildInspirationItem(item) {
  const wrap = document.createElement('div');
  wrap.className = 'inspiration-item';
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.title = item.content;

  const body = document.createElement('div');
  body.className = 'insp-body';

  const title = document.createElement('div');
  title.className = 'insp-title';
  title.textContent = item.title || 'Related Prompt';

  const preview = document.createElement('div');
  preview.className = 'insp-preview';
  const text = item.content || '';
  preview.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;

  body.appendChild(title);
  body.appendChild(preview);

  const copyTag = document.createElement('button');
  copyTag.className = 'insp-copy';
  copyTag.textContent = 'Copy';
  copyTag.setAttribute('aria-label', `Copy: ${item.title || 'prompt'}`);

  wrap.appendChild(body);
  wrap.appendChild(copyTag);

  const handleCopy = (e) => {
    e.stopPropagation();
    copyText(item.content, copyTag, 'Copied!');
  };

  wrap.addEventListener('click', handleCopy);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') handleCopy(e);
  });

  return wrap;
}

/* ── Copy button (main result) ────────────────────────── */

copyBtn.addEventListener('click', () => {
  if (!currentResult) return;
  copyText(currentResult.content, copyBtn, 'Copied!');
});

/* ── Clipboard helper ─────────────────────────────────── */

function copyText(text, btn, successLabel) {
  const restore = () => resetCopyBtn(btn, 'Copy');

  navigator.clipboard.writeText(text)
    .then(() => flashBtn(btn, successLabel, restore))
    .catch(() => {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        flashBtn(btn, successLabel, restore);
      } catch {
        flashBtn(btn, 'Failed', restore);
      }
    });
}

function flashBtn(btn, label, restoreFn) {
  btn.textContent = label;
  btn.classList.add('copied');
  setTimeout(restoreFn, 2000);
}

function resetCopyBtn(btn, label) {
  btn.textContent = label;
  btn.classList.remove('copied');
}

/* ── Loading state ────────────────────────────────────── */

function setLoading(on, label) {
  optimizeBtn.disabled = on;
  promptInput.disabled = on;

  if (on) {
    btnText.textContent = label || 'Working…';
    btnSpinner.classList.remove('hidden');
  } else {
    btnText.textContent = hasApiKey ? 'Optimize Prompt' : 'Search Prompts';
    btnSpinner.classList.add('hidden');
  }
}

/* ── Show / hide helpers ──────────────────────────────── */

function showError(msg) {
  errorMessage.textContent = msg;
  errorSection.classList.remove('hidden');
}

function hideError() {
  errorSection.classList.add('hidden');
}

function hideResults() {
  resultsSection.classList.add('hidden');
}
