// Prompt Forge — content.js
// Injected into claude.ai. Adds an ⚡ Optimize button next to the send button.
// Reads the typed prompt + visible chat history and sends them to background.js.

(function promptForge() {
  'use strict';

  const PF_DEBUG = false;
  const pfLog = (...args) => { if (PF_DEBUG) console.log('[PromptForge]', ...args); };

  // Prevent double-injection on hot reloads
  if (window.__pfInjected) return;
  window.__pfInjected = true;

  /* ── Platform detection ────────────────────────────────────────────────── */
  // Drives selector strategy for findEditor, setEditorText, scrapeConversation.
  const PLATFORM = location.hostname.includes('gemini.google.com') ? 'gemini' : 'claude';

  /* ── Styles injected into the host page ───────────────────────────────── */

  const CSS = `
    /* ── Design tokens ─────────────────────────────────────────────────── */
    :root {
      --pf-bg-deep: #09090f;
      --pf-bg-panel: #0f0f1a;
      --pf-bg-surface: rgba(255,255,255,0.03);
      --pf-bg-surface-hover: rgba(255,255,255,0.06);
      --pf-border: rgba(255,255,255,0.06);
      --pf-border-focus: rgba(139,92,246,0.45);
      --pf-accent: #8b5cf6;
      --pf-accent-dim: rgba(139,92,246,0.15);
      --pf-accent-glow: rgba(139,92,246,0.3);
      --pf-text-primary: #f1f5f9;
      --pf-text-secondary: #94a3b8;
      --pf-text-muted: #64748b;
      --pf-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
      --pf-font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
      --pf-radius-panel: 12px;
      --pf-radius-btn: 8px;
      --pf-shadow-panel: 0 8px 32px rgba(0,0,0,0.4);
      --pf-transition: 0.15s ease;
    }

    @keyframes pf-pulse {
      0%, 100% { opacity: 1; box-shadow: 0 4px 12px var(--pf-accent-glow); }
      50%      { opacity: 0.7; box-shadow: 0 4px 20px rgba(139,92,246,0.5); }
    }

    /* ── Toast ──────────────────────────────────────────────────────────── */
    #pf-toast {
      position: fixed;
      bottom: 90px;
      left: 50%;
      transform: translateX(-50%) translateY(12px);
      max-width: 380px;
      padding: 10px 16px;
      background: rgba(15,15,26,0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--pf-text-primary);
      border: 1px solid var(--pf-border);
      border-left: 3px solid var(--pf-accent);
      border-radius: 10px;
      font-size: 13px;
      font-family: var(--pf-font-sans);
      line-height: 1.45;
      text-align: center;
      box-shadow: var(--pf-shadow-panel);
      z-index: 2147483647;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.25s ease;
    }
    #pf-toast.pf-show {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }
    #pf-toast.pf-error {
      border-left-color: #ef4444;
      color: #fca5a5;
    }
    #pf-toast.pf-success {
      border-left-color: #10b981;
      color: #6ee7b7;
    }
    #pf-toast a, #pf-toast button.pf-link {
      color: var(--pf-accent);
      text-decoration: underline;
      text-underline-offset: 2px;
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
      width: 190px;
      padding: 8px 10px;
      background: rgba(15,15,26,0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--pf-text-secondary);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-radius-btn);
      font-size: 11px;
      font-family: var(--pf-font-sans);
      font-weight: 400;
      line-height: 1.45;
      white-space: normal;
      text-align: left;
      box-shadow: var(--pf-shadow-panel);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
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
      background: var(--pf-bg-panel);
      border: 1px solid var(--pf-border);
      border-top: 2px solid var(--pf-accent);
      border-radius: var(--pf-radius-panel);
      font-family: var(--pf-font-sans);
      color: var(--pf-text-primary);
      box-shadow: var(--pf-shadow-panel);
      z-index: 2147483647;
      overflow: hidden;
    }
    #pf-diff-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pf-border);
      font-size: 12px;
      font-weight: 600;
      color: var(--pf-text-primary);
    }
    #pf-diff-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--pf-bg-surface);
      border: 1px solid var(--pf-border);
      border-radius: 6px;
      color: var(--pf-text-muted);
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 0;
      transition: color var(--pf-transition), background var(--pf-transition);
    }
    #pf-diff-close:hover { color: var(--pf-text-primary); background: var(--pf-bg-surface-hover); }
    #pf-diff-body {
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pf-diff-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 5px;
    }
    .pf-diff-label.pf-before { color: var(--pf-text-muted); }
    .pf-diff-label.pf-after  { color: #34d399; }
    .pf-diff-text {
      max-height: 88px;
      overflow-y: auto;
      background: var(--pf-bg-surface);
      border: 1px solid var(--pf-border);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 11.5px;
      line-height: 1.55;
      color: var(--pf-text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .pf-diff-after-text {
      color: var(--pf-text-primary);
      max-height: none;
      overflow: visible;
      background: rgba(9,9,15,0.6);
      font-family: var(--pf-font-mono);
      font-size: 11px;
      line-height: 1.55;
    }
    #pf-diff-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 12px 16px;
      border-top: 1px solid var(--pf-border);
    }
    .pf-diff-btn {
      padding: 7px 16px;
      border-radius: var(--pf-radius-btn);
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      transition: background var(--pf-transition), transform var(--pf-transition), box-shadow var(--pf-transition);
    }
    .pf-diff-btn:hover { transform: translateY(-1px); }
    .pf-diff-btn:active { transform: translateY(0); }
    #pf-diff-keep  { background: var(--pf-bg-surface-hover); color: var(--pf-text-secondary); border: 1px solid var(--pf-border); }
    #pf-diff-keep:hover { background: rgba(255,255,255,0.08); }
    #pf-diff-use   { background: var(--pf-accent); color: #fff; box-shadow: 0 2px 8px var(--pf-accent-glow); }
    #pf-diff-use:hover { box-shadow: 0 4px 16px rgba(139,92,246,0.4); }
    #pf-diff-retry { background: none; border: 1px solid var(--pf-border); color: var(--pf-text-secondary); margin-right: auto; }
    #pf-diff-retry:hover { background: var(--pf-bg-surface); color: var(--pf-text-primary); }
    /* Word-level diff highlights */
    .pf-diff-ins { background: rgba(52,211,153,0.12); color: #6ee7b7; border-radius: 2px; padding: 0 2px; }
    .pf-diff-del { background: rgba(239,68,68,0.10);  color: #fca5a5; border-radius: 2px; padding: 0 2px; text-decoration: line-through; }

    /* Inline-editable After box */
    .pf-diff-after-text[contenteditable] { cursor: text; caret-color: var(--pf-accent); }
    .pf-diff-after-text[contenteditable]:focus { outline: 1px solid var(--pf-border-focus); border-radius: 8px; }

    /* ── "Why this rewrite" rationale line ───────────────────────────────── */
    .pf-diff-rationale {
      font-size: 11px; font-style: italic; color: var(--pf-text-muted);
      line-height: 1.45; margin-top: 4px; padding: 0 2px;
    }

    /* ── System prompt export ────────────────────────────────────────────── */
    .pf-sys-trigger {
      background: none; border: none; color: var(--pf-text-muted);
      font-size: 11px; cursor: pointer; padding: 4px 2px 0;
      font-family: inherit; text-align: left;
      text-decoration: underline; text-underline-offset: 2px;
      transition: color var(--pf-transition); display: block;
    }
    .pf-sys-trigger:hover { color: var(--pf-accent); }
    .pf-sys-trigger:disabled { color: #334155; cursor: wait; }
    .pf-sys-box { margin-top: 12px; }
    .pf-sys-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--pf-accent); margin-bottom: 6px;
    }
    .pf-sys-text {
      background: rgba(9,9,15,0.6); border: 1px solid var(--pf-border);
      border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.5;
      color: var(--pf-text-primary); white-space: pre-wrap; word-break: break-word;
      outline: none; cursor: text; caret-color: var(--pf-accent); min-height: 40px;
      font-family: var(--pf-font-mono);
    }
    .pf-sys-text:focus { outline: 1px solid var(--pf-border-focus); border-radius: 8px; }
    .pf-sys-copy {
      margin-top: 8px; display: block; background: none;
      border: 1px solid var(--pf-border); border-radius: var(--pf-radius-btn);
      color: var(--pf-text-secondary); font-size: 11px; font-weight: 600; font-family: inherit;
      padding: 6px 14px; cursor: pointer; transition: background var(--pf-transition), color var(--pf-transition);
    }
    .pf-sys-copy:hover { background: var(--pf-bg-surface-hover); color: var(--pf-text-primary); }

    /* ── Guided questions panel ──────────────────────────────────────────── */
    #pf-questions {
      position: fixed;
      bottom: 136px;
      right: 20px;
      width: 380px;
      max-width: calc(100vw - 40px);
      background: var(--pf-bg-panel);
      border: 1px solid var(--pf-border);
      border-top: 2px solid var(--pf-accent);
      border-radius: var(--pf-radius-panel);
      font-family: var(--pf-font-sans);
      color: var(--pf-text-primary);
      box-shadow: var(--pf-shadow-panel);
      z-index: 2147483647;
      padding: 16px;
      overflow: hidden;
    }
    .pf-question-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--pf-text-primary);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    #pf-questions-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 14px;
    }
    #pf-questions-skip    { background: var(--pf-bg-surface-hover); color: var(--pf-text-secondary); border: 1px solid var(--pf-border); }
    #pf-questions-skip:hover { background: rgba(255,255,255,0.08); }
    #pf-questions-submit  { background: var(--pf-accent); color: #fff; box-shadow: 0 2px 8px var(--pf-accent-glow); }
    #pf-questions-submit:hover { box-shadow: 0 4px 16px rgba(139,92,246,0.4); }
    .pf-intent-subtitle {
      font-size: 12px; color: var(--pf-text-secondary); line-height: 1.45; margin-bottom: 10px;
    }
    .pf-intent-input {
      width: 100%; background: rgba(9,9,15,0.6);
      border: 1px solid var(--pf-border); border-radius: var(--pf-radius-btn);
      padding: 10px 12px; color: var(--pf-text-primary); font-size: 12px; font-family: inherit;
      outline: none; box-sizing: border-box; resize: vertical;
      min-height: 80px; line-height: 1.5; transition: border-color var(--pf-transition);
    }
    .pf-intent-input:focus { border-color: var(--pf-border-focus); }
    .pf-intent-input::placeholder { color: rgba(148,163,184,0.35); font-style: italic; }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = 'pf-styles';
  document.head.appendChild(styleEl);
  styleEl.textContent = CSS;

  /* ── Toast ────────────────────────────────────────────────────────────── */

  let toastEl = null;
  let toastTimer = null;
  const activeMode = 'auto';
  let pfEngine = 'claude'; // default to Claude on claude.ai — it's the best model for the job

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
    btn.style.padding = '0 10px';
    btn.style.fontSize = '11px';
    btn.style.whiteSpace = 'nowrap';
    btn.style.animation = 'pf-pulse 1.5s ease-in-out infinite';
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
    btn.style.animation = '';
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

  /* ── Structural DOM fallback for conversation scraping ─────────────────── */
  // When CSS selectors all fail (Claude.ai redesign), walk the DOM tree to find
  // the conversation container and extract messages by structural patterns.

  function scrapeConversationStructural() {

    // Strategy 1: Find the main scrollable conversation area.
    // Claude.ai typically has a main chat area with child elements for each message.
    // Look for a scrollable container with multiple large text-containing children.
    const candidates = document.querySelectorAll('main, [role="main"], [role="log"], [class*="conversation"], [class*="chat-messages"], [class*="message-list"], [class*="thread"]');

    for (const container of candidates) {
      // Find direct children or close descendants that look like message blocks
      const blocks = [...container.querySelectorAll(':scope > div, :scope > div > div, :scope > article, [role="article"]')]
        .filter(el => {
          const text = (el.textContent || '').trim();
          // Message blocks are typically 20+ chars and not huge wrapper elements
          return text.length > 20 && text.length < 50000 &&
            el.children.length < 50 && // not a huge wrapper
            !el.closest('#pf-diff, #pf-questions, nav, header, footer, aside');
        });

      if (blocks.length >= 2) {
        pfLog(`[structural] Found ${blocks.length} potential message blocks in`, container.tagName, container.className?.slice(0, 60));

        // Classify: in Claude.ai, messages alternate human/assistant.
        // Human messages are typically shorter and don't contain code blocks.
        // Assistant messages often have markdown formatting, code, lists.
        const humanEls = [];
        const assistantEls = [];

        // Check if blocks have any distinguishing attributes
        const hasRoleAttr = blocks.some(b =>
          b.getAttribute('data-role') || b.getAttribute('data-message-author-role') ||
          b.getAttribute('data-type') || b.className?.match(/human|user|assistant|ai|bot|claude/i)
        );

        if (hasRoleAttr) {
          // Use attributes to classify
          for (const block of blocks) {
            const attrs = `${block.getAttribute('data-role') || ''} ${block.getAttribute('data-message-author-role') || ''} ${block.getAttribute('data-type') || ''} ${block.className || ''}`.toLowerCase();
            if (attrs.match(/human|user/)) humanEls.push(block);
            else if (attrs.match(/assistant|ai|bot|claude|model|response/)) assistantEls.push(block);
          }
        }

        if (humanEls.length === 0 && assistantEls.length === 0) {
          // Fallback: assume alternating pattern (human first, then assistant, etc.)
          // This is the standard Claude.ai pattern
          for (let i = 0; i < blocks.length; i++) {
            if (i % 2 === 0) humanEls.push(blocks[i]);
            else assistantEls.push(blocks[i]);
          }
        }

        if (humanEls.length > 0 || assistantEls.length > 0) {
          return { humanEls, assistantEls, method: 'structural-dom-walk' };
        }
      }
    }

    // Strategy 2: Look for any element with role="article" — common for chat messages
    const articles = [...document.querySelectorAll('[role="article"]')]
      .filter(el => !el.closest('#pf-diff, #pf-questions, nav, header, footer'));
    if (articles.length >= 2) {
      const humanEls = [];
      const assistantEls = [];
      for (let i = 0; i < articles.length; i++) {
        if (i % 2 === 0) humanEls.push(articles[i]);
        else assistantEls.push(articles[i]);
      }
      return { humanEls, assistantEls, method: 'role-article-walk' };
    }

    return null;
  }

  /* ── Scrape visible conversation for context ──────────────────────────── */

  function scrapeConversation() {

    // ── Platform-specific selectors — each role finds its best match independently
    const HUMAN_SELS = PLATFORM === 'gemini' ? [
      'user-query-text',
      '.query-text',
      'user-query .query-content',
      '[class*="user-query"]',
      '[data-message-author-role="user"]',
    ] : [
      // ── VERIFIED on Claude.ai March 2026 ──
      // Human messages have class "font-user-message" and data-testid="user-message"
      '.font-user-message',
      '[class*="font-user-message"]',
      '[data-testid="user-message"]',
      '[class*="user-message"]',
      // Fallback: older/future selectors
      '[data-testid="human-turn"]',
      '[data-testid="user-turn"]',
      '[data-message-author-role="user"]',
      '[data-role="user"]',
      '[class*="HumanTurn"]',
      '[class*="human-turn"]',
      '[class*="UserMessage"]',
      '[class*="humanMessage"]',
      '[class*="userTurn"]',
      // ARIA fallback
      '[aria-label*="You said" i]',
      '[aria-label*="Your message" i]',
    ];

    const ASSISTANT_SELS = PLATFORM === 'gemini' ? [
      'model-response-text',
      '.model-response-text',
      'message-content .markdown',
      '[class*="model-response"]',
      '[data-message-author-role="model"]',
      '.response-container .markdown',
    ] : [
      // ── VERIFIED on Claude.ai March 2026 ──
      // Assistant messages have class "font-claude-response"
      '.font-claude-response',
      '[class*="font-claude-response"]',
      '[class*="claude-response"]',
      // Fallback: older class name and future variants
      '.font-claude-message',
      '[class*="claude-message"]',
      '[class*="claude-answer"]',
      // Data attribute fallbacks
      '[data-testid="ai-turn"]',
      '[data-testid="assistant-turn"]',
      '[data-testid="assistant-message"]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      // Class substring fallbacks
      '[class*="AssistantMessage"]',
      '[class*="assistant-message"]',
      '[class*="assistantMessage"]',
      '[class*="AiTurn"]',
      '[class*="ai-turn"]',
      // ARIA fallback
      '[aria-label*="Claude" i]',
      '[aria-label*="Assistant" i]',
    ];

    const firstMatch = (sels) => {
      for (const sel of sels) {
        try {
          const raw = [...document.querySelectorAll(sel)];
          if (raw.length === 0) continue;
          // Filter to outermost elements only — if a matched element is nested
          // inside another matched element, drop the inner one. This prevents
          // counting every paragraph inside a Claude response as a separate turn.
          const els = raw.filter(el => !raw.some(other => other !== el && other.contains(el)));
          if (els.length > 0) return { els, sel };
        } catch { /* invalid selector — skip */ }
      }
      return { els: [], sel: null };
    };

    let { els: humanEls,     sel: humanSel     } = firstMatch(HUMAN_SELS);
    let { els: assistantEls, sel: assistantSel } = firstMatch(ASSISTANT_SELS);

    // ── Always log both counts so mismatches are immediately visible ───────
    pfLog('[scrape]',
      `Human: ${humanEls.length} via ${humanSel || '(no match)'}  |  ` +
      `Assistant: ${assistantEls.length} via ${assistantSel || '(no match)'}`
    );

    // ── Structural fallback: walk the DOM conversation container ────────────
    // When CSS selectors fail (Claude.ai redesign), find the main message list
    // and classify children by position/content patterns.
    if (humanEls.length === 0 && assistantEls.length === 0) {
      console.warn('[PromptForge scrape]', `No turns found via selectors (platform: ${PLATFORM}). Trying structural fallback...`);

      // Log available data-testid values for debugging
      const testIds = [...new Set(
        [...document.querySelectorAll('[data-testid]')]
          .map(el => el.getAttribute('data-testid'))
      )].sort();
      console.info('[PromptForge scrape]', 'data-testid values in DOM:', testIds);

      // Strategy A: find conversation container and extract alternating messages
      const structuralResult = scrapeConversationStructural();
      if (structuralResult) {
        humanEls = structuralResult.humanEls;
        assistantEls = structuralResult.assistantEls;
        humanSel = structuralResult.method;
        assistantSel = structuralResult.method;
        pfLog('[scrape]', `Structural fallback recovered ${humanEls.length} human + ${assistantEls.length} assistant turns via ${structuralResult.method}`);
      }
    }

    // ── Broad text-block fallback (last resort) ──────────────────────────────
    if (humanEls.length === 0 && assistantEls.length === 0) {
      const BROAD_SELS = [
        '[class*="markdown"]:not(#pf-diff *):not(#pf-questions *)',
        '[class*="prose"]:not(#pf-diff *):not(#pf-questions *)',
        '[class*="message"]:not(#pf-diff *):not(#pf-questions *):not(input):not(textarea)',
        '[class*="response"]:not(#pf-diff *):not(#pf-questions *)',
        '[class*="content"]:not(#pf-diff *):not(#pf-questions *):not(script):not(style)',
        '[class*="assistant"]:not(#pf-diff *)',
        '[class*="claude"]:not(#pf-diff *)',
      ];
      let broadLastMsg = null;
      for (const sel of BROAD_SELS) {
        try {
          const els = [...document.querySelectorAll(sel)]
            .filter(el => {
              const text = (el.textContent || '').trim();
              return text.length > 100 && text.length < 50000 && !el.closest('#pf-diff, #pf-questions');
            });
          if (els.length > 0) {
            broadLastMsg = (els[els.length - 1].textContent || '').trim().slice(0, 3000);
            pfLog('[scrape]', `Broad fallback: recovered last response (${broadLastMsg.length} chars) via "${sel}"`);
            break;
          }
        } catch { /* invalid selector — skip */ }
      }
      if (!broadLastMsg) console.warn('[PromptForge scrape]', 'All fallbacks failed — pipeline will run without context.');
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
      pfLog('[scrape]', `Last assistant message (${lastAssistantMessage.length} chars):`, lastAssistantMessage.slice(0, 120) + '…');

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
    pfLog('[scrape]', `Sending ${final.length} turns as context:`);
    final.forEach((t, i) =>
      pfLog('[scrape]', `  [${i}] ${t.role}: ${t.content.slice(0, 80)}…`)
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

  /* ── Before/after diff panel ───────────────────────────────────────────── */

  function showDiff(original, optimized, editor, sources, rationale = '') {
    pfLog('Modal AFTER text:', optimized);
    document.getElementById('pf-diff')?.remove();

    const panel = document.createElement('div');
    panel.id = 'pf-diff';

    // Header
    const header = document.createElement('div');
    header.id = 'pf-diff-header';
    const title = document.createElement('span');
    title.textContent = '⚡ Prompt Forge — Optimized';
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

      // Save the accepted prompt so future searches can reference what worked
      safeRuntime(() => chrome.runtime.sendMessage({
        type: 'SAVE_ACCEPTED_PROMPT',
        payload: { prompt: finalText },
      })).catch(() => {});

      setEditorText(editor, finalText);
      const byLine = sources.length > 0
        ? `<br><small style="opacity:0.75">patterns from: ${sources.join(', ')}</small>`
        : '';
      toast(`⚡ Prompt optimized${byLine}`, 'success', 4500);
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
    pfLog('handleOptimize — activeMode:', activeMode, '— platform:', PLATFORM);
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

    // Load engine preference
    try {
      const s = await safeRuntime(() => chrome.storage.local.get('pfEngine'));
      if (s?.pfEngine) pfEngine = s.pfEngine;
    } catch {}

    // ── Too vague to optimize? (only for standalone prompts with no chat) ──
    const { turns: chatHistory, lastAssistantMessage } = scrapeConversation();
    const hasContext = chatHistory.length > 0 || !!lastAssistantMessage;

    const meaningfulWords = raw.replace(/[^\w\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !['help','please','want','need','just','some','the','and',
        'for','with','about','this','that','what','how','can','you','your','like','get',
        'make','give','tell','show','its','has','was','are','been','have','very','really',
        'but','not','out','more','any','all'].includes(w.toLowerCase()));

    if (meaningfulWords.length < 2 && !hasContext) {
      toast('Add more detail — what specifically do you need help with?', 'info', 4000);
      return;
    }

    // ── Claude self-optimize (default) ──────────────────────────────────────
    if (pfEngine === 'claude') {
      runClaudeOptimize(raw, editor);
      return;
    }

    // ── Groq pipeline (fallback) ────────────────────────────────────────────
    let key;
    try {
      const stored = await safeRuntime(() => chrome.storage.sync.get('groqApiKey'));
      if (!stored) return;
      key = stored.groqApiKey;
    } catch {
      key = null;
    }

    if (!key) {
      toast(
        'No Groq API key set. Switch to Claude engine in Settings, or add a Groq key. ' +
        '<button class="pf-link" id="pf-open-opts">Settings →</button>',
        'error', 8000
      );
      document.getElementById('pf-open-opts')?.addEventListener('click', () => {
        safeRuntime(() => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
      });
      return;
    }

    const isVague = raw.trim().length < 50 || /^(help|teach|explain|show|tell|make|fix|do|how|what)\s/i.test(raw.trim());
    if (isVague && !hasContext) {
      showIntentPanel((answers) => {
        runPipeline(raw, chatHistory, lastAssistantMessage, answers, editor);
      });
      return;
    }

    runPipeline(raw, chatHistory, lastAssistantMessage, [], editor);
  }

  /* ── Claude API optimize flow ──────────────────────────────────────────── */
  // Calls the Anthropic API via the background service worker.
  // No chat pollution — runs entirely in the background.

  async function runClaudeOptimize(originalPrompt, editor) {
    const btn = document.getElementById('pf-optimize-btn');
    setLoadingLabel(btn, '⚡ Claude...');

    const { turns: chatHistory, lastAssistantMessage } = scrapeConversation();

    try {
      const res = await safeRuntime(() => chrome.runtime.sendMessage({
        type: 'OPTIMIZE_WITH_CLAUDE',
        payload: { prompt: originalPrompt, chatHistory, lastAssistantMessage },
      }));

      if (!res) return;

      if (!res.success) {
        if (res.error === 'NO_API_KEY') {
          toast(
            'No Anthropic API key set. ' +
            '<button class="pf-link" id="pf-open-opts">Open Settings →</button>',
            'error', 8000
          );
          document.getElementById('pf-open-opts')?.addEventListener('click', () => {
            safeRuntime(() => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
          });
          return;
        }
        throw new Error(res.error);
      }

      const sources = (res.data.inspiredBy || []).filter(Boolean);
      showDiff(originalPrompt, res.data.optimized, editor, sources, '');
    } catch (err) {
      const msg = String(err?.message || err).replace(/^Error:\s*/i, '');
      toast(`${msg}`, 'error', 6000);
    } finally {
      restoreButton(btn);
    }
  }

  /* ── Pipeline runner (called directly or after guided questions) ───────── */

  async function runPipeline(raw, chatHistory, lastAssistantMessage, answers, editor) {
    const btn = document.getElementById('pf-optimize-btn');
    setLoadingLabel(btn, '⚡ Pruning...');

    pfLog('Optimizing with context:',
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

  /* ── Inject the fixed-position button ──────────────────────────────────── */

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
      'Type your prompt, then click ⚡ to optimize it using proven patterns from multiple sources');
    btn.style.cssText = [
      'position:fixed',
      'bottom:90px',
      'right:80px',
      'z-index:9999',
      'background:#8b5cf6',
      'color:#fff',
      'border:none',
      'border-radius:50%',
      'width:36px',
      'height:36px',
      'font-size:16px',
      'cursor:pointer',
      'box-shadow:0 4px 12px rgba(139,92,246,0.3)',
      'transition:opacity 0.15s ease,transform 0.15s ease,box-shadow 0.15s ease',
    ].join(';');

    document.body.appendChild(btn);
    btn.addEventListener('click', handleOptimize);
  }

  /* ── Retry loop: poll until the editor exists, then inject once ────────── */

  function tryInject() {
    // Remove any stale button from a previous chat
    document.getElementById('pf-optimize-btn')?.remove();

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

  // Load engine preference
  safeRuntime(() =>
    chrome.storage.local.get('pfEngine').then(s => {
      if (s.pfEngine) pfEngine = s.pfEngine;
    }).catch(() => {})
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
