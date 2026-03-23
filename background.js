// Prompt Forge — background.js
// Service worker: handles all API calls (prompts.chat + Groq).
// Runs in the background context where cross-origin fetch is unrestricted (via host_permissions).

'use strict';

const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[PromptForge]', ...args); };

const API_BASE      = 'https://prompts.chat/api';
const GROQ_API      = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Pipeline models
const GROQ_PRUNER_MODEL    = 'llama-3.1-8b-instant';   // Trajectory, strategy doc, system prompt gen
const GROQ_OPTIMIZER_MODEL = 'llama-3.3-70b-versatile'; // Main optimizer

/* ── Curated prompt library (local + remote updates) ───────────────────── */
// Loads from prompts-library.json bundled with the extension.
// Also checks a remote URL for updates (e.g., GitHub raw) every 24 hours.
// Remote prompts are cached in chrome.storage.local.

let _curatedLibrary = null;
let _curatedLibraryLoaded = false;
const CURATED_CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

async function loadCuratedLibrary() {
  if (_curatedLibrary && _curatedLibraryLoaded) return _curatedLibrary;

  // Try cached remote version first
  try {
    const { pfCuratedPrompts, pfCuratedTimestamp } = await chrome.storage.local.get(['pfCuratedPrompts', 'pfCuratedTimestamp']);
    if (pfCuratedPrompts && pfCuratedTimestamp && Date.now() - pfCuratedTimestamp < CURATED_CACHE_TTL) {
      _curatedLibrary = pfCuratedPrompts;
      _curatedLibraryLoaded = true;
      log('Curated library loaded from cache:', _curatedLibrary.length, 'prompts');
      return _curatedLibrary;
    }
  } catch {}

  // Load local bundled file
  try {
    const localUrl = chrome.runtime.getURL('prompts-library.json');
    const res = await fetch(localUrl);
    if (res.ok) {
      const data = await res.json();
      _curatedLibrary = data.prompts || [];
      _curatedLibraryLoaded = true;
      log('Curated library loaded from bundle:', _curatedLibrary.length, 'prompts');
    }
  } catch (err) {
    console.warn('[PromptForge] Failed to load local curated library:', err.message);
    _curatedLibrary = [];
    _curatedLibraryLoaded = true;
  }

  // Try remote update in the background (non-blocking)
  fetchRemoteCuratedLibrary().catch(() => {});

  return _curatedLibrary;
}

