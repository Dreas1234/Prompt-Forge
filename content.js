// Prompt Forge — content.js
// Injected into claude.ai. Adds an ⚡ Optimize button next to the send button.
// Reads the typed prompt + visible chat history and sends them to background.js.

(function promptForge() {
  'use strict';

  // Prevent double-injection on hot reloads
  if (window.__pfInjected) return;
  window.__pfInjected = true;

  /* ── Platform detection ────────────────────────────────────────────────── */
  // Drives selector strategy for findEditor, setEditorText, scrapeConversation.
  const PLATFORM = location.hostname.includes('gemini.google.com') ? 'gemini' : 'claude';

  /* ── Styles injected into the host page ───────────────────────────────── */

  const CSS = `
    #pf-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 12px;
      height: 32px;
      background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.1s ease, filter 0.15s ease;
      box-shadow: 0 2px 8px rgba(124,58,237,0.4);
      vertical-align: middle;
      line-height: 1;
      margin-right: 6px;
    }
    #pf-btn.pf-visible {
      opacity: 1;
      pointer-events: auto;
    }
    #pf-btn:hover {
      filter: brightness(1.12);
      transform: translateY(-1px);
    }
    #pf-btn:active {
      transform: translateY(0);
    }
    #pf-btn.pf-loading {
      opacity: 0.65;
      pointer-events: none;
      cursor: wait;
    }
    #pf-btn.pf-loading .pf-bolt { display: none; }
    #pf-btn.pf-loading .pf-spinner { display: block; }
    .pf-spinner {
      display: none;
      width: 11px;
      height: 11px;
      border: 1.8px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: pf-spin 0.6s linear infinite;
      flex-shrink: 0;
    }
    @keyframes pf-spin { to { transform: rotate(360deg); } }

    /* Toast */
    #pf-toast {
      position: fixed;
      bottom: 90px;
      left: 50%;
      transform: translateX(-50%) translateY(6px);
      max-width: 380px;
      padding: 10px 16px;
      background: #1a1a2e;
      color: #e2e8f0;
      border: 1px solid #7c3aed;
      border-radius: 10px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.45;
      text-align: center;
      box-shadow: 0 6px 24px rgba(0,0,0,0.5);
      z-index: 2147483647;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #pf-toast.pf-show {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }
    #pf-toast.pf-error {
      border-color: #ef4444;
      color: #fca5a5;
    }
    #pf-toast.pf-success {
      border-color: #10b981;
      color: #6ee7b7;
    }
    #pf-toast a, #pf-toast button.pf-link {
      color: #a78bfa;
      text-decoration: underline;
      cursor: pointer;
      background: none;
      border: none;
      font: inherit;
      padding: 0;
    }

    /* ── Button hover tooltip ─────────────────────────── */
    #pf-optimize-btn[data-pf-tip]::after {
      content: attr(data-pf-tip);
      position: absolute;
      bottom: calc(100% + 10px);
      right: 0;
      width: 200px;
      padding: 8px 10px;
      background: #1a1a2e;
      color: #e2e8f0;
      border: 1px solid rgba(124,58,237,0.5);
      border-radius: 8px;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-weight: 400;
      line-height: 1.45;
      white-space: normal;
      text-align: left;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 10000;
    }
    #pf-optimize-btn[data-pf-tip]:hover::after { opacity: 1; }

    /* ── Before/after diff panel ─────────────────────── */
    #pf-diff {
      position: fixed;
      bottom: 136px;
      right: 20px;
      width: 380px;
      max-width: calc(100vw - 40px);
      background: #1a1a2e;
      border: 1px solid #7c3aed;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 2147483647;
    }
    #pf-diff-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(124,58,237,0.25);
      font-size: 12px;
      font-weight: 600;
      color: #a78bfa;
    }
    #pf-diff-close {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 0;
    }
    #pf-diff-close:hover { color: #e2e8f0; }
    #pf-diff-body {
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pf-diff-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 5px;
    }
    .pf-diff-label.pf-before { color: #64748b; }
    .pf-diff-label.pf-after  { color: #34d399; }
    .pf-diff-text {
      max-height: 88px;
      overflow-y: auto;
      background: rgba(255,255,255,0.04);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.5;
      color: #94a3b8;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .pf-diff-after-text { color: #e2e8f0; max-height: none; overflow: visible; }
    #pf-diff-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 10px 14px;
      border-top: 1px solid rgba(124,58,237,0.25);
    }
    .pf-diff-btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      transition: filter 0.15s;
    }
    .pf-diff-btn:hover { filter: brightness(1.15); }
    #pf-diff-keep  { background: rgba(255,255,255,0.07); color: #94a3b8; }
    #pf-diff-use   { background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; }
    #pf-diff-retry { background: none; border: 1px solid rgba(124,58,237,0.35); color: #a78bfa; margin-right: auto; }
    #pf-diff-retry:hover { background: rgba(124,58,237,0.12); filter: none; }
    /* Word-level diff highlights */
    .pf-diff-ins { background: rgba(52,211,153,0.18); color: #34d399; border-radius: 2px; padding: 0 1px; }
    .pf-diff-del { background: rgba(239,68,68,0.15);  color: #f87171; border-radius: 2px; padding: 0 1px; text-decoration: line-through; }

    /* Inline-editable After box */
    .pf-diff-after-text[contenteditable] { cursor: text; caret-color: #a78bfa; }
    .pf-diff-after-text[contenteditable]:focus { outline: 1px solid rgba(124,58,237,0.55); border-radius: 6px; }

    /* ── "Why this rewrite" rationale line ───────────────────────────────── */
    .pf-diff-rationale {
      font-size: 11px; font-style: italic; color: #64748b;
      line-height: 1.45; margin-top: 4px; padding: 0 2px;
    }

    /* ── System prompt export ────────────────────────────────────────────── */
    .pf-sys-trigger {
      background: none; border: none; color: rgba(124,58,237,0.55);
      font-size: 11px; cursor: pointer; padding: 4px 2px 0;
      font-family: inherit; text-align: left;
      text-decoration: underline; text-underline-offset: 2px;
      transition: color 0.15s; display: block;
    }
    .pf-sys-trigger:hover { color: #a78bfa; }
    .pf-sys-trigger:disabled { color: #475569; cursor: wait; }
    .pf-sys-box { margin-top: 10px; }
    .pf-sys-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #7c3aed; margin-bottom: 5px;
    }
    .pf-sys-text {
      background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.25);
      border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.5;
      color: #e2e8f0; white-space: pre-wrap; word-break: break-word;
      outline: none; cursor: text; caret-color: #a78bfa; min-height: 40px;
    }
    .pf-sys-text:focus { outline: 1px solid rgba(124,58,237,0.55); border-radius: 6px; }
    .pf-sys-copy {
      margin-top: 6px; display: block; background: none;
      border: 1px solid rgba(124,58,237,0.4); border-radius: 5px;
      color: #a78bfa; font-size: 11px; font-weight: 600; font-family: inherit;
      padding: 4px 12px; cursor: pointer; transition: background 0.15s;
    }
    .pf-sys-copy:hover { background: rgba(124,58,237,0.12); }

    /* ── Prompt Chain panel ──────────────────────────────────────────────── */
    .pf-chain-step { margin-bottom: 10px; }
    .pf-chain-step-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; margin-bottom: 5px;
      display: flex; align-items: center; gap: 6px;
    }
    .pf-chain-badge {
      background: linear-gradient(135deg,#7c3aed,#4f46e5);
      color: #fff; border-radius: 4px; padding: 1px 6px;
      font-size: 9px; font-weight: 800;
    }
    .pf-chain-step-title { color: #a78bfa; }
    .pf-chain-text {
      background: rgba(255,255,255,0.05); border-radius: 6px;
      padding: 8px 10px; font-size: 12px; line-height: 1.5;
      color: #e2e8f0; white-space: pre-wrap; word-break: break-word;
      outline: none; cursor: text; caret-color: #a78bfa;
      min-height: 40px;
    }
    .pf-chain-text:focus { outline: 1px solid rgba(124,58,237,0.55); border-radius: 6px; }
    #pf-chain-use1 { background: rgba(124,58,237,0.2); color: #a78bfa; border: 1px solid rgba(124,58,237,0.4); }
    #pf-chain-use2 { background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; }

    /* ── Mode chip strip (floats above the ⚡ button) ───────────────────── */
    #pf-mode-strip {
      position: fixed;
      bottom: 140px;
      right: 80px;
      display: flex;
      flex-direction: row;
      gap: 4px;
      align-items: center;
      z-index: 2147483640;
    }
    .pf-mode-chip {
      padding: 4px 10px;
      border-radius: 12px;
      border: 1px solid rgba(124,58,237,0.4);
      background: rgba(20,15,40,0.88);
      color: #94a3b8;
      font-size: 11px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      white-space: nowrap;
      backdrop-filter: blur(8px);
      transition: border-color 0.15s, color 0.15s, background 0.15s;
      line-height: 1;
    }
    .pf-mode-chip:hover { border-color: rgba(124,58,237,0.75); color: #c4b5fd; }
    .pf-mode-chip.pf-mode-active {
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      border-color: transparent;
      color: #fff;
    }

    /* ── Guided questions panel ──────────────────────────────────────────── */
    #pf-questions {
      position: fixed;
      bottom: 136px;
      right: 20px;
      width: 380px;
      max-width: calc(100vw - 40px);
      background: #1a1a2e;
      border: 1px solid #7c3aed;
      border-radius: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e8f0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 2147483647;
      padding: 14px;
    }
    .pf-question-title {
      font-size: 11px;
      font-weight: 700;
      color: #a78bfa;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .pf-question-item { margin-bottom: 10px; }
    .pf-question-label {
      font-size: 12px;
      color: #cbd5e1;
      margin-bottom: 5px;
      line-height: 1.4;
    }
    .pf-question-input {
      width: 100%;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(124,58,237,0.3);
      border-radius: 6px;
      padding: 7px 10px;
      color: #e2e8f0;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }
    .pf-question-input:focus { border-color: rgba(124,58,237,0.7); }
    #pf-questions-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 12px;
    }
    #pf-questions-skip    { background: rgba(255,255,255,0.07); color: #94a3b8; }
    #pf-questions-submit  { background: linear-gradient(135deg,#7c3aed,#4f46e5); color: #fff; }
    .pf-intent-subtitle {
      font-size: 12px; color: #94a3b8; line-height: 1.45; margin-bottom: 10px;
    }
    .pf-intent-input {
      width: 100%; background: rgba(255,255,255,0.06);
      border: 1px solid rgba(124,58,237,0.3); border-radius: 6px;
      padding: 8px 10px; color: #e2e8f0; font-size: 12px; font-family: inherit;
      outline: none; box-sizing: border-box; resize: vertical;
      min-height: 80px; line-height: 1.5; transition: border-color 0.15s;
    }
    .pf-intent-input:focus { border-color: rgba(124,58,237,0.7); }
    .pf-intent-input::placeholder { color: rgba(148,163,184,0.4); font-style: italic; }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'pf-styles';
  document.head.appendChild(styleEl);
  styleEl.textContent = CSS;

  /* ── Toast ────────────────────────────────────────────────────────────── */

  let toastEl = null;
  let toastTimer = null;
  let activeMode = 'auto'; // persisted in chrome.storage.local as 'pfMode'

  function toast(html, type = 'info', ms = 4000) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'pf-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = html;
    toastEl.className = `pf-show${type === 'error' ? ' pf-error' : type === 'success' ? ' pf-success' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.classList.remove('pf-show'), ms);
  }

  /* ── Button loading helpers ────────────────────────────────────────────── */

  function setLoadingLabel(btn, label) {
    if (!btn) return;
    btn.textContent = label;
    btn.disabled = true;
    btn.style.width = 'auto';
    btn.style.borderRadius = '8px';
    btn.style.padding = '0 8px';
    btn.style.fontSize = '11px';
    btn.style.whiteSpace = 'nowrap';
  }

  function restoreButton(btn) {
    if (!btn) return;
    btn.textContent = '⚡';
    btn.disabled = false;
    btn.style.width = '36px';
    btn.style.borderRadius = '50%';
    btn.style.padding = '';
    btn.style.fontSize = '16px';
    btn.style.whiteSpace = '';
  }

  /* ── Find the platform's contenteditable input ─────────────────────────── */

  function findEditor() {
    // Gemini uses Quill editor inside a <rich-textarea> custom element
    if (PLATFORM === 'gemini') {
      const candidates = [
        'rich-textarea .ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    // Claude: ProseMirror contenteditable (ordered most → least specific)
    const candidates = [
      'div[contenteditable="true"][data-placeholder]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /* ── Find where to insert the button (before the send button) ─────────── */

  function findInsertionPoint(editor) {
    // Walk up from the editor looking for a sibling container with buttons
    let node = editor;
    for (let depth = 0; depth < 10; depth++) {
      node = node.parentElement;
      if (!node) break;

      // Preferred: a button with a send-like aria-label
      const sendSels = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        'button[aria-label*="send" i]',
        'button[data-testid*="send" i]',
        'button[type="submit"]',
      ];
      for (const s of sendSels) {
        const sendBtn = node.querySelector(s);
        // Use sendBtn.parentNode (not .parentElement from the wrapper query) so
        // the reference node is guaranteed to be a direct child of the parent.
        if (sendBtn && sendBtn.id !== 'pf-optimize-btn' && sendBtn.parentNode) {
          return { parent: sendBtn.parentNode, before: sendBtn };
        }
      }

      // Fallback: any sibling element that contains ≥1 *direct-child* button
      for (const child of node.children) {
        if (child === editor) continue;
        // Only look at direct children so `before` is always a child of `parent`
        const directBtn = [...child.children].find(
          c => c.tagName === 'BUTTON' && c.id !== 'pf-optimize-btn'
        );
        if (directBtn) {
          return { parent: child, before: directBtn };
        }
      }
    }
    return null;
  }

  /* ── Read text from the contenteditable ───────────────────────────────── */

  function getEditorText(editor) {
    return editor.innerText.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ── Write text back (platform-aware) ──────────────────────────────────── */

  function setEditorText(editor, text) {
    editor.focus();

    // Select all existing content
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // execCommand('insertText') fires the native InputEvent that React/ProseMirror
    // and Quill both listen to — keeps framework state in sync.
    const ok = document.execCommand('insertText', false, text);

    if (!ok) {
      if (PLATFORM === 'gemini') {
        // Quill fallback: rebuild as <p> paragraphs, then fire input on both
        // the .ql-editor div and its parent <rich-textarea> Angular component.
        editor.innerHTML = text
          .split('\n')
          .map(line => `<p>${line || '<br>'}</p>`)
          .join('');
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, data: text, inputType: 'insertText',
        }));
        const richTextarea = editor.closest('rich-textarea');
        if (richTextarea) richTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Claude / ProseMirror fallback
        editor.innerText = text;
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, data: text, inputType: 'insertText',
        }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Move caret to end
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  /* ── Scrape visible conversation for context ──────────────────────────── */

  function scrapeConversation() {
    const PF = '[PromptForge scrape]';

    // ── Platform-specific selectors — each role finds its best match independently
    const HUMAN_SELS = PLATFORM === 'gemini' ? [
      // Gemini uses Angular custom elements; try specific → generic
      'user-query-text',
      '.query-text',
      'user-query .query-content',
      '[class*="user-query"]',
      '[data-message-author-role="user"]',
    ] : [
      '[data-testid="human-turn"]',
      '[data-testid="user-turn"]',
      '[data-testid="user-message"]',
      '[data-message-author-role="user"]',
      '[data-role="user"]',
      '[class*="HumanTurn"]',
      '[class*="human-turn"]',
      '[class*="UserMessage"]',
      '[class*="user-message"]',
      '[class*="humanMessage"]',
      '[data-testid*="human-turn"]',     // substring: catches human-turn, human-turn-container, etc.
      '[data-testid*="user-turn"]',      // same for user-turn variants
      '[aria-label*="You said" i]',
    ];

    const ASSISTANT_SELS = PLATFORM === 'gemini' ? [
      'model-response-text',
      '.model-response-text',
      'message-content .markdown',
      '[class*="model-response"]',
      '[data-message-author-role="model"]',
      '.response-container .markdown',
    ] : [
      '[data-testid="ai-turn"]',
      '[data-testid="assistant-turn"]',
      '[data-testid="assistant-message"]',
      '.font-claude-message',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[class*="AiTurn"]',
      '[class*="ai-turn"]',
      '[class*="AssistantMessage"]',
      '[class*="assistant-message"]',
      '[class*="assistantMessage"]',
      '[class*="Assistant"]',
      '[data-testid*="assistant-turn"]', // substring: catches assistant-turn, assistant-turn-container, etc.
      '[data-testid*="ai-turn"]',        // same for ai-turn variants
      '.prose',                          // Claude uses this class for formatted responses
      '[aria-label*="Claude" i]',
    ];

    const firstMatch = (sels) => {
      for (const sel of sels) {
        const els = [...document.querySelectorAll(sel)];
        if (els.length > 0) return { els, sel };
      }
      return { els: [], sel: null };
    };

    const { els: humanEls,     sel: humanSel     } = firstMatch(HUMAN_SELS);
    const { els: assistantEls, sel: assistantSel } = firstMatch(ASSISTANT_SELS);

    // ── Always log both counts so mismatches are immediately visible ───────
    console.log(PF,
      `Human: ${humanEls.length} via ${humanSel || '(no match)'}  |  ` +
      `Assistant: ${assistantEls.length} via ${assistantSel || '(no match)'}`
    );

    if (humanEls.length === 0 && assistantEls.length === 0) {
      console.warn(PF, `⚠️  No turns found (platform: ${PLATFORM}). All data-testid values in DOM:`,
        [...new Set(
          [...document.querySelectorAll('[data-testid]')]
            .map(el => el.getAttribute('data-testid'))
        )].sort()
      );
      console.info(PF, '.font-claude-message count:',
        document.querySelectorAll('.font-claude-message').length);

      // Broad fallback: when structured selectors fail, scan for any large text
      // block that looks like an AI response so Agent 1 still has something to
      // classify domain/task from. Exclude our own injected panels.
      const BROAD_SELS = [
        '[class*="markdown"]:not(#pf-diff *):not(#pf-questions *)',
        '[class*="prose"]:not(#pf-diff *):not(#pf-questions *)',
        '[class*="response-text"]:not(#pf-diff *)',
        '[class*="assistant"]:not(#pf-diff *)',
        '[class*="claude"]:not(#pf-diff *)',
      ];
      let broadLastMsg = null;
      for (const sel of BROAD_SELS) {
        try {
          const els = [...document.querySelectorAll(sel)]
            .filter(el => (el.textContent || '').trim().length > 50);
          if (els.length > 0) {
            broadLastMsg = (els[els.length - 1].textContent || '').trim().slice(0, 3000);
            console.log(PF, `Broad fallback: recovered last response (${broadLastMsg.length} chars) via "${sel}"`);
            break;
          }
        } catch { /* invalid selector — skip */ }
      }
      if (!broadLastMsg) console.warn(PF, 'Broad fallback also found nothing — pipeline will run without context.');
      return { turns: [], lastAssistantMessage: broadLastMsg };
    }

    // ── Merge and sort by DOM document order ──────────────────────────────
    const tagged = [
      ...humanEls.map(el => ({ el, role: 'Human' })),
      ...assistantEls.map(el => ({ el, role: 'Assistant' })),
    ].sort((a, b) => {
      const rel = a.el.compareDocumentPosition(b.el);
      // DOCUMENT_POSITION_FOLLOWING (4) means b comes after a
      return (rel & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    // ── Grab last assistant element at full length (no char cap) ──────────
    // This is the actual content the user is likely referring to — code,
    // a draft, data — so Agent 2 needs to see it intact.
    const lastAssistantEl = [...tagged].reverse().find(t => t.role === 'Assistant')?.el;
    const lastAssistantMessage = lastAssistantEl
      ? (lastAssistantEl.textContent || lastAssistantEl.innerText || '').trim().slice(0, 3000) || null
      : null;
    if (lastAssistantMessage)
      console.log(PF, `Last assistant message (${lastAssistantMessage.length} chars):`, lastAssistantMessage.slice(0, 120) + '…');

    // ── Extract text, filter blanks, cap length ────────────────────────────
    const turns = tagged
      .map(({ el, role }) => ({
        role,
        text: (el.textContent || el.innerText || '').trim(),
      }))
      .filter(turn => turn.text.length > 1)
      .map(({ role, text }) => ({
        role,
        content: text.length > 1500 ? text.slice(0, 1497) + '…' : text,
      }));

    // Last 12 turns = ≈6 full exchanges — enough for Agent 1 to understand what's being discussed
    const final = turns.slice(-12);

    // ── Confirm what we're sending ────────────────────────────────────────
    console.log(PF, `Sending ${final.length} turns as context:`);
    final.forEach((t, i) =>
      console.log(PF, `  [${i}] ${t.role}: ${t.content.slice(0, 80)}…`)
    );

    return { turns: final, lastAssistantMessage };
  }

  /* ── Safe wrapper for chrome.* calls ─────────────────────────────────── */
  // After an extension reload, the old content script stays alive but its
  // chrome.runtime/storage handles become invalid. Any call throws
  // "Extension context invalidated". safeRuntime catches that, removes the
  // stale button so the user isn't stuck clicking a dead control, and returns
  // null so callers can bail cleanly.

  function safeRuntime(fn) {
    try {
      return fn();
    } catch (e) {
      if (e?.message?.includes('Extension context invalidated')) {
        document.getElementById('pf-optimize-btn')?.remove();
        document.getElementById('pf-mode-strip')?.remove();
        console.warn('[PromptForge] Extension context invalidated — button removed. Reload the page to reactivate.');
      }
      return null;
    }
  }

  /* ── Word-level diff ───────────────────────────────────────────────────── */
  // Returns an array of { type: 'same'|'ins'|'del', text } tokens.
  // Tokenises on whitespace boundaries so spaces are preserved in output.
  // LCS-based — correct but lightweight enough for short prompts (≤~150 tokens).

  function wordDiff(before, after) {
    const tokA = before.match(/\S+|\s+/g) || [];
    const tokB = after.match(/\S+|\s+/g)  || [];
    const m = tokA.length, n = tokB.length;

    // DP table using typed arrays for memory efficiency
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = tokA[i - 1] === tokB[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

    // Backtrack
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && tokA[i - 1] === tokB[j - 1]) {
        ops.unshift({ type: 'same', text: tokB[j - 1] }); i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ type: 'ins',  text: tokB[j - 1] }); j--;
      } else {
        ops.unshift({ type: 'del',  text: tokA[i - 1] }); i--;
      }
    }
    return ops;
  }

  /* ── Guided questions panel ────────────────────────────────────────────── */
  // Shows 2 AI-generated clarifying questions in a panel. When the user submits,
  // the formatted answers are forwarded into the Agent 2 user message.

  function showIntentPanel(onSubmit) {
    document.getElementById('pf-questions')?.remove();

    const panel = document.createElement('div');
    panel.id = 'pf-questions';

    const title = document.createElement('div');
    title.className = 'pf-question-title';
    title.textContent = '⚡ What are you going for?';
    panel.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'pf-intent-subtitle';
    subtitle.textContent = 'Describe what a perfect response would look like, or just type what\'s on your mind.';
    panel.appendChild(subtitle);

    const textarea = document.createElement('textarea');
    textarea.className = 'pf-intent-input';
    textarea.placeholder = 'e.g. "I want it to explain like I\'m a senior dev, skip the basics, focus on edge cases…"';
    panel.appendChild(textarea);

    const footer = document.createElement('div');
    footer.id = 'pf-questions-footer';

    const skipBtn = document.createElement('button');
    skipBtn.id = 'pf-questions-skip';
    skipBtn.className = 'pf-diff-btn';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Skip →';

    const submitBtn = document.createElement('button');
    submitBtn.id = 'pf-questions-submit';
    submitBtn.className = 'pf-diff-btn';
    submitBtn.type = 'button';
    submitBtn.textContent = 'Optimize →';

    footer.append(skipBtn, submitBtn);
    panel.appendChild(footer);
    document.body.appendChild(panel);
    textarea.focus();

    const dismiss = () => {
      panel.remove();
      document.removeEventListener('keydown', onEscape);
    };

    const doSubmit = () => {
      const intent = textarea.value.trim();
      dismiss();
      onSubmit(intent ? [intent] : []);
    };

    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        doSubmit();
      }
    });

    skipBtn.addEventListener('click',   () => { dismiss(); onSubmit([]); });
    submitBtn.addEventListener('click', doSubmit);

    const onEscape = (e) => {
      if (e.key === 'Escape') { dismiss(); onSubmit([]); }
    };
    document.addEventListener('keydown', onEscape);
  }

  /* ── Prompt Chain panel (D) ────────────────────────────────────────────── */
  // Renders two editable boxes: Step 1 (priming) and Step 2 (main task).
  // User sends Step 1 first to get Claude thinking, then sends Step 2.

  function showChainPanel(optimized, editor, sources) {
    const [priming, main] = optimized.split('\n\n---CHAIN→---\n\n');

    const panel = document.createElement('div');
    panel.id = 'pf-diff';

    const header = document.createElement('div');
    header.id = 'pf-diff-header';
    const title = document.createElement('span');
    title.textContent = '⚡ Prompt Chain — Send in order';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'pf-diff-close'; closeBtn.type = 'button'; closeBtn.textContent = '✕';
    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.id = 'pf-diff-body';

    const makeStep = (badge, labelText, content) => {
      const wrap = document.createElement('div');
      wrap.className = 'pf-chain-step';

      const lbl = document.createElement('div');
      lbl.className = 'pf-chain-step-label';
      const badgeEl = document.createElement('span');
      badgeEl.className = 'pf-chain-badge';
      badgeEl.textContent = badge;
      const titleEl = document.createElement('span');
      titleEl.className = 'pf-chain-step-title';
      titleEl.textContent = labelText;
      lbl.append(badgeEl, titleEl);

      const txt = document.createElement('div');
      txt.className = 'pf-chain-text';
      txt.contentEditable = 'true';
      txt.spellcheck = false;
      txt.textContent = content;

      wrap.append(lbl, txt);
      return { wrap, txt };
    };

    const { wrap: step1Wrap, txt: step1El } = makeStep('STEP 1', 'Send first — gets Claude thinking', priming);
    const { wrap: step2Wrap, txt: step2El } = makeStep('STEP 2', 'Then send — the full task', main);
    body.append(step1Wrap, step2Wrap);

    const footer = document.createElement('div');
    footer.id = 'pf-diff-footer';

    const keepBtn = document.createElement('button');
    keepBtn.id = 'pf-diff-keep'; keepBtn.className = 'pf-diff-btn';
    keepBtn.type = 'button'; keepBtn.textContent = 'Keep original';

    const use1Btn = document.createElement('button');
    use1Btn.id = 'pf-chain-use1'; use1Btn.className = 'pf-diff-btn';
    use1Btn.type = 'button'; use1Btn.textContent = 'Use Step 1 →';

    const use2Btn = document.createElement('button');
    use2Btn.id = 'pf-chain-use2'; use2Btn.className = 'pf-diff-btn';
    use2Btn.type = 'button'; use2Btn.textContent = 'Use Step 2 →';

    footer.append(keepBtn, use1Btn, use2Btn);
    panel.append(header, body, footer);
    document.body.appendChild(panel);

    const dismiss = () => { panel.remove(); document.removeEventListener('keydown', onKey); };

    closeBtn.addEventListener('click', dismiss);
    keepBtn.addEventListener('click',  dismiss);

    use1Btn.addEventListener('click', () => {
      setEditorText(editor, (step1El.innerText || '').trim() || priming);
      toast('⚡ Step 1 applied — send it, then come back for Step 2', 'success', 5500);
      dismiss();
    });
    use2Btn.addEventListener('click', () => {
      setEditorText(editor, (step2El.innerText || '').trim() || main);
      const byLine = sources.length > 0
        ? `<br><small style="opacity:0.75">patterns from: ${sources.join(', ')}</small>`
        : '';
      toast(`⚡ Step 2 applied — ready to send${byLine}`, 'success', 4500);
      dismiss();
    });

    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
  }

  /* ── Before/after diff panel ───────────────────────────────────────────── */

  function showDiff(original, optimized, editor, sources, rationale = '') {
    console.log('[Modal AFTER text]:', optimized);
    document.getElementById('pf-diff')?.remove();

    // Chain mode produces two prompts separated by a sentinel
    if (optimized.includes('\n\n---CHAIN→---\n\n')) {
      showChainPanel(optimized, editor, sources);
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'pf-diff';

    // Header
    const header = document.createElement('div');
    header.id = 'pf-diff-header';
    const title = document.createElement('span');
    title.textContent = '⚡ Prompt Forge — Review Changes';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'pf-diff-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    header.append(title, closeBtn);

    // Body: before + after sections with word-level diff
    const body = document.createElement('div');
    body.id = 'pf-diff-body';

    const tokens = wordDiff(original, optimized);
    let afterTextEl = null; // captured for inline editing (G)

    const makeSection = (labelText, isAfter) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      lbl.className  = `pf-diff-label ${isAfter ? 'pf-after' : 'pf-before'}`;
      lbl.textContent = labelText;
      const txt  = document.createElement('div');
      txt.className  = `pf-diff-text${isAfter ? ' pf-diff-after-text' : ''}`;

      // After box is directly editable — tweak the result before applying
      if (isAfter) {
        txt.contentEditable = 'true';
        txt.spellcheck = false;
        afterTextEl = txt;
      }

      tokens.forEach(({ type, text }) => {
        // Before box: show 'same' + 'del' (red strikethrough); skip 'ins'
        // After  box: show 'same' + 'ins' (green highlight);   skip 'del'
        if (isAfter  && type === 'del') return;
        if (!isAfter && type === 'ins') return;

        if (type === 'same') {
          txt.appendChild(document.createTextNode(text));
        } else {
          const mark = document.createElement('mark');
          mark.className  = type === 'ins' ? 'pf-diff-ins' : 'pf-diff-del';
          mark.textContent = text;
          txt.appendChild(mark);
        }
      });

      wrap.append(lbl, txt);
      return wrap;
    };
    body.append(makeSection('Before', false), makeSection('After', true));

    // ── "Why this rewrite" rationale (#10) ──────────────────────────────
    if (rationale) {
      const whyEl = document.createElement('div');
      whyEl.className = 'pf-diff-rationale';
      whyEl.textContent = `💡 ${rationale}`;
      body.appendChild(whyEl);
    }

    // ── System prompt export trigger (#9) ────────────────────────────────
    const sysTrigger = document.createElement('button');
    sysTrigger.className = 'pf-sys-trigger';
    sysTrigger.textContent = '→ Export as Claude Projects system prompt';
    sysTrigger.addEventListener('click', async () => {
      sysTrigger.textContent = '⏳ Generating…';
      sysTrigger.disabled = true;
      try {
        const promptText = (afterTextEl?.innerText || '').trim() || optimized;
        const res = await safeRuntime(() => chrome.runtime.sendMessage({
          type: 'GENERATE_SYSTEM_PROMPT',
          payload: { optimizedPrompt: promptText },
        }));
        if (!res?.success) throw new Error(res?.error || 'Failed');

        sysTrigger.remove();

        const sysBox   = document.createElement('div');
        sysBox.className = 'pf-sys-box';

        const sysLabel = document.createElement('div');
        sysLabel.className = 'pf-sys-label';
        sysLabel.textContent = 'System prompt — paste into Claude Projects → Instructions';

        const sysTxt = document.createElement('div');
        sysTxt.className = 'pf-sys-text';
        sysTxt.contentEditable = 'true';
        sysTxt.spellcheck = false;
        sysTxt.textContent = res.data;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'pf-sys-copy';
        copyBtn.textContent = 'Copy to clipboard';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(sysTxt.innerText.trim()).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
          });
        });

        sysBox.append(sysLabel, sysTxt, copyBtn);
        body.appendChild(sysBox);
      } catch {
        sysTrigger.textContent = '→ Export as Claude Projects system prompt';
        sysTrigger.disabled = false;
      }
    });
    body.appendChild(sysTrigger);

    // Footer: ↺ Try again · Keep original · Use this ✓
    const footer = document.createElement('div');
    footer.id = 'pf-diff-footer';
    const retryBtn = document.createElement('button');
    retryBtn.id = 'pf-diff-retry';
    retryBtn.className = 'pf-diff-btn';
    retryBtn.type = 'button';
    retryBtn.textContent = '↺ Try again';
    const keepBtn = document.createElement('button');
    keepBtn.id = 'pf-diff-keep';
    keepBtn.className = 'pf-diff-btn';
    keepBtn.type = 'button';
    keepBtn.textContent = 'Keep original';
    const useBtn = document.createElement('button');
    useBtn.id = 'pf-diff-use';
    useBtn.className = 'pf-diff-btn';
    useBtn.type = 'button';
    useBtn.textContent = 'Use this ✓';
    footer.append(retryBtn, keepBtn, useBtn);

    panel.append(header, body, footer);
    document.body.appendChild(panel);

    const dismiss = () => panel.remove();

    closeBtn.addEventListener('click', dismiss);
    keepBtn.addEventListener('click', dismiss);
    retryBtn.addEventListener('click', () => { dismiss(); handleOptimize(); });
    useBtn.addEventListener('click', () => {
      // Read from the editable After box — the user may have tweaked it
      const finalText = (afterTextEl?.innerText || '').trim() || optimized;

      // If the user changed the After box, run trajectory analysis in the background.
      // AgentTrajectory will extract style rules and persist them for future pipelines.
      if (finalText !== optimized) {
        safeRuntime(() => chrome.runtime.sendMessage({
          type: 'ANALYZE_EDIT_DELTA',
          payload: { optimized, userEdited: finalText },
        })).catch(() => {});
      }

      setEditorText(editor, finalText);
      const byLine = sources.length > 0
        ? `<br><small style="opacity:0.75">patterns from: ${sources.join(', ')}</small>`
        : '';
      toast(`⚡ Optimized using prompts.chat${byLine}`, 'success', 4500);
      dismiss();
    });

    // Dismiss on Escape
    const onKey = (e) => {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  /* ── Click handler — entry point ──────────────────────────────────────── */

  async function handleOptimize() {
    console.log('[PromptForge] handleOptimize — activeMode:', activeMode, '— platform:', PLATFORM);
    const btn    = document.getElementById('pf-optimize-btn');
    const editor = findEditor();

    if (!editor) {
      toast('❌ Could not find the chat input box.', 'error', 4000);
      return;
    }

    const raw = getEditorText(editor);
    if (!raw || raw.trim().length < 3) {
      toast('💡 Type something first', 'info', 2000);
      return;
    }

    // Check for Groq API key
    let key;
    try {
      const stored = await safeRuntime(() => chrome.storage.sync.get('groqApiKey'));
      if (!stored) return; // context invalidated — button already removed
      key = stored.groqApiKey;
    } catch {
      key = null;
    }

    if (!key) {
      toast(
        `⚡ <strong>Prompt Forge</strong>: No Groq API key. ` +
        `<button class="pf-link" id="pf-open-opts">Open Settings →</button>`,
        'error', 8000
      );
      document.getElementById('pf-open-opts')?.addEventListener('click', () => {
        safeRuntime(() => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
      });
      return;
    }

    const { turns: chatHistory, lastAssistantMessage } = scrapeConversation();
    const hasContext = chatHistory.length > 0 || !!lastAssistantMessage;

    // ── Vague prompt + no/thin context → auto-redirect to Guide mode ────────
    // A short vague prompt ("help me", "fix this") produces a useless generic
    // rewrite when context is absent or too thin for Agent 1 to extract intent.
    // "contextIsStrong" requires either ≥3 turns OR a substantial last message —
    // a single "Hello!" exchange does not count as usable context.
    const contextIsStrong = chatHistory.length >= 3 || (lastAssistantMessage?.length ?? 0) > 300;
    if (raw.trim().length < 40 && !contextIsStrong && activeMode !== 'guided') {
      toast(
        '💡 Vague prompt + insufficient context — switching to <strong>Guide</strong> mode for a better result.',
        'info', 5500
      );
      activeMode = 'guided';
      document.querySelectorAll('.pf-mode-chip').forEach(c =>
        c.classList.toggle('pf-mode-active', c.dataset.mode === 'guided')
      );
      showIntentPanel((answers) => {
        runPipeline(raw, chatHistory, lastAssistantMessage, answers, editor);
      });
      return;
    }

    // ── Warn (but don't block) when context is missing for longer prompts ────
    if (!hasContext) {
      toast(
        '⚠️ No chat history found — result may be generic. Try <strong>Guide</strong> mode to describe your goal.',
        'info', 5000
      );
    }

    // ── Guided mode: show intent panel first, then run ───────────────────────
    if (activeMode === 'guided') {
      showIntentPanel((answers) => {
        runPipeline(raw, chatHistory, lastAssistantMessage, answers, editor);
      });
      return;
    }

    // ── All other modes: run pipeline directly ───────────────────────────────
    runPipeline(raw, chatHistory, lastAssistantMessage, [], editor);
  }

  /* ── Pipeline runner (called directly or after guided questions) ───────── */

  async function runPipeline(raw, chatHistory, lastAssistantMessage, answers, editor) {
    const btn = document.getElementById('pf-optimize-btn');
    setLoadingLabel(btn, '⚡ Pruning...');

    console.log('[PromptForge] Optimizing with context:',
      { promptLength: raw.length, historyTurns: chatHistory.length,
        lastAssistantChars: lastAssistantMessage?.length ?? 0,
        mode: activeMode, answers: answers.length });

    try {
      const res = await safeRuntime(() => chrome.runtime.sendMessage({
        type: 'OPTIMIZE_WITH_CONTEXT',
        payload: { prompt: raw, chatHistory, lastAssistantMessage, mode: activeMode, answers },
      }));

      if (!res) return; // context invalidated
      if (!res.success) throw new Error(res.error);

      const sources   = (res.data.inspiredBy || []).filter(Boolean);
      const rationale = res.data.rationale || '';
      showDiff(raw, res.data.optimized, editor, sources, rationale);
    } catch (err) {
      const msg = String(err?.message || err).replace(/^Error:\s*/i, '');
      toast(`❌ ${msg}`, 'error', 6000);
    } finally {
      restoreButton(btn);
    }
  }

  /* ── Inject the fixed-position button + mode strip ────────────────────── */

  function inject() {
    // Idempotent: bail immediately if already present
    if (document.getElementById('pf-optimize-btn')) return;

    // Need at least an editor on the page to be useful
    const editor = findEditor();
    if (!editor) return;

    // ── ⚡ Optimize button ──────────────────────────────────────────────────
    const btn = document.createElement('button');
    btn.id    = 'pf-optimize-btn';
    btn.type  = 'button';
    btn.textContent = '⚡';
    btn.title = '';
    btn.setAttribute('data-pf-tip',
      'Type your prompt, then click ⚡ to optimize it using proven patterns from prompts.chat');
    btn.style.cssText = [
      'position:fixed',
      'bottom:90px',
      'right:80px',
      'z-index:9999',
      'background:#7c3aed',
      'color:#fff',
      'border:none',
      'border-radius:50%',
      'width:36px',
      'height:36px',
      'font-size:16px',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
      'transition:opacity 0.15s,transform 0.1s',
    ].join(';');

    document.body.appendChild(btn);
    btn.addEventListener('click', handleOptimize);

    // ── Mode chip strip ─────────────────────────────────────────────────────
    const strip = document.createElement('div');
    strip.id = 'pf-mode-strip';

    const MODES = [
      { id: 'auto',     label: 'Auto'     },
      { id: 'learn',    label: 'Learn'    },
      { id: 'brief',    label: 'Brief'    },
      { id: 'deep',     label: 'Deep'     },
      { id: 'creative', label: 'Creative' },
      { id: 'guided',   label: 'Guide'    },
      { id: 'chain',    label: 'Chain'    },
    ];

    const renderChips = () => {
      strip.querySelectorAll('.pf-mode-chip').forEach(c => {
        c.classList.toggle('pf-mode-active', c.dataset.mode === activeMode);
      });
    };

    MODES.forEach(({ id, label }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `pf-mode-chip${activeMode === id ? ' pf-mode-active' : ''}`;
      chip.dataset.mode = id;
      chip.textContent = label;
      chip.addEventListener('click', () => {
        activeMode = id;
        safeRuntime(() => chrome.storage.local.set({ pfMode: id }));
        renderChips();
      });
      strip.appendChild(chip);
    });

    document.body.appendChild(strip);

    // Load the previously saved mode
    safeRuntime(() =>
      chrome.storage.local.get('pfMode').then(s => {
        if (s.pfMode && MODES.some(m => m.id === s.pfMode)) {
          activeMode = s.pfMode;
          renderChips();
        }
      }).catch(() => {})
    );
  }

  /* ── Retry loop: poll until the editor exists, then inject once ────────── */

  function tryInject() {
    // Remove any stale button + mode strip from a previous chat
    document.getElementById('pf-optimize-btn')?.remove();
    document.getElementById('pf-mode-strip')?.remove();

    let attempts = 0;
    const id = setInterval(() => {
      inject();
      // Stop as soon as the button is in the DOM, or after ~12 s
      if (document.getElementById('pf-optimize-btn') || ++attempts > 25) {
        clearInterval(id);
      }
    }, 500);
  }

  /* ── SPA navigation: debounced MutationObserver on body childList only ── */

  let lastHref   = location.href;
  let navDebounce = null;

  // subtree:false — only direct children of <body> are watched.
  // This prevents the observer from firing on every keystroke / React re-render.
  new MutationObserver(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;

    clearTimeout(navDebounce);
    navDebounce = setTimeout(tryInject, 1200);
  }).observe(document.body, { childList: true, subtree: false });

  /* ── Pipeline progress listener (background → content) ────────────────── */
  // Background sends PIPELINE_PROGRESS during the 3-agent pipeline so the
  // button label stays in sync: "⚡ Pruning..." → "⚡ Optimizing..." → "⚡ Checking..."
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'PIPELINE_PROGRESS') return;
    const btn = document.getElementById('pf-optimize-btn');
    if (btn) btn.textContent = message.label;
  });

  /* ── Boot ──────────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