async function fetchRemoteCuratedLibrary() {
  // Check if a remote URL is configured
  const { pfCuratedRemoteUrl } = await chrome.storage.local.get('pfCuratedRemoteUrl');
  if (!pfCuratedRemoteUrl) return;

  try {
    const res = await fetch(pfCuratedRemoteUrl, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    const prompts = data.prompts || [];
    if (prompts.length > 0) {
      await chrome.storage.local.set({ pfCuratedPrompts: prompts, pfCuratedTimestamp: Date.now() });
      _curatedLibrary = prompts;
      log('Curated library updated from remote:', prompts.length, 'prompts');
    }
  } catch {}
}

// Search curated library by domain + keywords
function searchCuratedLibrary(query, domain, limit = 3) {
  if (!_curatedLibrary || _curatedLibrary.length === 0) return [];
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  return _curatedLibrary
    .map(p => {
      let score = 0;
      if (domain && p.domain === domain) score += 5;
      const text = `${p.title} ${p.prompt} ${p.why || ''}`.toLowerCase();
      score += queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return score > 0 ? { ...p, _score: score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/* ── Built-in fallback patterns (used when curated library unavailable) ── */

const PROVEN_PATTERNS = [
  {
    id: 'pp-1', title: 'Expert Code Reviewer',
    content: '<role>senior eng|code review+security+perf</role>\n<ctx>code review|severity ranked|exact fixes required</ctx>\n<task>\n- scan for bugs, security holes, perf issues\n- rank by severity: CRITICAL>HIGH>MED>LOW\n- per issue: problem→impact→exact fix(code)\n</task>\n<rules>\nMUST: show working code fix\nMUST: explain WHY it\'s a problem not just WHAT\nNEVER: say "looks good" without evidence\nNEVER: suggest cosmetic changes before fixing bugs\n</rules>\n<fmt>numbered|[severity]→issue→impact→fix</fmt>',
    category: 'coding',
  },
  {
    id: 'pp-2', title: 'Chain-of-Thought Reasoning',
    content: '<role>analytical reasoning specialist</role>\n<ctx>complex question requiring multi-step reasoning</ctx>\n<task>\n- state all assumptions first\n- reason through numbered steps (show work)\n- identify edge cases at each step\n- verify conclusion against assumptions\n- state confidence + what would change answer\n</task>\n<rules>\nMUST: show every reasoning step\nMUST: flag uncertainty explicitly\nNEVER: jump to conclusion\nNEVER: hide assumptions\n</rules>\n<fmt>steps→verification→conclusion(confidence%)</fmt>',
    category: 'reasoning',
  },
  {
    id: 'pp-3', title: 'Concise Technical Writer',
    content: '<role>technical writer|API docs+developer guides</role>\n<ctx>documentation|audience=developers|clarity>completeness</ctx>\n<task>\n- explain concept in 1 sentence\n- show minimal working example\n- list 3 common pitfalls\n</task>\n<rules>\nMUST: lead with working code example\nMUST: every sentence adds information\nNEVER: use filler phrases ("In this section we will...")\nNEVER: explain obvious code line-by-line\n</rules>\n<fmt>sentence→code_block→pitfalls_list</fmt>',
    category: 'writing',
  },
  {
    id: 'pp-4', title: 'Data Insight Extractor',
    content: '<role>data analyst|BI+statistical analysis</role>\n<ctx>dataset analysis|extract actionable insights|numbers required</ctx>\n<task>\n- identify top 3 patterns by business impact\n- per pattern: insight+supporting numbers+one action\n- flag data quality issues found\n</task>\n<rules>\nMUST: cite specific numbers from data\nMUST: tie every insight to an action\nNEVER: state obvious trends without adding insight\nNEVER: recommend without data evidence\n</rules>\n<fmt>pattern→numbers→insight→action</fmt>',
    category: 'analysis',
  },
  {
    id: 'pp-5', title: 'Socratic Teacher',
    content: '<role>educator|adaptive explanation+scaffolded learning</role>\n<ctx>concept explanation|gauge understanding first|build on learner knowledge</ctx>\n<task>\n- ask ONE diagnostic question to gauge level\n- explain at right level based on response\n- use concrete analogy from learner domain\n- end with comprehension check\n</task>\n<rules>\nMUST: adapt complexity to demonstrated understanding\nMUST: use domain-specific analogies not generic\nNEVER: lecture without checking comprehension\nNEVER: use jargon without defining first\n</rules>\n<fmt>question→explanation(adapted)→analogy→check</fmt>',
    category: 'education',
  },
  {
    id: 'pp-6', title: 'Creative Reframer',
    content: '<role>creative director|lateral thinking+reframing</role>\n<ctx>creative task|novelty>convention|surprise the reader</ctx>\n<task>\n- identify the conventional approach\n- deliberately break one assumption\n- rebuild from the broken assumption\n- explain why unconventional angle works better\n</task>\n<rules>\nMUST: name the assumption being broken\nMUST: result must be more effective not just different\nNEVER: be weird for weirdness sake\nNEVER: use clichéd creative framings\n</rules>\n<fmt>conventional→broken_assumption→rebuilt→why_better</fmt>',
    category: 'creative',
  },
  {
    id: 'pp-7', title: 'Decision Framework Builder',
    content: '<role>strategy consultant|decision analysis+trade-off evaluation</role>\n<ctx>decision with multiple options|structured comparison|risk-aware</ctx>\n<task>\n- define evaluation criteria (max 5)\n- score each option against criteria\n- identify deal-breakers and hidden risks\n- recommend with stated assumptions\n</task>\n<rules>\nMUST: make trade-offs explicit not hidden\nMUST: state what would change the recommendation\nNEVER: recommend without showing trade-offs\nNEVER: present one option as obviously best without evidence\n</rules>\n<fmt>criteria_matrix→risks→recommendation(assumptions)</fmt>',
    category: 'business',
  },
  {
    id: 'pp-8', title: 'Debugging Systematizer',
    content: '<role>senior debugger|root cause analysis+systematic elimination</role>\n<ctx>bug report|systematic diagnosis|exact reproduction required</ctx>\n<task>\n- form 3 hypotheses ranked by likelihood\n- per hypothesis: test to confirm/eliminate (exact command/code)\n- narrow to root cause through elimination\n- provide exact fix with verification step\n</task>\n<rules>\nMUST: test hypotheses in order of likelihood\nMUST: provide exact commands not vague "check the logs"\nNEVER: suggest random fixes without diagnosis\nNEVER: skip reproduction step\n</rules>\n<fmt>hypotheses→tests→elimination→root_cause→fix→verify</fmt>',
    category: 'coding',
  },
];

/* ── Normalise prompt objects from different API shapes ── */

function normalizePrompt(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const content =
    raw.prompt       ||
    raw.content      ||
    raw.text         ||
    raw.description  ||
    raw.body         ||
    '';

  if (!content || content.length < 10) return null;

  return {
    id:       raw.id || raw._id || raw.slug || crypto.randomUUID(),
    title:    raw.title || raw.act || raw.name || raw.heading || 'Prompt',
    content:  content.trim(),
    category: raw.category || (Array.isArray(raw.tags) ? raw.tags[0] : '') || '',
    url:      raw.url || raw.link || null,
  };
}

/* ── REST endpoint  GET /api/prompts?q=…&perPage=N ───── */

async function searchPromptsREST(query, perPage = 8) {
  const url = `${API_BASE}/prompts?q=${encodeURIComponent(query)}&perPage=${perPage}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`prompts.chat REST API responded with ${res.status}`);
  }

  const data = await res.json();

  // Accept a bare array or a wrapper object
  if (Array.isArray(data))               return data;
  if (Array.isArray(data.data))          return data.data;
  if (Array.isArray(data.prompts))       return data.prompts;
  if (Array.isArray(data.results))       return data.results;
  if (Array.isArray(data.items))         return data.items;

  // Last resort: try top-level values
  const firstArray = Object.values(data).find(v => Array.isArray(v));
  return firstArray || [];
}

/* ── MCP endpoint  POST /api/mcp ─────────────────────── */

async function searchPromptsMCP(query, limit = 5) {
  const res = await fetch(`${API_BASE}/mcp`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept:          'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'tools/call',
      params:  {
        name:      'search_prompts',
        arguments: { query, limit },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`prompts.chat MCP endpoint responded with ${res.status}`);
  }

  const envelope = await res.json();

  if (envelope.error) {
    throw new Error(envelope.error.message || 'MCP error');
  }

  const result = envelope.result;
  if (!result) return [];

  // Shape 1: result is already an array
  if (Array.isArray(result))               return result;

  // Shape 2: result.prompts / result.results
  if (Array.isArray(result.prompts))       return result.prompts;
  if (Array.isArray(result.results))       return result.results;

  // Shape 3: MCP tools/call → result.content[].text (JSON string)
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        try {
          const parsed = JSON.parse(part.text);
          if (Array.isArray(parsed))                 return parsed;
          if (Array.isArray(parsed.prompts))         return parsed.prompts;
          if (Array.isArray(parsed.results))         return parsed.results;
          // Single object
          if (parsed && typeof parsed === 'object')  return [parsed];
        } catch {
          // Not JSON — ignore
        }
      }
    }
  }

  return [];
}

/* ── GitHub awesome-chatgpt-prompts source ─────────── */

let _ghPromptsCache = null;
let _ghPromptsCacheTime = 0;
const GH_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours — the CSV rarely changes

async function searchPromptsGitHub(query, limit = 5) {
  const CSV_URL = 'https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv';

  // Use cached data if fresh
  if (_ghPromptsCache && Date.now() - _ghPromptsCacheTime < GH_CACHE_TTL) {
    return matchGitHubPrompts(_ghPromptsCache, query, limit);
  }

  const res = await fetch(CSV_URL, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);

  const csv = await res.text();
  const parsed = parseCSV(csv);

  _ghPromptsCache = parsed;
  _ghPromptsCacheTime = Date.now();
  log(`GitHub prompts cached: ${parsed.length} entries`);

  return matchGitHubPrompts(parsed, query, limit);
}

// Proper CSV parser that handles multi-line quoted fields, escaped quotes (""), and mixed quoting.
// Extracts columns 0 (act/title) and 1 (prompt/content) from the awesome-chatgpt-prompts CSV.
function parseCSV(csv) {
  const results = [];
  const len = csv.length;
  let i = 0;

  // Skip header line
  while (i < len && csv[i] !== '\n') i++;
  i++; // past '\n'

  while (i < len) {
    const row = [];
    // Parse up to 2 columns (we only need act + prompt), skip the rest of the line
    for (let col = 0; col < 2 && i < len; col++) {
      if (col > 0) {
        if (i < len && csv[i] === ',') i++; // skip comma between fields
        else break;
      }
      if (csv[i] === '"') {
        // Quoted field — handles multi-line content and escaped quotes ("")
        i++; // skip opening quote
        let val = '';
        while (i < len) {
          if (csv[i] === '"') {
            if (i + 1 < len && csv[i + 1] === '"') {
              val += '"'; // escaped quote
              i += 2;
            } else {
              i++; // closing quote
              break;
            }
          } else {
            val += csv[i];
            i++;
          }
        }
        row.push(val);
      } else {
        // Unquoted field — read until comma or newline
        let val = '';
        while (i < len && csv[i] !== ',' && csv[i] !== '\n' && csv[i] !== '\r') {
          val += csv[i];
          i++;
        }
        row.push(val);
      }
    }
    // Skip remaining columns until end of line
    // Handle quoted fields in remaining columns so we don't break on embedded newlines
    while (i < len && csv[i] !== '\n') {
      if (csv[i] === '"') {
        i++; // skip opening quote
        while (i < len) {
          if (csv[i] === '"') {
            if (i + 1 < len && csv[i + 1] === '"') { i += 2; }
            else { i++; break; }
          } else { i++; }
        }
      } else {
        i++;
      }
    }
    if (i < len && csv[i] === '\n') i++;

    const [title, content] = row;
    if (title && content && content.length >= 20) {
      results.push({ title: title.trim(), content: content.trim() });
    }
  }
  return results;
}

function matchGitHubPrompts(prompts, query, limit) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  return prompts
    .map(p => {
      const text = `${p.title} ${p.content}`.toLowerCase();
      const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return score > 0 ? { ...p, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(p => ({
      id: `gh-${p.title.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}`,
      title: p.title,
      content: p.content.trim(),
      category: '',
      url: null,
    }));
}

/* ── Match built-in proven patterns by domain/keywords ── */

function matchProvenPatterns(query, domain, limit = 3) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  // Score by: domain match (weight 3) + keyword match (weight 1)
  return PROVEN_PATTERNS
    .map(p => {
      let score = 0;
      if (domain && p.category && p.category.includes(domain)) score += 3;
      const text = `${p.title} ${p.content}`.toLowerCase();
      score += queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return score > 0 ? { ...p, _score: score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/* ── Deduplicate by content fingerprint ─────────────── */

function dedup(prompts) {
  const seen = new Set();
  return prompts.filter(p => {
    const text = p.content || p.prompt || '';
    if (!text) return false;
    const key = text.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Keyword extraction for prompts.chat search ─────── */

// Pull 3-5 high-signal words from the user's prompt + most recent chat turn.
// These become the search query so prompts.chat returns topically relevant results.
function extractKeywords(prompt, chatHistory) {
  const STOP = new Set([
    'a','an','the','is','are','was','were','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'must','can','i','me','my','we','our','you','your','he','she','it','its',
    'they','them','their','this','that','these','those','and','but','or','so',
    'if','in','on','at','to','for','of','with','by','from','into','about',
    'what','how','why','when','where','who','which','just','also','help',
    'make','fix','me','please','like','get','let','use','want','need','give',
    'tell','show','write','create','add','more','better','good','some','any',
    'very','really','quite','then','now','up','out','all','new','can',
  ]);

  // Weight the user's own prompt heavier than context
  const text = [
    prompt, prompt, prompt,
    ...chatHistory.slice(-2).map(t => t.content),
  ].join(' ');

  const freq = {};
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w))
    .forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  const keywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w)
    .join(' ');

  log('Extracted keywords for prompts.chat search:', keywords);
  return keywords || prompt.slice(0, 60); // never send an empty query
}

/* ── Pattern analysis of prompts.chat results ───────── */

// Inspect the top fetched prompts and return notes about structural patterns
// they share — these notes go straight into the Groq system prompt.
function analyzePatterns(prompts) {
  const all = prompts.map(p => p.content);
  const match = (re) => all.some(c => re.test(c));
  const countMatch = (re) => all.filter(c => re.test(c)).length;

  const notes = [];

  // Core structural patterns
  if (match(/\byou are\b|\bact as\b|\byour role is\b|<role>/i))
    notes.push('role assignment');
  if (match(/\bformat\b|\brespond in\b|\boutput\b|\bstructured\b|\blist\b|<fmt>/i))
    notes.push('structured output format');
  if (match(/\brules?:\b|\bconstraints?:\b|\bdo not\b|\bmust not\b|\balways\b|\bMUST:\b|\bNEVER:\b|<rules>/i))
    notes.push('explicit MUST/NEVER constraints');
  if (match(/\{[^}]+\}|\[YOUR [A-Z]/))
    notes.push('placeholder variables');
  if (match(/\bstep[- ]by[- ]step\b|\bfirst[,.]?\s+then\b/i))
    notes.push('step-by-step instructions');
  if (match(/\bexample[s:]|\bfor instance\b|\be\.g\.\b|<ideal>|<wrong>/i))
    notes.push('positive+negative examples');
  if (match(/<role>|<ctx>|<task>|<rules>|<fmt>/i))
    notes.push('XML-structured tags');

  // Proven technique detection — stronger signals from community-validated patterns
  const rolePlayCount = countMatch(/\byou are\b|\bact as\b|\byou will (?:act|serve|function) as\b|\bassume the role\b/i);
  if (rolePlayCount >= 2)
    notes.push(`STRONG: role-play framing (${rolePlayCount}/${all.length} references use "You are"/"Act as" — adopt this technique)`);

  if (match(/\b\d+\.\s|(?:rule|constraint|requirement)\s*(?:#|\d)/i))
    notes.push('STRONG: numbered constraints (proven to reduce instruction-skipping)');

  const exampleCount = countMatch(/\b(?:input|output)\s*[:=]|\b(?:example|sample)\s*(?:input|output|response)\b|<in>.*<\/in>|<ideal>|user:\s.*\nassistant:/i);
  if (exampleCount >= 1)
    notes.push(`STRONG: input/output examples within prompt (${exampleCount}/${all.length} references include them — highly effective)`);

  if (match(/\b(?:expert|senior|experienced|professional|specialist|10\+?\s*years?|veteran)\b.*?\b(?:in|with|at)\b/i))
    notes.push('STRONG: persona with explicit expertise level (proven to improve response quality)');

  const avgLen = Math.round(all.reduce((s, c) => s + c.length, 0) / all.length);
  notes.push(`~${avgLen}-char length`);

  return notes;
}

/* ── Main orchestration ──────────────────────────────── */

async function handleOptimize({ prompt, category }) {
  // Build the search query (category prefix helps relevance)
  const query = [category, prompt].filter(Boolean).join(' ');

  // Fire all sources in parallel; treat each as optional
  const [restSettled, mcpSettled, ghSettled] = await Promise.allSettled([
    searchPromptsREST(query, 12),
    searchPromptsMCP(query, 5),
    searchPromptsGitHub(query, 8),
  ]);

  let raw = [];

  const fromREST    = restSettled.status === 'fulfilled';
  const fromMCP     = mcpSettled.status  === 'fulfilled';
  const fromGitHub  = ghSettled.status   === 'fulfilled' && ghSettled.value.length > 0;

  if (fromREST)   raw.push(...restSettled.value);
  if (fromMCP)    raw.push(...mcpSettled.value);
  if (fromGitHub) raw.push(...ghSettled.value);

  // Always include relevant built-in proven patterns
  const builtIn = matchProvenPatterns(query, category, 2);
  const fromBuiltIn = builtIn.length > 0;
  if (fromBuiltIn) raw.push(...builtIn);

  // If category narrowed things too much, broaden to plain prompt
  if (category && raw.length < 3) {
    try {
      const broader = await searchPromptsREST(prompt, 5);
      raw.push(...broader);
    } catch {
      // Best-effort fallback — ignore
    }
  }

  // Normalise → filter empties → deduplicate
  const prompts = dedup(
    raw
      .map(normalizePrompt)
      .filter(Boolean)
  );

  if (prompts.length === 0) {
    const apiNote = (!fromREST && !fromMCP && !fromGitHub)
      ? ' (APIs may be unreachable — check your internet connection)'
      : '';
    throw new Error(
      `No relevant prompts found for "${prompt.slice(0, 40)}".${apiNote} ` +
      'Try different keywords or remove the category filter.'
    );
  }

  const [optimized, ...rest] = prompts;
  const inspirations          = rest.slice(0, 4);

  return {
    optimized,
    inspirations,
    total:    prompts.length,
    fromREST,
    fromMCP,
    fromGitHub,
    fromBuiltIn,
  };
}

/* ── Low-level Groq helper (used by all three pipeline agents) ───────── */

// extra: optional sampling overrides spread directly into the request body.
// Supports any Groq-compatible field — typically top_p or top_k.
// temperature is kept as a named param so all non-optimizer callers are unaffected.
async function groqCall(apiKey, model, systemContent, userContent, maxTokens = 512, debugLabel = null, temperature = 0.7, extra = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
  let res;
  try {
    res = await fetch(GROQ_API, {
      signal: controller.signal,
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user',   content: userContent   },
        ],
        max_tokens:  maxTokens,
        temperature,
        ...extra,   // e.g. { top_p: 0.1 } or { top_k: 40 }
      }),
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === 'AbortError') throw new Error('Request timed out — try again');
    throw fetchErr;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let msg = `Groq API error ${res.status}`;
    try {
      const body = await res.json();
      if (body.error?.message) msg = body.error.message;
    } catch { /* ignore parse error */ }
    if (res.status === 401) msg = 'Invalid Groq API key — check Settings';
    if (res.status === 429) msg = 'Groq rate limit reached — try again in a moment';
    throw new Error(msg);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim();
  if (debugLabel) {
    log(`[${debugLabel} RAW response]:`, JSON.stringify(json));
    log(`[${debugLabel} parsed output]:`, text);
    log(`[${debugLabel} length]:`, text?.length);
  }
  if (!text) throw new Error('Groq returned an empty response');
  return text;
}

/* ── ACE Playbook helpers ─────────────────────────────────────────────── */

// Normalises a playbook entry to the ACE shape { rules, strategyDoc }.
// Handles three cases: undefined → empty, legacy string[] → no strategyDoc, ACE object.
function normalizePlaybook(entry) {
  if (!entry) return { rules: [], strategyDoc: '' };
  if (Array.isArray(entry)) return { rules: entry, strategyDoc: '' };
  return { rules: Array.isArray(entry.rules) ? entry.rules : [], strategyDoc: entry.strategyDoc || '' };
}

// Synthesises a 2–3 sentence Strategy Document from accumulated style rules.
// Called when a domain playbook reaches >= 3 rules. Replaces the bullet list
// with a coherent narrative the Pruner can inject as richer context.
async function synthesizeStrategyDoc(apiKey, domain, rules) {
  const systemMsg = [
    'You are a style preference synthesizer. Given a list of structural style rules for a prompt-writing domain,',
    'write a cohesive 2-3 sentence Strategy Document capturing the user\'s overall preferences.',
    `Domain: ${domain}. Write as a clear, actionable brief for a future prompt optimizer.`,
    'Start with "This user prefers…" or "For [domain] tasks, this user…".',
    'Flowing prose only — no bullet points, no headers.',
  ].join('\n');
  return await groqCall(
    apiKey, GROQ_PRUNER_MODEL, systemMsg,
    `Style rules for ${domain} domain:\n${rules.map(r => `- ${r}`).join('\n')}`,
    200, 'AgentACE-StrategyDoc', 0.3,
  );
}

/* ── Three-agent optimization pipeline ──────────────────────────────── */

// tabId: chrome tab ID of the sender — used to push progress labels back.
// Simplified pipeline: single focused Groq call with fill-in-the-blank template.
// The model fills short fields instead of generating a prompt from scratch.
async function runOptimizePipeline(apiKey, userPrompt, chatHistory, lastAssistantMessage, examples, patternNotes, tabId, mode = 'auto', answers = [], stylePlaybooks = {}) {

  const progress = (label) => {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'PIPELINE_PROGRESS', label }).catch(() => {});
    }
  };

  // ── Agent 1: Context Pruner + Domain Classifier (llama-3.1-8b-instant) ─
  progress('⚡ Pruning...');

  let prunedContext = 'NONE';
  // ── Domain inference from prompt text ────────────────────────────────────
  let domain = 'generic';
  const promptLower = userPrompt.toLowerCase();
  if (/\b(code|debug|function|bug|error|api|deploy|refactor|test|class|variable|python|javascript|react|sql|git)\b/.test(promptLower)) domain = 'code';
  else if (/\b(writ|edit|essay|blog|copy|article|email|rewrite|grammar|tone|draft)\b/.test(promptLower)) domain = 'writing';
  else if (/\b(data|analys|chart|metric|trend|csv|dashboard|statistic|number)\b/.test(promptLower)) domain = 'data';
  else if (/\b(story|poem|fiction|creative|character|scene|dialogue|novel|script)\b/.test(promptLower)) domain = 'creative';
  else if (/\b(explain|teach|learn|concept|understand|how does|what is|why does|study)\b/.test(promptLower)) domain = 'research';

  // ── Build context from conversation (if available) ─────────────────────
  let conversationContext = '';
  if (chatHistory && chatHistory.length > 0) {
    conversationContext = '\n\nConversation context:\n' +
      chatHistory.slice(-6).map(t => `${t.role}: ${t.content}`).join('\n');
  }
  if (lastAssistantMessage) {
    conversationContext += '\n\nLast AI response:\n' + lastAssistantMessage.slice(0, 1000);
  }
  if (answers.length > 0) {
    conversationContext += '\n\nUser clarification: ' + answers.join('; ');
  }

  // ── Build reference from search results ────────────────────────────────
  let referenceBlock = '';
  if (examples.length > 0) {
    referenceBlock = '\n\nReference prompts (proven patterns — adopt their style):\n' +
      examples.slice(0, 3).map((e, i) => `[${i + 1}] ${e.title}: ${e.content.slice(0, 400)}`).join('\n\n');
  }

  // ── SINGLE Groq call — fill-in-the-blank template ──────────────────────
  progress('⚡ Optimizing...');

  const systemMsg = `You fill in prompt templates. Given a user's rough prompt, fill each field below.

ABSOLUTE RULES:
1. ONLY use information from the user's prompt and conversation context. Do NOT invent ANY details.
2. If the prompt is about health, the rewrite must be about health. If about cooking, about cooking. SAME TOPIC.
3. <ctx> must be the user's request IN THEIR OWN WORDS — rephrase for clarity but add NOTHING new.
4. Each field: 5-20 words. Short and honest.

Fill this template:
<role>[what expert answers this? based on the TOPIC of their prompt]</role>
<ctx>[restate their request using their words — do not add details they didn't mention]</ctx>
<task>
- [what they want, as an action phrase]
- [what would make the response more useful]
</task>
<rules>
MUST: [one requirement for a good response to THIS specific request]
MUST: [another requirement]
NEVER: [one failure mode to avoid for THIS specific request]
NEVER: [another failure mode]
</rules>
<fmt>[best output format for this type of request]</fmt>`;

  const userMsg = `Fill the template for this prompt:\n"${userPrompt}"${conversationContext}${referenceBlock}`;

  // Run 2 candidates at different temperatures — pick the better one
  const [r1, r2] = await Promise.allSettled([
    groqCall(apiKey, GROQ_OPTIMIZER_MODEL, systemMsg, userMsg, 600, 'Opt-Lo', 0.2),
    groqCall(apiKey, GROQ_OPTIMIZER_MODEL, systemMsg, userMsg, 600, 'Opt-Hi', 0.6),
  ]);

  const candidates = [r1, r2]
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => {
      const raw = r.value;
      // Extract from <role> onward (model might add preamble)
      const idx = raw.indexOf('<role>');
      return idx !== -1 ? raw.slice(idx).trim() : raw.trim();
    })
    .filter(c => /^<role>/i.test(c));

  if (candidates.length === 0) {
    // Both failed — return code-built fallback
    return { text: buildFallbackPrompt(userPrompt, domain), rationale: '' };
  }

  // Pick the candidate with better topic coherence
  let best = candidates[0];
  if (candidates.length > 1) {
    const issue0 = checkTopicCoherence(candidates[0], userPrompt, chatHistory, lastAssistantMessage);
    const issue1 = checkTopicCoherence(candidates[1], userPrompt, chatHistory, lastAssistantMessage);
    if (issue0 && !issue1) best = candidates[1];
    else if (!issue0 && issue1) best = candidates[0];
    // If both pass or both fail, keep the lower-temperature one (more reliable)
  }

  // ── Topic coherence check ─────────────────────────────────────────────
  const topicIssue = checkTopicCoherence(best, userPrompt, chatHistory, lastAssistantMessage);
  if (topicIssue) {
    console.warn('[PromptForge] Topic coherence FAILED:', topicIssue);
    return { text: buildFallbackPrompt(userPrompt, domain), rationale: '' };
  }

  // ── Hallucination strip ───────────────────────────────────────────────
  best = stripHallucinations(best, userPrompt, chatHistory, lastAssistantMessage);

  // ── Quality check ─────────────────────────────────────────────────────
  const qualityIssue = detectGenericOutput(best);
  if (qualityIssue) {
    console.warn('[PromptForge] Quality gate failed:', qualityIssue);
    return { text: buildFallbackPrompt(userPrompt, domain), rationale: '' };
  }

  return { text: best, rationale: '' };
}

/* ── Output quality detector ─────────────────────────────────────────── */
// Returns a string describing the problem if the output is generic, or null if ok.

function detectGenericOutput(text) {
  const lower = text.toLowerCase();

  // Check for meta-description <ideal> — the #1 failure mode
  const idealMatch = text.match(/<ideal>([\s\S]*?)<\/ideal>/i);
  if (idealMatch) {
    const ideal = idealMatch[1].trim().toLowerCase();
    // Meta-descriptions use phrases like "a clear explanation of..." or "a detailed response..."
    if (/^a\s+(clear|detailed|concise|comprehensive|thorough|well-structured|helpful|good)\b/.test(ideal)) {
      return '<ideal> is a meta-description ("' + ideal.slice(0, 50) + '..."), not an actual example';
    }
    if (/^(provide|give|offer|present|deliver|include)\s/.test(ideal)) {
      return '<ideal> starts with an instruction verb, not actual content';
    }
    // Very short <ideal> is suspicious
    if (ideal.length < 30) {
      return '<ideal> is too short (' + ideal.length + ' chars) to be a real example';
    }
  }

  // Check for generic <role>
  const roleMatch = text.match(/<role>([\s\S]*?)<\/role>/i);
  if (roleMatch) {
    const role = roleMatch[1].trim().toLowerCase();
    const genericRoles = ['teacher', 'assistant', 'helper', 'expert', 'ai', 'tutor', 'educator', 'guide'];
    // Role is just a single generic word with no specialization
    if (genericRoles.includes(role) || (role.length < 15 && !role.includes('|'))) {
      return '<role> is too generic ("' + role + '") — needs specific specialization';
    }
  }

  // Check for generic <ctx>
  const ctxMatch = text.match(/<ctx>([\s\S]*?)<\/ctx>/i);
  if (ctxMatch) {
    const ctx = ctxMatch[1].trim().toLowerCase();
    // Just synonym lists with no substance
    if (/^[a-z]+\|[a-z]+(\|[a-z]+)*$/.test(ctx) && ctx.length < 40) {
      return '<ctx> is just a synonym list ("' + ctx + '"), no actual context';
    }
  }

  // Check for meta-description <wrong>
  const wrongMatch = text.match(/<wrong>([\s\S]*?)<\/wrong>/i);
  if (wrongMatch) {
    const wrong = wrongMatch[1].trim().toLowerCase();
    if (/^a\s+(vague|unclear|poor|bad|generic|ambiguous|confusing)\b/.test(wrong)) {
      return '<wrong> is a meta-description, not an actual bad example';
    }
    if (wrong.length < 20) {
      return '<wrong> is too short to be a real example';
    }
  }

  return null; // output looks OK
}

/* ── Hallucination stripper ──────────────────────────────────────────── */
// Structural post-processing: checks every claim in <ctx> against the user's
// actual input. Strips sentences/phrases that contain specific details not
// found in the original prompt or conversation. This is CODE, not an LLM
// instruction — the model can't ignore it.

function stripHallucinations(output, userPrompt, chatHistory = [], lastAssistantMessage = null) {
  // Build the source text — everything the user actually said
  const sourceText = [
    userPrompt,
    ...(chatHistory || []).map(t => t.content || ''),
    lastAssistantMessage || '',
  ].join(' ').toLowerCase();

  // Extract source words (3+ chars, deduplicated) — these are "grounded" terms
  const sourceWords = new Set(
    sourceText.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  );

  // ── Check <ctx> for hallucinated specifics ──────────────────────────────
  const ctxMatch = output.match(/<ctx>([\s\S]*?)<\/ctx>/i);
  if (ctxMatch) {
    const ctxContent = ctxMatch[1].trim();
    // Split <ctx> into claims (pipe-separated or sentence-separated)
    const claims = ctxContent.split(/[|;.]/).map(c => c.trim()).filter(Boolean);

    const grounded = [];
    const stripped = [];

    for (const claim of claims) {
      // Extract significant words from this claim (nouns, numbers, specifics)
      const claimWords = claim.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

      // Check for specific fabricated details: numbers, ages, proper nouns, technical terms
      // that don't appear anywhere in the source text
      const specificPatterns = claim.match(/\b(\d+[-–]year[-–]old|\d+ mg|[$]\d+|\d+%|\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b)/g) || [];
      const hasHallucinatedSpecific = specificPatterns.some(p =>
        !sourceText.includes(p.toLowerCase())
      );

      // Count how many significant words from the claim appear in the source
      const significantWords = claimWords.filter(w =>
        !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'been',
          'such', 'after', 'where', 'who', 'which', 'their', 'about', 'into', 'more',
          'should', 'could', 'would', 'will', 'can', 'may', 'must', 'never'].includes(w)
      );

      const matchCount = significantWords.filter(w => sourceWords.has(w)).length;
      const matchRatio = significantWords.length > 0 ? matchCount / significantWords.length : 1;

      // A claim is hallucinated if:
      // - It has fabricated specific details (numbers, ages, names not in source)
      // - OR less than 30% of its significant words appear in the source
      if (hasHallucinatedSpecific || (significantWords.length >= 3 && matchRatio < 0.3)) {
        stripped.push(claim);
      } else {
        grounded.push(claim);
      }
    }

    if (stripped.length > 0) {
      log('Hallucination stripper: removed from <ctx>:', stripped);
      // Rebuild <ctx> with only grounded claims
      const newCtx = grounded.length > 0
        ? grounded.join('|')
        : userPrompt.slice(0, 100); // fallback: just use the user's prompt
      output = output.replace(/<ctx>[\s\S]*?<\/ctx>/i, `<ctx>${newCtx}</ctx>`);
    }
  }

  // ── Check <example><in> for hallucinated scenario ───────────────────────
  const inMatch = output.match(/<in>([\s\S]*?)<\/in>/i);
  if (inMatch) {
    const inContent = inMatch[1].trim().toLowerCase();
    const inWords = inContent.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
    const sigWords = inWords.filter(w =>
      !['the', 'and', 'for', 'with', 'that', 'this', 'how', 'what', 'can', 'you', 'please', 'help', 'want'].includes(w)
    );
    const matched = sigWords.filter(w => sourceWords.has(w)).length;
    const ratio = sigWords.length > 0 ? matched / sigWords.length : 1;

    // If <in> is mostly fabricated, replace with the user's actual prompt
    if (sigWords.length >= 3 && ratio < 0.3) {
      log('Hallucination stripper: replaced fabricated <in> with user prompt');
      output = output.replace(/<in>[\s\S]*?<\/in>/i, `<in>${userPrompt}</in>`);
    }
  }

  return output;
}

/* ── Topic coherence checker ──────────────────────────────────────────── */
// Detects when the entire output is about a different topic than the user's prompt.
// Returns a description of the mismatch, or null if coherent.

function checkTopicCoherence(output, userPrompt, chatHistory = [], lastAssistantMessage = null) {
  // Build source vocabulary — all significant words from what the user said
  const sourceText = [
    userPrompt,
    ...(chatHistory || []).map(t => t.content || ''),
    lastAssistantMessage || '',
  ].join(' ').toLowerCase();

  const stopWords = new Set([
    'the','and','for','with','that','this','from','are','was','has','been','have',
    'will','can','may','must','not','but','how','what','why','who','where','when',
    'some','any','all','each','about','into','more','most','than','then','also',
    'just','help','please','want','need','like','make','get','give','tell','show',
    'really','very','much','should','could','would','being','out','its','you','your',
    'they','them','their','our','his','her','something','someone','thing','stuff',
  ]);

  const getSignificantWords = (text) => {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length >= 3 && !stopWords.has(w))
    );
  };

  const sourceWords = getSignificantWords(sourceText);
  if (sourceWords.size === 0) return null; // can't check empty prompts

  // Extract topic words from the output's <role> + <ctx> + <task>
  const roleMatch = output.match(/<role>([\s\S]*?)<\/role>/i);
  const ctxMatch  = output.match(/<ctx>([\s\S]*?)<\/ctx>/i);
  const taskMatch = output.match(/<task>([\s\S]*?)<\/task>/i);

  const outputTopicText = [
    roleMatch ? roleMatch[1] : '',
    ctxMatch  ? ctxMatch[1]  : '',
    taskMatch ? taskMatch[1] : '',
  ].join(' ');

  const outputWords = getSignificantWords(outputTopicText);
  if (outputWords.size === 0) return null;

  // Count overlap
  let overlap = 0;
  for (const w of sourceWords) {
    if (outputWords.has(w)) overlap++;
  }

  // Also check reverse: what fraction of output topic words are grounded
  let reverseOverlap = 0;
  for (const w of outputWords) {
    if (sourceWords.has(w)) reverseOverlap++;
  }

  const forwardRatio  = overlap / sourceWords.size;
  const reverseRatio  = reverseOverlap / outputWords.size;

  log('Topic coherence:', {
    sourceWords: [...sourceWords].slice(0, 10),
    outputWords: [...outputWords].slice(0, 10),
    forwardRatio: forwardRatio.toFixed(2),
    reverseRatio: reverseRatio.toFixed(2),
  });

  // If both directions show <15% overlap, the output is off-topic
  if (forwardRatio < 0.15 && reverseRatio < 0.15) {
    return `Output topic ("${[...outputWords].slice(0, 5).join(', ')}") has near-zero overlap with input topic ("${[...sourceWords].slice(0, 5).join(', ')}")`;
  }

  return null;
}

/* ── Fallback prompt builder — no LLM, pure code ────────────────────── */
// When the pipeline produces a completely off-topic result, build a minimal
// but honest structured prompt directly from the user's words.

function buildFallbackPrompt(userPrompt, domain) {
  // Extract key phrases from the user's prompt
  const words = userPrompt.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const topicWords = words.filter(w =>
    !['help', 'please', 'want', 'need', 'like', 'just', 'some', 'the', 'and', 'for', 'with',
      'about', 'have', 'been', 'this', 'that', 'what', 'how', 'can', 'you', 'your'].includes(w.toLowerCase())
  );

  const topic = topicWords.slice(0, 6).join(' ') || userPrompt.slice(0, 50);
  const domainRole = {
    code: 'software engineer|debugging+problem solving',
    writing: 'professional writer|clarity+concision',
    data: 'data analyst|pattern recognition+insight extraction',
    creative: 'creative consultant|ideation+storytelling',
    research: 'subject matter expert|clear explanation+teaching',
    generic: 'knowledgeable assistant|' + topic,
  };

  return `<role>${domainRole[domain] || domainRole.generic}</role>
<ctx>${userPrompt}</ctx>
<task>
- Address the user's request: ${topic}
- Provide clear, actionable information
- Structure the response for easy understanding
</task>
<rules>
MUST: stay focused on exactly what the user asked about
MUST: be specific and practical
NEVER: introduce topics or details the user didn't ask about
NEVER: assume context that wasn't provided
</rules>
<fmt>clear|structured|directly relevant</fmt>`;
}

/* ── OPTIMIZE_WITH_CONTEXT handler (content script → background) ─────── */

async function handleOptimizeWithContext({ prompt, chatHistory = [], lastAssistantMessage = null, mode = 'auto', answers = [] }, tabId) {

  // 1. API key
  const stored = await chrome.storage.sync.get('groqApiKey');
  const apiKey = stored.groqApiKey;
  if (!apiKey) throw new Error('NO_API_KEY');

  // 2. Extract search keywords from the prompt + recent context
  const keywords = extractKeywords(prompt, chatHistory);

  // 3. Search multiple sources in parallel for proven prompts
  let examples = [];
  const [restSettled, ghSettled] = await Promise.allSettled([
    // prompts.chat
    (async () => {
      const raw = await searchPromptsREST(keywords, 10);
      raw.sort((a, b) => {
        const score = r => r.votes ?? r.likes ?? r.upvotes ?? r.stars ?? r.score ?? 0;
        return score(b) - score(a);
      });
      return raw.map(normalizePrompt).filter(Boolean).slice(0, 5);
    })(),
    // GitHub awesome-chatgpt-prompts
    searchPromptsGitHub(keywords, 5),
  ]);

  if (restSettled.status === 'fulfilled' && restSettled.value.length > 0) {
    examples.push(...restSettled.value);
    log('prompts.chat examples:', examples.map(e => `"${e.title}"`).join(', '));
  } else if (restSettled.status === 'rejected') {
    console.warn('[PromptForge] prompts.chat search failed:', restSettled.reason?.message);
  }

  if (ghSettled.status === 'fulfilled' && ghSettled.value.length > 0) {
    examples.push(...ghSettled.value);
    log('GitHub examples:', ghSettled.value.map(e => `"${e.title}"`).join(', '));
  } else if (ghSettled.status === 'rejected') {
    console.warn('[PromptForge] GitHub search failed:', ghSettled.reason?.message);
  }

  // 3b. Always include relevant built-in proven patterns
  const provenMatches = matchProvenPatterns(keywords, '', 2);
  if (provenMatches.length > 0) {
    examples.push(...provenMatches);
    log('Built-in patterns matched:', provenMatches.map(p => `"${p.title}"`).join(', '));
  }

  // 3c. Include user's previously accepted prompts (adapts over time)
  try {
    const accepted = await searchAcceptedPrompts(keywords, 2);
    if (accepted.length > 0) {
      examples.push(...accepted);
      log('User accepted prompts matched:', accepted.map(p => `"${p.title}"`).join(', '));
    }
  } catch { /* ignore — first run has no accepted prompts */ }

  // Deduplicate
  examples = dedup(examples);

  // 4. Analyse structural patterns in the fetched prompts
  const patternNotes = examples.length > 0 ? analyzePatterns(examples) : [];
  if (patternNotes.length > 0)
    log('patterns detected:', patternNotes.join(', '));

  // 5. Load domain-keyed style playbooks accumulated from past user edits
  const { pfStylePlaybooks: stylePlaybooks = {}, pfStyleRules: legacyRules } =
    await chrome.storage.local.get(['pfStylePlaybooks', 'pfStyleRules']);

  // One-time migration: move legacy flat pfStyleRules into pfStylePlaybooks.generic
  if (legacyRules && legacyRules.length > 0 && !stylePlaybooks.generic) {
    stylePlaybooks.generic = legacyRules;
    await chrome.storage.local.set({ pfStylePlaybooks: stylePlaybooks });
    await chrome.storage.local.remove('pfStyleRules');
    log('Migrated pfStyleRules → pfStylePlaybooks.generic');
  }

  const totalRules = Object.values(stylePlaybooks).reduce((sum, entry) => {
    const e = normalizePlaybook(entry);
    return sum + e.rules.length + (e.strategyDoc ? 1 : 0);
  }, 0);
  if (totalRules > 0)
    log('Applying user style playbooks:', stylePlaybooks);

  // 6. Run the pipeline (prune → optimize ×3 → merge → polish → rationale)
  const { text: optimized, rationale } = await runOptimizePipeline(
    apiKey, prompt, chatHistory, lastAssistantMessage, examples, patternNotes, tabId, mode, answers, stylePlaybooks,
  );

  // 7. Return the optimised text + rationale + source titles for the toast
  const inspiredBy = examples.map(e => e.title).filter(Boolean);
  return { optimized, inspiredBy, rationale };
}

/* ── GENERATE_SYSTEM_PROMPT handler ─────────────────────────────────── */
// Extracts the permanent, reusable parts from an optimized prompt and
// formats them as a Claude Projects system prompt the user can set once.

async function handleGenerateSystemPrompt({ optimizedPrompt }) {
  const stored = await chrome.storage.sync.get('groqApiKey');
  const apiKey = stored.groqApiKey;
  if (!apiKey) throw new Error('NO_API_KEY');

  const systemMsg = [
    'Convert this XML-structured prompt into a reusable Claude system prompt.',
    'Extract ONLY permanent parts from <role> and <rules>: expertise, response style, format preferences.',
    'Do NOT include task-specific content from <task> or <ctx>.',
    'Write 3-5 lines starting with "You are…" — set once, never repeat.',
    'Return ONLY the system prompt text, no explanation.',
  ].join('\n');

  return await groqCall(
    apiKey, GROQ_PRUNER_MODEL, systemMsg,
    `Optimized prompt:\n${optimizedPrompt}`,
    300, 'AgentSysPrompt', 0.3,
  );
}

/* ── AgentTrajectory — edit-delta analyser ───────────────────────────── */
// Called after the user edits the After box before clicking "Use this".
// Compares the pipeline output to what the user actually sent, then extracts
// concrete User-Specific Style Rules describing structural/linguistic preferences.
// Returns an array of rule strings, or [] if the delta is too small to learn from.

async function runAgentTrajectory(apiKey, optimized, userEdited, domain = 'generic') {
  const systemMsg = [
    'You are a style preference analyst performing trajectory optimization.',
    'You receive an AI-optimized prompt and the version the user manually edited it to.',
    `Domain: ${domain}. Rules generated here will be stored in the ${domain} style playbook.`,
    'Extract rules that reflect patterns relevant to this domain — avoid rules only applicable to other domains.',
    '',
    'Analyze the structural and linguistic delta between the two versions.',
    'Extract 1-3 concrete User-Specific Style Rules describing what the user changed and why they likely prefer it.',
    '',
    'Each rule MUST:',
    '- Be a single, specific, actionable sentence',
    '- Start with one of: Prefers / Uses / Avoids / Rewrites',
    '- Reference the XML structure when relevant (<role>/<ctx>/<task>/<rules>/<fmt>)',
    '- Describe a structural or linguistic pattern — NOT topic content',
    '',
    'GOOD: "Avoids filler in <role> — uses concise role|specialization format"',
    'GOOD: "Rewrites <task> as 2 items rather than 3 — prefers brevity over exhaustiveness"',
    'GOOD: "Adds extra NEVER entries in <rules> for this domain"',
    'BAD: "Prefers shorter prompts" — too vague, not actionable',
    '',
    'Output rules one per line, each starting with "- ". No preamble, no explanation.',
    'If the delta is too small or purely content-based with no structural pattern, output only: SKIP',
  ].join('\n');

  const userMsg = `AI-OPTIMIZED:\n${optimized}\n\nUSER-EDITED:\n${userEdited}`;
  const raw = await groqCall(apiKey, GROQ_PRUNER_MODEL, systemMsg, userMsg, 250, 'AgentTrajectory', 0.1);

  if (raw.trim().toUpperCase() === 'SKIP') return [];

  return raw
    .split('\n')
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

/* ── ANALYZE_EDIT_DELTA handler ──────────────────────────────────────── */
// Runs AgentTrajectory, appends rules to the domain-keyed ACE playbook,
// and synthesises a Strategy Document once >= 3 rules have accumulated.

async function handleAnalyzeEditDelta({ optimized, userEdited }) {
  const stored = await chrome.storage.sync.get('groqApiKey');
  const apiKey = stored.groqApiKey;
  if (!apiKey) return;

  // Extract domain from <ctx> block or <role> block
  const domainMatch = optimized.match(/<(?:ctx|role)>[^<]*?(code|writing|data|creative|research|generic)/i);
  const domain = domainMatch ? domainMatch[1].toLowerCase() : 'generic';

  const newRules = await runAgentTrajectory(apiKey, optimized, userEdited, domain);
  if (newRules.length === 0) {
    log('Trajectory: delta too small — no style rules extracted');
    return;
  }

  const { pfStylePlaybooks: existing = {} } = await chrome.storage.local.get('pfStylePlaybooks');
  const entry       = normalizePlaybook(existing[domain]);
  // Append new rules, deduplicate, keep 10 most recent per domain
  const updatedRules = [...new Set([...entry.rules, ...newRules])].slice(-10);

  // Generate (or regenerate) a Strategy Document when >= 3 rules have accumulated.
  // The strategyDoc is a cohesive narrative the Pruner injects into context —
  // more aligned than a flat rule list per the ACE framework.
  let strategyDoc = entry.strategyDoc;
  if (updatedRules.length >= 3) {
    try {
      strategyDoc = await synthesizeStrategyDoc(apiKey, domain, updatedRules);
      log(`ACE: synthesised ${domain} strategy doc →`, strategyDoc);
    } catch (err) {
      console.warn('[PromptForge] ACE strategy doc synthesis failed:', err.message);
    }
  }

  const updated = { ...existing, [domain]: { rules: updatedRules, strategyDoc } };
  await chrome.storage.local.set({ pfStylePlaybooks: updated });
  log(`Trajectory: ${domain} playbook updated →`, updatedRules);
}

/* ── Save user-accepted prompts for future reference ──────────────────── */
// When a user clicks "Use this", the prompt is stored locally so the system
// can reference prompts that actually worked for this user. Keeps last 20.

async function handleSaveAcceptedPrompt({ prompt, domain }) {
  const { pfAcceptedPrompts: existing = [] } = await chrome.storage.local.get('pfAcceptedPrompts');

  // Extract a title from the <role> tag
  const roleMatch = prompt.match(/<role>(.*?)<\/role>/i);
  const title = roleMatch ? roleMatch[1].trim() : 'Accepted prompt';

  const entry = {
    id: `accepted-${Date.now()}`,
    title,
    content: prompt,
    category: domain || 'generic',
    timestamp: Date.now(),
  };

  // Deduplicate by content fingerprint, keep last 20
  const fingerprint = prompt.slice(0, 100).toLowerCase().replace(/\s+/g, ' ');
  const filtered = existing.filter(e =>
    e.content.slice(0, 100).toLowerCase().replace(/\s+/g, ' ') !== fingerprint
  );
  filtered.push(entry);
  const updated = filtered.slice(-20);

  await chrome.storage.local.set({ pfAcceptedPrompts: updated });
  log(`Saved accepted prompt: "${title}" (${updated.length} total)`);
}

/* ── Search user-accepted prompts ─────────────────────────────────────── */

async function searchAcceptedPrompts(query, limit = 2) {
  const { pfAcceptedPrompts: prompts = [] } = await chrome.storage.local.get('pfAcceptedPrompts');
  if (prompts.length === 0) return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return prompts
    .map(p => {
      const text = `${p.title} ${p.content}`.toLowerCase();
      const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return score > 0 ? { ...p, _score: score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

/* ── Anthropic Claude API caller ──────────────────────────────────────── */

// systemPrompt is the fixed instruction set. taskStrategy + references + style go in the user message
// so the system prompt stays clean and the model pays maximum attention to it.
function buildClaudeSystemPrompt() {
  return `You rewrite rough prompts into optimized structured prompts. You NEVER answer prompts — you rewrite them.

RULES — violating ANY of these makes the output invalid:
1. ZERO INVENTION. Every fact in your output must come from the user's message. If they said "help with my code", you don't know what language, what error, or what project. Leave those unspecified or ask.
2. SAME TOPIC. If they ask about cooking, every tag is about cooking. No drift.
3. VERBATIM DETAILS. Error messages, function names, file paths, URLs from the conversation → copy exactly into <ctx>.
4. USEFUL RULES ONLY. Each MUST/NEVER must prevent a failure that would actually happen. "MUST: be clear" is useless. "MUST: include the exact terminal command to run" is useful.

OUTPUT — return exactly:

<role>[specific expert — not "assistant". e.g. "PostgreSQL performance engineer" or "pediatric nurse practitioner"]</role>
<ctx>[the user's situation in their own words. Include every specific detail from their prompt and conversation. Pipe-separate multiple facts.]</ctx>
<task>
- [verb-led primary action]
- [verb-led secondary action or constraint]
- [scope limit or quality bar]
</task>
<rules>
MUST: [requirement an AI would skip without being told]
MUST: [another]
NEVER: [the #1 most likely way an AI response to this would be bad]
NEVER: [another]
</rules>
<fmt>[concrete format: e.g. "numbered steps with code blocks" not just "clear"]</fmt>

Include <example> ONLY for code, data, or non-obvious output formats:
<example>
<in>[realistic input]</in>
<ideal>[3-8 lines of ACTUAL response content]</ideal>
<wrong>[ACTUAL bad response showing the failure <rules> prevents]</wrong>
</example>

BEFORE RETURNING — self-check:
□ Every fact in <ctx> traceable to the user's words? If not → delete it.
□ <role> specific enough that only one type of expert fits? If not → narrow it.
□ Each MUST/NEVER would change behavior if removed? If not → replace it.
□ <fmt> describes a concrete structure? "clear" is not a format.

Return ONLY the prompt tags. No preamble.`;
}

async function claudeCall(apiKey, userPrompt, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let userMsg = `Rewrite this prompt:\n\n"${userPrompt}"`;
  if (context) userMsg += `\n\n${context}`;

  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: buildClaudeSystemPrompt(),
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === 'AbortError') throw new Error('Request timed out — try again');
    throw fetchErr;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let msg = `Claude API error ${res.status}`;
    try {
      const body = await res.json();
      if (body.error?.message) msg = body.error.message;
    } catch {}
    if (res.status === 401) msg = 'Invalid Anthropic API key — check Settings';
    if (res.status === 429) msg = 'Rate limit reached — wait a moment and try again';
    throw new Error(msg);
  }

  const json = await res.json();
  const text = json.content?.[0]?.text?.trim();
  if (!text) throw new Error('Claude returned an empty response');

  const idx = text.indexOf('<role>');
  return idx !== -1 ? text.slice(idx).trim() : text;
}

/* ── Task-specific rewriting strategies ───────────────────────────────── */

const TASK_STRATEGIES = {
  code: `CODE TASK STRATEGY:
- Specify exact language, version, and framework in <role>
- Include error messages, function names, and file paths verbatim in <ctx>
- <task> should define exact input→output contract
- <rules> MUST: require working code not pseudocode, NEVER: suggest changes without testing implications
- Include <example> with actual code snippets`,

  writing: `WRITING TASK STRATEGY:
- Specify target audience and their expertise level in <ctx>
- <task> should include tone, length range, and structure requirements
- <rules> MUST: preserve author's voice, NEVER: use clichés or filler phrases
- Skip <example> — writing is better guided by rules than examples`,

  data: `DATA/ANALYSIS TASK STRATEGY:
- <task> must specify comparison axes and what decisions the analysis supports
- <rules> MUST: cite specific numbers, NEVER: make claims without supporting data
- Include <example> showing the expected output format with real-looking numbers`,

  creative: `CREATIVE TASK STRATEGY:
- Add specific constraints that force originality (paradoxically, more constraints = more creative output)
- <rules> should include style anchors ("in the tone of X", "using Y technique")
- <task> should name what makes it creative, not just say "be creative"
- Skip <example> — it anchors the response too much for creative tasks`,

  research: `EXPLANATION/RESEARCH STRATEGY:
- Declare audience knowledge level explicitly in <ctx>
- <task> should require a concrete analogy and layered depth (simple → technical → implications)
- <rules> MUST: use named real-world examples, NEVER: use jargon without defining it
- Skip <example> for simple explanations, include for structured research tasks`,
};

/* ── OPTIMIZE_WITH_CLAUDE handler ────────────────────────────────────── */

async function handleOptimizeWithClaude({ prompt, chatHistory = [], lastAssistantMessage = null }, tabId) {
  const stored = await chrome.storage.sync.get('anthropicApiKey');
  const apiKey = stored.anthropicApiKey;
  if (!apiKey) throw new Error('NO_API_KEY');

  const progress = (label) => {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'PIPELINE_PROGRESS', label }).catch(() => {});
    }
  };

  // Domain inference from prompt text
  const promptLower = prompt.toLowerCase();
  let domain = 'generic';
  if (/\b(code|debug|function|bug|error|api|deploy|refactor|test|python|javascript|react|sql|git)\b/.test(promptLower)) domain = 'code';
  else if (/\b(writ|edit|essay|blog|copy|article|email|rewrite|grammar|tone|draft)\b/.test(promptLower)) domain = 'writing';
  else if (/\b(data|analys|chart|metric|trend|csv|dashboard|statistic|number)\b/.test(promptLower)) domain = 'data';
  else if (/\b(story|poem|fiction|creative|character|scene|dialogue|novel|script)\b/.test(promptLower)) domain = 'creative';
  else if (/\b(explain|teach|learn|concept|understand|how does|what is|why does|study)\b/.test(promptLower)) domain = 'research';

  // 1. Load curated library + search all sources in parallel
  progress('⚡ Searching patterns...');
  const keywords = extractKeywords(prompt, chatHistory);

  const [restSettled, ghSettled, curatedSettled] = await Promise.allSettled([
    searchPromptsREST(keywords, 5),
    searchPromptsGitHub(keywords, 5),
    loadCuratedLibrary(),
  ]);

  let examples = [];
  if (restSettled.status === 'fulfilled') examples.push(...(restSettled.value.map(normalizePrompt).filter(Boolean)));
  if (ghSettled.status === 'fulfilled')   examples.push(...ghSettled.value);

  // Curated library (highest quality — put first so they get priority)
  const curatedMatches = searchCuratedLibrary(keywords, domain, 3);
  if (curatedMatches.length > 0) examples.unshift(...curatedMatches);

  // Built-in patterns + user's accepted prompts
  examples.push(...matchProvenPatterns(keywords, '', 2));
  try {
    const accepted = await searchAcceptedPrompts(keywords, 2);
    if (accepted.length > 0) examples.push(...accepted);
  } catch {}

  examples = dedup(examples).slice(0, 6);
  const inspiredBy = examples.map(e => e.title).filter(Boolean);

  // 2. Build conversation context
  let chatContext = '';
  if (chatHistory.length > 0) {
    chatContext = 'Conversation context:\n' +
      chatHistory.slice(-6).map(t => `${t.role}: ${t.content}`).join('\n');
  }
  if (lastAssistantMessage) {
    chatContext += (chatContext ? '\n\n' : '') +
      'Last AI response:\n' + lastAssistantMessage.slice(0, 1500);
  }

  // 3. Build reference block — curated prompts get WHY annotations so Claude learns the principles
  let referenceBlock = '';
  if (examples.length > 0) {
    const refs = examples.slice(0, 3).map((e, i) => {
      const text = e.prompt || e.content || '';
      const why = e.why ? `\n  → WHY: ${e.why}` : '';
      return `[${i + 1}] "${e.title}"\n${text.slice(0, 500)}${why}`;
    });
    referenceBlock = 'Proven patterns from the community — adopt techniques that fit:\n\n' + refs.join('\n\n');
  }

  // 4. Task-specific strategy + style preferences + references → combined context for Claude
  const parts = [chatContext];

  const strategy = TASK_STRATEGIES[domain];
  if (strategy) parts.push(strategy);

  if (referenceBlock) parts.push(referenceBlock);

  const { pfStylePlaybooks: stylePlaybooks = {} } = await chrome.storage.local.get('pfStylePlaybooks');
  const playbook = normalizePlaybook(stylePlaybooks[domain] || stylePlaybooks.generic);
  if (playbook.strategyDoc) {
    parts.push('User style preferences:\n' + playbook.strategyDoc);
  } else if (playbook.rules.length > 0) {
    parts.push('User style preferences:\n' + playbook.rules.map(r => `- ${r}`).join('\n'));
  }

  // 5. Call Claude — strategy goes in user message, system prompt stays clean
  progress('⚡ Claude is optimizing...');
  const taskContext = parts.filter(Boolean).join('\n\n') || null;
  const optimized = await claudeCall(apiKey, prompt, taskContext);

  return { optimized, inspiredBy, rationale: '' };
}

/* ── Message listener ────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Content script: Claude API optimization
  if (message.type === 'OPTIMIZE_WITH_CLAUDE') {
    const tabId = _sender?.tab?.id ?? null;
    handleOptimizeWithClaude(message.payload, tabId)
      .then(data  => sendResponse({ success: true,  data }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Popup: search prompts.chat only (no Groq key needed)
  if (message.type === 'OPTIMIZE_PROMPT') {
    handleOptimize(message.payload)
      .then(data  => sendResponse({ success: true,  data }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Content script: export optimized prompt as a Claude Projects system prompt
  if (message.type === 'GENERATE_SYSTEM_PROMPT') {
    handleGenerateSystemPrompt(message.payload)
      .then(data  => sendResponse({ success: true,  data }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Content script: full AI optimization with Groq + chat context
  if (message.type === 'OPTIMIZE_WITH_CONTEXT') {
    const tabId = _sender?.tab?.id ?? null;
    handleOptimizeWithContext(message.payload, tabId)
      .then(data  => sendResponse({ success: true,  data }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Content script: user edited the After box — analyse delta and store style rules
  if (message.type === 'ANALYZE_EDIT_DELTA') {
    // Fire-and-forget — no sendResponse needed; failures are silent to avoid blocking UX
    handleAnalyzeEditDelta(message.payload)
      .catch(err => console.warn('[PromptForge] Trajectory analysis failed:', err.message));
    return false;
  }

  // Content script: user accepted an optimized prompt — save for future reference
  if (message.type === 'SAVE_ACCEPTED_PROMPT') {
    handleSaveAcceptedPrompt(message.payload)
      .catch(err => console.warn('[PromptForge] Save accepted prompt failed:', err.message));
    return false;
  }

  // Content script: open the options/settings page
  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  return false;
});
