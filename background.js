// Prompt Forge — background.js
// Service worker: handles all API calls (prompts.chat + Groq).
// Runs in the background context where cross-origin fetch is unrestricted (via host_permissions).

'use strict';

const API_BASE   = 'https://prompts.chat/api';
const GROQ_API   = 'https://api.groq.com/openai/v1/chat/completions';

// Three-agent pipeline models
const GROQ_PRUNER_MODEL    = 'llama-3.1-8b-instant';   // Agent 1, Agent 4 — fast/cheap
const GROQ_OPTIMIZER_MODEL = 'llama-3.3-70b-versatile'; // Agent 2 (A+B), Agent 3, chain
const GROQ_DIVERSITY_MODEL = 'gemma2-9b-it';            // Agent 2 (C) — different architecture for variety

/* ── Domain-matched few-shot examples ────────────────────────────────── */
// Agent 1 classifies the conversation into one of these domains.
// Agent 2 receives the matching example so its few-shot anchor is on-topic.

const DOMAIN_EXAMPLES = {
  code: {
    input:  'review my code',
    output: '## ROLE\nYou are a senior software engineer with 10 years experience in code review and debugging.\n\n## CONTEXT\nDomain: code. User submitted code for review — scope covers correctness, performance bottlenecks, and readability.\n\n## TASK\n1. Identify the top 3 issues ranked by severity: bugs, performance problems, readability\n2. For each issue: state the problem, explain the impact, show the exact fix\n\n## OUTPUT FORMAT\n<numbered-list>\nIssue → Impact → Exact fix (highest severity first)\n</numbered-list>',
    exemplar: {
      input:  'def load(path): data = open(path).read(); return json.loads(data)',
      output: '1. [HIGH] File handle never closed — memory leak on large files. Fix: use `with open(path) as f: data = f.read()`.\n2. [MEDIUM] No error handling — raises JSONDecodeError on bad input. Fix: wrap in try/except json.JSONDecodeError.\n3. [LOW] Missing type hints. Fix: def load(path: str) -> dict:',
    },
  },
  writing: {
    input:  'make this better',
    output: '## ROLE\nYou are a professional editor with 15 years experience in business and technical writing.\n\n## CONTEXT\nDomain: writing. User wants their text improved for clarity and concision — all key points must be preserved.\n\n## TASK\n1. Rewrite the provided text to be 30% shorter and 50% clearer\n2. Preserve every key point from the original\n\n## OUTPUT FORMAT\n<prose>\nRewritten version only — no commentary, no before/after labels\n</prose>',
    exemplar: {
      input:  'We are very excited to announce that we will be launching our new product next month.',
      output: 'Our new product launches next month.',
    },
  },
  data: {
    input:  'what does this data mean',
    output: '## ROLE\nYou are a senior data analyst with 10 years experience in business intelligence and data storytelling.\n\n## CONTEXT\nDomain: data. User provided a dataset and wants actionable business insights extracted from its patterns.\n\n## TASK\n1. Identify the 3 most significant patterns in the data\n2. For each: explain the business implication and recommend one concrete action\n\n## OUTPUT FORMAT\n<structured-list>\nPattern → Business implication → Recommended action\n</structured-list>',
    exemplar: {
      input:  'Q1 revenue: $2.1M, Q2: $1.8M, Q3: $2.6M, Q4: $3.1M. Support tickets: Q1 340, Q2 290, Q3 410, Q4 480.',
      output: 'Pattern 1: Revenue +48% Q2→Q4 → Strong growth → Action: increase sales headcount 20% before Q1.\nPattern 2: Tickets track revenue (+41% Q3-Q4) → Scaling strain → Action: hire 2 support agents before Q4.\nPattern 3: Q2 dip despite low tickets → Seasonal demand, not quality → Action: run Q2 promotions annually.',
    },
  },
  creative: {
    input:  'help with my story',
    output: '## ROLE\nYou are a fiction editor with 10 years experience in narrative structure and tension-building.\n\n## CONTEXT\nDomain: creative writing. User submitted a story passage that needs tension and stakes improved.\n\n## TASK\n1. Identify the specific sentence or paragraph where tension drops\n2. Rewrite that section to raise the stakes\n3. Append one sentence explaining the structural change made\n\n## OUTPUT FORMAT\n<prose>\nRewritten passage, followed by [Structural change: one-sentence explanation in brackets]\n</prose>',
    exemplar: {
      input:  'John walked into the bar. He felt nervous. He sat down and ordered a drink.',
      output: 'John\'s hand found the door before he was ready. Inside: same stools, same spilled-lager smell — and her, three seats from the end, watching him in the mirror.\n\n[Structural change: replaced flat exposition with immediate sensory conflict and stakes.]',
    },
  },
  research: {
    input:  'explain this concept',
    output: '## ROLE\nYou are a university professor with 15 years experience making complex ideas accessible to diverse audiences.\n\n## CONTEXT\nDomain: research/education. User wants a concept explained at three distinct levels of expertise.\n\n## TASK\n1. Write one sentence for a 10-year-old\n2. Write three bullet points for a professional\n3. Give one concrete real-world example\n\n## OUTPUT FORMAT\n<layered-explanation>\n10-year-old: [one sentence]\nProfessional: [three bullets]\nExample: [real-world case]\n</layered-explanation>',
    exemplar: {
      input:  'What is gradient descent?',
      output: '10-year-old: Imagine rolling a ball down a bumpy hill — gradient descent always rolls downhill to find the lowest point.\nProfessional: • Computes loss gradient w.r.t. parameters • Subtracts learning_rate × gradient each step • Repeats until convergence\nReal-world: Training a spam filter — after each email batch, weights shift slightly so the next prediction is slightly more accurate.',
    },
  },
  meta: {
    input:  'make a prompt that helps me brainstorm product names',
    output: '## ROLE\nYou are a creative director with 12 years experience in brand naming and consumer product positioning.\n\n## CONTEXT\nDomain: meta/prompt-engineering. User wants a reusable prompt that, when submitted to an AI, reliably produces high-quality product name brainstorming for a given product brief.\n\n## TASK\n1. Generate 10 product name candidates across three styles: functional (describes what it does), evocative (triggers emotion or imagery), and coined (invented word or blend)\n2. For each name: state the style category, a one-sentence rationale, and a domain availability note (easy/medium/hard to trademark)\n3. Flag the top 2 picks with a ★ and explain why they outperform the rest\n\n## OUTPUT FORMAT\n<structured-list>\nName — Style — Rationale — Trademark difficulty\n★ for top 2 picks, explanation on a separate line\n</structured-list>',
    exemplar: {
      input:  'Product: an app that helps remote teams run async standups. Audience: startup engineering teams.',
      output: 'Functional:\n1. AsyncStand — clear, SEO-rich — Medium trademark\n2. StandLog — concise, dev-friendly — Easy\nEvocative:\n3. Campfire — warmth + gathering — Hard (taken)\n4. ★ Relay — passing the baton, async chain — Medium. Top pick: intuitive metaphor, single word, broad appeal.\nCoined:\n5. ★ Standup·ly — verb-noun blend, memorable — Easy. Top pick: domain likely available, explains itself.',
    },
  },
  generic: {
    input:  'what is the optimal food stack',
    output: '## ROLE\nYou are a registered dietitian with 15 years experience in sports nutrition and evidence-based meal planning.\n\n## CONTEXT\nDomain: health/nutrition. User wants ranked, evidence-based food recommendations for optimal overall health.\n\n## TASK\n1. Rank the top 5 most nutrient-dense food combinations for overall health\n2. For each: name it, explain the benefit, state the recommended portion size\n\n## OUTPUT FORMAT\n<numbered-list>\nCombination → Benefit → Portion (highest health impact first)\n</numbered-list>',
    exemplar: {
      input:  'What should I eat for sustained energy throughout the day?',
      output: '1. Oats + blueberries — slow-release glucose + antioxidants → 4-hour plateau. Portion: 1 cup oats, ½ cup berries.\n2. Eggs + spinach — complete protein + iron → sustained focus. Portion: 2 eggs, 2 cups spinach.\n3. Salmon + sweet potato — omega-3 + complex carbs → brain + muscle fuel. Portion: 4oz + 1 medium.\n4. Greek yogurt + almonds — protein + fat → 3-4hr satiety. Portion: 6oz + 1oz.\n5. Lentils + brown rice — complete amino acids → stable glucose. Portion: ½ cup each.',
    },
  },
};

/* ── Mode instructions injected into Agent 2's system prompt ─────────── */
// Each mode adds a style constraint that Agent 2 bakes INTO the rewritten prompt.
// When the user submits the optimized prompt to Claude, Claude responds in that style.
// 'guided' uses the intent panel for extra context — pipeline runs like 'auto'.
// 'chain'  is handled post-merge — produces a 2-step priming + main prompt sequence.

const MODE_INSTRUCTIONS = {
  auto:     '',
  learn:    'teach for deep understanding, not surface knowledge: open with a one-sentence plain-English definition, then build intuition with at least one concrete analogy that connects the concept to something the learner already knows, explain the underlying "why" before the "what", and close with one comprehension-check question that tests understanding rather than recall',
  // Brief: positive-framing only — every directive states what TO do, never what to avoid.
  brief:    'write exactly 3 bullet points, open each bullet with an active verb, place the single most actionable insight first, keep each bullet to one sentence',
  // Deep: Chain-of-Thought cueing — forces Claude to externalise 8-12 reasoning steps.
  deep:     'think step-by-step: before answering, number and label 8 to 12 explicit reasoning steps, state assumptions at step 1, surface edge cases by step 6, then give the final answer on a new line',
  guided:   '',
  // Creative: semantic drift — Claude should prioritise novelty over convention.
  creative: 'approach this from an unexpected angle, use vivid and original language, favour surprising framings over safe ones, prioritise novelty',
  chain:    '',
};

/* ── Per-optimizer sampling parameters for Agent 2 ×3 ───────────────── */
// default: base diversity profile — three genuinely distinct strategies.
//   Optimizer 1 (Conservative): temperature 0.0 + top_p 0.1  → near-deterministic,
//     nucleus capped to the top 10% of probability mass. Maximum precision.
//   Optimizer 2 (Creative):     temperature 0.8 + top_p 0.9  → high entropy,
//     broad vocabulary sampling. Strong semantic drift from conservative.
//   Optimizer 3 (Diverse):      temperature 1.0 + top_k 40   → full entropy,
//     hard-capped at 40 tokens per step. Different distribution shape from top_p.
//
// Mode overrides: change temperature only — top_p / top_k carry through from default
// so each optimizer retains its structural identity even under mode constraints.

const AGENT2_PARAMS = {
  default: [
    { temperature: 0.0, top_p: 0.1 },  // Optimizer 1 — Conservative
    { temperature: 0.8, top_p: 0.9 },  // Optimizer 2 — Creative
    { temperature: 1.0, top_p: 0.8, top_k: 40 },  // Optimizer 3 — Diverse
  ],
  deep:     [{ temperature: 0.1 }, { temperature: 0.1  }, { temperature: 0.1  }],
  creative: [{ temperature: 0.9 }, { temperature: 0.95 }, { temperature: 0.85 }],
  brief:    [{ temperature: 0.4 }, { temperature: 0.6  }, { temperature: 0.5  }],
};

/* ── Agent 2 system prompt builder ───────────────────────────────────── */
// Returns the optimizer system message. When prompts.chat examples are
// available they are appended as reference for picking the right expert role
// and tone — but the core persona-inferring instruction is always the same.

// Mode-specific instructions to the OPTIMIZER itself (how to write the rewritten prompt).
// These are distinct from MODE_INSTRUCTIONS, which are constraints baked INTO the output
// prompt for Claude to follow. These guide the rewriting strategy.
const MODE_OPTIMIZER_HINTS = {
  deep: `\
DEEP MODE — CHAIN-OF-THOUGHT REWRITING:
The rewritten prompt MUST explicitly cue chain-of-thought reasoning. Bake in a numbered-steps instruction (8–12 steps) as the final constraint line. Prioritise precision over variety — every word must be unambiguous. Use temperature-appropriate language: no hedges, no "maybe", no "if applicable".`,

  creative: `\
CREATIVE MODE — SEMANTIC DRIFT REQUIRED:
Your rewrite must depart significantly from the original prompt's phrasing and framing. Do NOT preserve the original verbs, nouns, or structure. Reframe the task from an unexpected angle. If the original says "review my code", do NOT use "review" — try "Dissect", "Autopsy", "Pressure-test". Maximise novelty. The <example> Output must also demonstrate a surprising, non-obvious response style.`,

  brief: `\
BRIEF MODE — POSITIVE INSTRUCTION FRAMING ONLY:
Every line of the rewritten prompt must use positive directives (state what TO do). Never use "don't", "avoid", "no", "without", or any negative construction. Replace "don't be wordy" with "use one sentence per point". Replace "no preamble" with "open with the answer". The <example> Output must itself be tightly constrained — 3 bullets or fewer.`,

  learn: `\
LEARN MODE — TEACHER PERSONA + FIRST-PROMPT SELF-CONTAINED:
The user is typically at the start of a conversation (first or second message), so the rewritten prompt MUST be fully self-contained — assume zero prior context in the conversation.
## ROLE must name a specific teacher/educator persona (e.g. "You are an experienced computer science lecturer", "You are a patient maths tutor") — never a generic expert or practitioner role.
The rewritten ## TASK must follow this exact teaching sequence:
  1. Open with a one-sentence plain-English definition
  2. Build intuition with at least one analogy connecting the concept to something already familiar
  3. Explain the underlying "why" before the procedural "what"
  4. Close with a comprehension-check question that probes understanding, not recall
The <example> Output must demonstrate all four steps — definition → analogy → why → check question. It must NOT look like a reference answer; it must read like a teacher explaining out loud.`,
};

function buildOptimizerSystemMsg(domain, mode, examples, patternNotes, taskType = 'knowledge') {
  const ex = DOMAIN_EXAMPLES[domain] || DOMAIN_EXAMPLES.generic;
  const modeInstruction   = MODE_INSTRUCTIONS[mode]      || '';
  const modeOptimizerHint = MODE_OPTIMIZER_HINTS[mode]   || '';

  // Task-type hint: injected when Agent 1 classifies the task as reasoning- or knowledge-bound.
  // Research shows CoT dramatically improves logic/code tasks; knowledge tasks benefit more
  // from context clarity than instruction expansion.
  const taskTypeHint = taskType === 'reasoning'
    ? `TASK TYPE: reasoning-bound
→ ## TASK MUST include a "think step-by-step through 8–12 numbered reasoning steps" instruction.
→ The <example> Output must demonstrate numbered step-by-step reasoning, not a direct answer.`
    : `TASK TYPE: knowledge-bound
→ Prioritise context precision in ## CONTEXT — keep only facts directly required by ## TASK.
→ Do NOT expand ## TASK with extra instructions; retrieval clarity outweighs instruction complexity on factual tasks.`;

  const core = `\
⚠️ CRITICAL — READ BEFORE ANYTHING ELSE:
You are a PROMPT REWRITER + EXEMPLAR GENERATOR. You do NOT answer questions. You do NOT give advice.
Your ONLY job: (1) rewrite the rough prompt as a better prompt, (2) write one sample input-output pair.
If you find yourself answering the prompt, STOP — rewrite the prompt itself instead.

${taskTypeHint}
${modeOptimizerHint ? `\n${modeOptimizerHint}\n` : ''}
OUTPUT FORMAT — return EXACTLY this 4-block structure, nothing else:

## ROLE
You are a [specific role] with [X] years experience in [exact domain/technology].

## CONTEXT
[2-3 sentences: domain, key facts from TASK/CONTEXT/TECH fields, what a perfect response accomplishes — use verbatim names/errors/versions from context, never generalise]

## TASK
1. [primary instruction — verb-driven: List / Rank / Identify / Write / Explain / Compare / Debug / Review / Generate / Summarize]
2. [secondary constraint: scope limit, comparison axis, or quality rule]
3. [tertiary constraint]${modeInstruction ? `\n4. "${modeInstruction}."` : ''}

## OUTPUT FORMAT
<[tag]>
[format specification — e.g. Issue → Impact → Fix / JSON schema / column layout]
</[tag]>

Choose [tag] from: bullets · numbered-list · json · table · code-block · prose · structured-list · layered-explanation

<example>
Input: [a realistic user message this rewritten prompt would receive]
Output: [the ideal expert response — uses the exact tag format above, specific, 3-8 lines]
</example>

JOINT OPTIMIZATION — instructions and <example> form a single program:
The tone and constraints in ## TASK MUST be strictly demonstrated by the <example> Output.
If ## TASK says "be concise"        → <example> Output must be ≤ 3 lines.
If ## TASK says "think step-by-step" → <example> Output must show numbered steps.
If ## TASK says "use a table"        → <example> Output must be a markdown table.
Mismatched instruction/example is an invalid output — treat it like a syntax error.

HOW TO USE CONTEXT:
The user message includes structured context fields (TASK, CONTEXT, TECH, etc.) and the last Claude response.
EVIDENCE (verbatim from conversation): if present, this is the single most specific piece of raw evidence — an exact error message, exact function name, or exact code fragment copied verbatim from the chat. It MUST appear quoted in ## CONTEXT. Do not paraphrase it. Do not generalise it.
Every specific detail — exact file names, error messages, variable names, technologies, versions — MUST appear in ## CONTEXT.
The <example> Input/Output must also reflect these specifics, not generic placeholders.

WRONG: "## CONTEXT\nDomain: code. User wants code reviewed." (too vague — ignores specifics)
RIGHT: "## CONTEXT\nDomain: code. User is debugging process_dataframe() on 512MB AWS Lambda — runtime exceeds 45s. Previously tried increasing memory with no improvement."
EVIDENCE WRONG: paraphrasing 'MemoryError on line 42' as 'a runtime error'
EVIDENCE RIGHT: quoting it directly — "raises MemoryError on line 42"

NEVER: omit ## ROLE · use 'Determine' or 'Analyze' as first task verb · exceed 4 numbered items in ## TASK · omit XML tag in ## OUTPUT FORMAT · write generic ## CONTEXT when specifics are available · paraphrase EVIDENCE · write a generic role like "You are a helper" or "You are an AI assistant" — always write "You are a [specific job title] with [N] years experience in [domain]" even when context is sparse; infer the most plausible expert from the prompt's intent

DOMAIN EXAMPLE — input: '${ex.input}'
DOMAIN EXAMPLE — output:
${ex.output}

<example>
Input: ${ex.exemplar.input}
Output: ${ex.exemplar.output}
</example>

Return EXACTLY: the 4-block prompt (## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT) followed by one <example> block. No preamble, no explanation.`;

  if (examples.length === 0) return core;

  const exampleBlock = examples
    .map((ex, i) => `[EXAMPLE ${i + 1}]: ${ex.title}\n${ex.content.slice(0, 500)}`)
    .join('\n\n');
  const patternsLine = patternNotes.length > 0
    ? `\nThese examples use: ${patternNotes.join(', ')}.\n`
    : '';

  return `${core}

Use these ${examples.length} reference prompts from prompts.chat to inform the right expert role and output style:

${exampleBlock}${patternsLine}`;
}

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

/* ── Deduplicate by content fingerprint ─────────────── */

function dedup(prompts) {
  const seen = new Set();
  return prompts.filter(p => {
    const key = p.content.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
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
    // Meta-prompt words — these describe the act of prompting, not the topic,
    // so they pollute the prompts.chat search with prompt-engineering results.
    'prompt','prompts','system','claude','chatgpt','gpt','openai','anthropic',
    'optimize','optimise','rewrite','improve','generate','build',
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

  console.log('[PromptForge] Extracted keywords for prompts.chat search:', keywords);
  return keywords || prompt.slice(0, 60); // never send an empty query
}

/* ── Pattern analysis of prompts.chat results ───────── */

// Inspect the top fetched prompts and return notes about structural patterns
// they share — these notes go straight into the Groq system prompt.
function analyzePatterns(prompts) {
  const all = prompts.map(p => p.content);
  const match = (re) => all.some(c => re.test(c));

  const notes = [];
  if (match(/\byou are\b|\bact as\b|\byour role is\b/i))
    notes.push('role assignment ("You are an expert…")');
  if (match(/\bformat\b|\brespond in\b|\boutput\b|\bstructured\b|\blist\b/i))
    notes.push('structured output format');
  if (match(/\brules?:\b|\bconstraints?:\b|\bdo not\b|\bmust not\b|\balways\b/i))
    notes.push('explicit rules / constraints');
  if (match(/\{[^}]+\}|\[YOUR [A-Z]/))
    notes.push('placeholder variables');
  if (match(/\bstep[- ]by[- ]step\b|\bfirst[,.]?\s+then\b/i))
    notes.push('step-by-step instructions');
  if (match(/\bexample[s:]|\bfor instance\b|\be\.g\.\b/i))
    notes.push('worked examples');

  const avgLen = Math.round(all.reduce((s, c) => s + c.length, 0) / all.length);
  notes.push(`~${avgLen}-char length`);

  return notes;
}

/* ── Main orchestration ──────────────────────────────── */

async function handleOptimize({ prompt, category }) {
  // Build the search query (category prefix helps relevance)
  const query = [category, prompt].filter(Boolean).join(' ');

  // Fire both APIs in parallel; treat each as optional
  const [restSettled, mcpSettled] = await Promise.allSettled([
    searchPromptsREST(query, 8),
    searchPromptsMCP(query, 5),
  ]);

  let raw = [];

  const fromREST = restSettled.status === 'fulfilled';
  const fromMCP  = mcpSettled.status  === 'fulfilled';

  if (fromREST) raw.push(...restSettled.value);
  if (fromMCP)  raw.push(...mcpSettled.value);

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
    const apiNote = (!fromREST && !fromMCP)
      ? ' (API may be unreachable — check your internet connection)'
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
  };
}

/* ── Low-level Groq helper (used by all three pipeline agents) ───────── */

// extra: optional sampling overrides spread directly into the request body.
// Supports any Groq-compatible field — typically top_p or top_k.
// temperature is kept as a named param so all non-optimizer callers are unaffected.
async function groqCall(apiKey, model, systemContent, userContent, maxTokens = 512, debugLabel = null, temperature = 0.7, extra = {}) {
  const res = await fetch(GROQ_API, {
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
    console.log(`[${debugLabel} RAW response]:`, JSON.stringify(json));
    console.log(`[${debugLabel} parsed output]:`, text);
    console.log(`[${debugLabel} length]:`, text?.length);
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

/* ── Joint-Optimization cross-validator (post Agent 2) ───────────────── */
// Checks that the <example> Output in each candidate strictly demonstrates
// the constraints in ## TASK. If misaligned, the example is rewritten to match
// before the candidate reaches the Merger — eliminating mixed-signal failures.

async function crossValidateCandidate(apiKey, candidate) {
  const systemMsg = [
    'You are a Joint-Optimization validator. A prompt has a ## TASK block and an <example> block.',
    'Check whether the <example> Output STRICTLY demonstrates every constraint stated in ## TASK.',
    '',
    'Mismatches to detect:',
    '- ## TASK says "concise" / "3 bullets" / "one sentence" but <example> Output is verbose or multi-paragraph',
    '- ## TASK says "think step-by-step" / "numbered reasoning" but <example> Output jumps to a direct answer',
    '- ## TASK says "use a table" / specifies a format tag but <example> Output ignores it',
    '- ## TASK says "active verb openings" but <example> Output opens with passive or nominal constructions',
    '',
    'If the example IS consistent with all ## TASK constraints: output only the word ALIGNED',
    '',
    'If NOT consistent: output ONLY the corrected <example> block (Input unchanged, Output rewritten):',
    '<example>',
    'Input: [copy original Input line exactly]',
    'Output: [rewritten to strictly satisfy all ## TASK constraints — same domain/specificity, corrected format]',
    '</example>',
    '',
    'ALIGNED or corrected <example> block only — no preamble, no explanation.',
  ].join('\n');

  try {
    const result = await groqCall(apiKey, GROQ_PRUNER_MODEL, systemMsg, candidate, 400, 'Agent2-CrossValidate', 0.1);
    if (result.trim().toUpperCase().startsWith('ALIGNED')) return candidate;

    const fixedBlock = result.match(/<example>[\s\S]*?<\/example>/i);
    if (!fixedBlock) return candidate; // no parseable fix — keep original

    const patched = candidate.replace(/<example>[\s\S]*?<\/example>/i, fixedBlock[0].trim());
    if (patched !== candidate) {
      console.log('[PromptForge] Joint-Opt cross-validation: example patched for ## TASK alignment');
    }
    return patched;
  } catch {
    return candidate; // fail-open — never drop a candidate
  }
}

/* ── Three-agent optimization pipeline ──────────────────────────────── */

// tabId: chrome tab ID of the sender — used to push progress labels back.
// examples: normalised prompts.chat objects  { title, content }
// patternNotes: string[] from analyzePatterns()
async function runOptimizePipeline(apiKey, userPrompt, chatHistory, lastAssistantMessage, examples, patternNotes, tabId, mode = 'auto', answers = [], stylePlaybooks = {}) {

  // Send a progress label to the content script button
  const progress = (label) => {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { type: 'PIPELINE_PROGRESS', label }).catch(() => {});
    }
  };

  // ── Agent 1: Context Pruner + Domain Classifier (llama-3.1-8b-instant) ─
  progress('⚡ Pruning...');

  let prunedContext = 'NONE';
  let domain = 'generic';
  let taskType = 'knowledge'; // default; overridden by Agent 1 TASK_TYPE field

  // Run Agent 1 if we have EITHER full chat history OR at least lastAssistantMessage.
  // When structured DOM selectors fail, the broad fallback recovers lastAssistantMessage —
  // enough for Agent 1 to classify domain and extract intent from.
  if ((chatHistory && chatHistory.length > 0) || lastAssistantMessage) {
    const historyText = chatHistory.length > 0
      ? chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')
      : '[Chat history unavailable — structured selectors did not match the page DOM]';
    try {
      // Generic playbook applies at Agent 1 stage (domain unknown yet) — inform the GOAL field.
      // strategyDoc (ACE format) is richer than bullet rules; use it when available.
      const genericEntry    = normalizePlaybook(stylePlaybooks.generic);
      const styleRulesBlock = genericEntry.strategyDoc
        ? `\nUSER STRATEGY DOCUMENT (cross-domain preferences — factor into GOAL field):\n${genericEntry.strategyDoc}`
        : genericEntry.rules.length > 0
          ? `\nUSER-SPECIFIC STYLE RULES (cross-domain preferences — factor into GOAL field):\n${genericEntry.rules.map(r => `- ${r}`).join('\n')}`
          : '';

      const agent1Raw = await groqCall(
        apiKey,
        GROQ_PRUNER_MODEL,
        `You are a conversation analyst. Extract structured facts from the conversation.

Output EXACTLY this format — one field per line, no extra text:
DOMAIN: [code / writing / data / creative / research / meta / generic]
→ Use "meta" when the user's GOAL is to produce a reusable prompt, system prompt, or instruction set for an AI — i.e. the output of a successful response would itself be a prompt, not an answer. Examples: "write a system prompt that…", "make a prompt to help me…", "create instructions for Claude to…", "build a reusable prompt for…".
TASK_TYPE: [reasoning-bound → task requires multi-step logic, code, math, debugging, or algorithms / knowledge-bound → task requires facts, summaries, writing, definitions, or research]
TASK: [one sentence — what the user is currently trying to accomplish]
CONTEXT: [2-3 specific facts copied VERBATIM — exact file names, exact function names, exact error messages, exact URLs as they appear in the conversation. Do NOT paraphrase. Separate facts with " | ". Example: "process_dataframe() | MemoryError on line 42 | 512MB Lambda limit"]
EVIDENCE: [paste the single most specific piece of verbatim evidence from the conversation — an exact error message, an exact function signature, or an exact 1-2 line code fragment. Max 150 chars. Never paraphrase. "none" if no concrete evidence present]
TRIED: [what has already been attempted or ruled out — "none" if nothing]
GOAL: [what a perfect Claude response would accomplish for the user — factor in any User-Specific Style Rules below]
TECH: [exact languages, frameworks, libraries, tools, versions — "none" if not applicable]

Rules: Copy exact names, numbers, and error messages. Never substitute "some function" for the real function name. Never write "the user's code" when you can write the actual function name.
If history is empty, output all fields as "none" except DOMAIN which must be "generic" and TASK_TYPE which must be "knowledge-bound".${styleRulesBlock}`,
        chatHistory.length > 0
          ? `User's new prompt: "${userPrompt}"\n\nConversation history:\n${historyText}`
          : `User's new prompt: "${userPrompt}"\n\nLast AI response (full chat history unavailable — use this to infer domain, task, and any verbatim evidence):\n${lastAssistantMessage}`,
        900,
      );

      // Parse structured key-value output
      const fields = {};
      for (const line of agent1Raw.trim().split('\n')) {
        const m = line.match(/^(DOMAIN|TASK_TYPE|TASK|CONTEXT|EVIDENCE|TRIED|GOAL|TECH):\s*(.+)/i);
        if (m) fields[m[1].toUpperCase()] = m[2].trim();
      }

      domain = (fields.DOMAIN || 'generic').toLowerCase();
      if (!DOMAIN_EXAMPLES[domain]) domain = 'generic';
      taskType = (fields.TASK_TYPE || '').toLowerCase().includes('reasoning') ? 'reasoning' : 'knowledge';
      console.log('[PromptForge] Agent 1 task type:', taskType);

      // Build a structured context block for Agent 2 — each field clearly labelled.
      // EVIDENCE goes first: it's the most specific verbatim detail from the conversation
      // and should be the highest-priority anchor for Agent 2's ## CONTEXT block.
      const ctxPieces = [];
      if (fields.EVIDENCE && fields.EVIDENCE !== 'none') ctxPieces.push(`EVIDENCE (verbatim from conversation): ${fields.EVIDENCE}`);
      if (fields.TASK    && fields.TASK    !== 'none') ctxPieces.push(`TASK: ${fields.TASK}`);
      if (fields.CONTEXT && fields.CONTEXT !== 'none') ctxPieces.push(`CONTEXT: ${fields.CONTEXT}`);
      if (fields.TRIED   && fields.TRIED   !== 'none') ctxPieces.push(`TRIED: ${fields.TRIED}`);
      if (fields.GOAL    && fields.GOAL    !== 'none') ctxPieces.push(`GOAL: ${fields.GOAL}`);
      if (fields.TECH    && fields.TECH    !== 'none') ctxPieces.push(`TECH: ${fields.TECH}`);
      prunedContext = ctxPieces.length > 0 ? ctxPieces.join('\n') : 'NONE';

      console.log('[PromptForge] Agent 1 domain:', domain);
      console.log('[PromptForge] Agent 1 structured context:\n', prunedContext);
    } catch (err) {
      console.warn('[PromptForge] Agent 1 failed, continuing without context:', err.message);
    }
  }

  // ── Agent 2: Prompt Optimizer ×3 in parallel (llama-3.3-70b-versatile) ─
  // High temperature for variety; best-of-3 dramatically improves quality.
  progress('⚡ Optimizing (×3)...');

  const optimizerSystemMsg = buildOptimizerSystemMsg(domain, mode, examples, patternNotes, taskType);
  console.log('[PromptForge Agent2 system prompt]:', optimizerSystemMsg);

  // The prompt-to-rewrite goes in the USER message (never in the system prompt)
  // so models can't confuse "execute this" with "rewrite this".
  // Context is structured so Agent 2 can read each field directly.
  const ctxLines = [];
  if (prunedContext !== 'NONE')  ctxLines.push(prunedContext); // already key-value formatted by Agent 1
  if (lastAssistantMessage)      ctxLines.push(`LAST CLAUDE RESPONSE (what the user is most likely referring to):\n${lastAssistantMessage.slice(0, 2000)}`);
  if (answers.length > 0)        ctxLines.push(`USER'S STATED INTENT:\n${answers.join('\n\n')}`);
  // Domain playbook takes priority; fall back to generic when no domain-specific entry exists.
  // strategyDoc (ACE format) injects a coherent narrative instead of a bullet list.
  const domainEntry    = normalizePlaybook(stylePlaybooks[domain] || stylePlaybooks.generic);
  const styleInjection = domainEntry.strategyDoc
    ? `USER STRATEGY DOCUMENT — ${domain} domain (apply to ## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT):\n${domainEntry.strategyDoc}`
    : domainEntry.rules.length > 0
      ? `USER-SPECIFIC STYLE RULES — ${domain} domain (apply to ## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT):\n${domainEntry.rules.map(r => `- ${r}`).join('\n')}`
      : null;
  if (styleInjection) ctxLines.push(styleInjection);

  const contextBlock = ctxLines.length > 0
    ? `\n\nContext — incorporate every specific detail into the rewrite:\n${ctxLines.join('\n\n')}`
    : '';
  const optimizerUser = `Rewrite this prompt:\n"${userPrompt}"${contextBlock}`;

  // Merge base diversity profile with any mode-specific temperature override.
  // Spread order: base first, then mode — temperature is replaced, top_p/top_k preserved.
  // This keeps each optimizer's structural identity (nucleus vs top-k) under all modes.
  const modeOverride = AGENT2_PARAMS[mode] || [];
  const [paramsA, paramsB, paramsC] = AGENT2_PARAMS.default.map((base, i) => ({
    ...base,
    ...(modeOverride[i] || {}),
  }));

  // Destructure temperature out so it stays in the named param slot;
  // the rest (top_p / top_k) spreads into groqCall's extra argument.
  const { temperature: tempA, ...extraA } = paramsA;  // Conservative: top_p
  const { temperature: tempB, ...extraB } = paramsB;  // Creative:     top_p
  const { temperature: tempC, ...extraC } = paramsC;  // Diverse:      top_k

  // Token cap: Brief mode caps at 800 (short prompt + compact example); others get 1500.
  const agent2Tokens = mode === 'brief' ? 800 : 1500;

  const agent2Results = await Promise.allSettled([
    groqCall(apiKey, GROQ_OPTIMIZER_MODEL, optimizerSystemMsg, optimizerUser, agent2Tokens, 'Optimizer1-Conservative', tempA, extraA),
    groqCall(apiKey, GROQ_OPTIMIZER_MODEL, optimizerSystemMsg, optimizerUser, agent2Tokens, 'Optimizer2-Creative',     tempB, extraB),
    groqCall(apiKey, GROQ_DIVERSITY_MODEL, optimizerSystemMsg, optimizerUser, agent2Tokens, 'Optimizer3-Diverse',      tempC, extraC),
  ]);

  const rawCandidates = agent2Results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  // Helper: does this text look like a 4-block rewritten prompt (vs an answer)?
  // Valid rewrites open with the ## ROLE block header.
  const isRewrite = (text) => /^##\s*ROLE\b/i.test(text.trim());

  const candidates = rawCandidates.filter(c => {
    const ok = isRewrite(c);
    if (!ok) console.warn('[PromptForge] Discarded candidate (looks like an answer):', c.slice(0, 100));
    return ok;
  });

  // If ALL candidates failed, the models are misbehaving — throw so the user sees an error
  // rather than silently passing answers downstream.
  if (candidates.length === 0) {
    console.error('[PromptForge] All Agent 2 candidates look like answers, not rewrites. Raw outputs:', rawCandidates);
    throw new Error('Optimization failed — models answered instead of rewriting. Try again or reload the extension.');
  }

  if (candidates.length === 0) throw new Error('All Agent 2 calls failed');
  candidates.forEach((c, i) => console.log(`[Agent2 candidate ${i + 1}]:`, c));

  // ── Joint-Optimization cross-validation ─────────────────────────────────
  // Ensures <example> Output in each candidate strictly demonstrates ## TASK constraints.
  // Runs in parallel — one cross-validate call per candidate, using the fast 8b model.
  progress('⚡ Cross-validating...');
  const finalCandidates = await Promise.all(candidates.map(c => crossValidateCandidate(apiKey, c)));

  // Skip the merger if only one candidate came back
  if (finalCandidates.length === 1) return { text: finalCandidates[0], rationale: '' };

  // ── Agent 3: Pairwise LLM-as-Judge with Explain-First prompting ──────────
  // Uses pairwise evaluation (A vs B → winner vs C) to avoid position and verbosity bias.
  // Explain-First: REASONING RATIONALE is generated before the final prompt, forcing
  // the model to commit to a logical argument before synthesising — not after.
  progress('⚡ Evaluating (pairwise)...');

  const mergerSystemMsg = [
    `You are a prompt quality judge. Below are ${finalCandidates.length} candidate REWRITES (A, B, C) each in 4-block format (## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT) followed by an <example> block.`,
    '',
    'Execute these four steps in order — do NOT skip or merge steps:',
    '',
    'STEP 1 — Compare Candidate A vs Candidate B on three dimensions:',
    '  1. Role specificity (## ROLE)',
    '  2. Context completeness and signal-to-noise ratio (## CONTEXT)',
    '  3. Task clarity and instruction precision (## TASK + ## OUTPUT FORMAT)',
    'One sentence per dimension stating which wins and why. Declare Round 1 winner.',
    '',
    'STEP 2 — Compare Round 1 winner vs Candidate C on the same three dimensions.',
    'Declare Final winner.',
    '',
    'STEP 3 — BELIEF INSPECTION:',
    'Review every candidate for "hallucinated intent" — constraints, assumptions, or details that were NOT present in the user\'s original rough prompt.',
    'A candidate hallucinates intent when it adds role seniority ("15 years experience"), domain specificity ("AWS Lambda"), output scope ("top 5"), or task complexity that the rough prompt never mentioned.',
    'List each hallucinated assumption found across all candidates.',
    'The final synthesised prompt must NOT include any hallucinated assumption — strip them, keep only what the rough prompt verifiably implies.',
    '',
    'STEP 4 — Synthesise: use the Final winner as base. If a losing candidate has one clearly superior block, incorporate it. Apply Belief Inspection — remove any hallucinated assumptions.',
    '',
    'OUTPUT FORMAT — return EXACTLY this structure:',
    '',
    'REASONING RATIONALE:',
    'Round 1 (A vs B): [role → winner | context → winner | task → winner | Overall: X]',
    'Round 2 ([winner] vs C): [role → winner | context → winner | task → winner | Overall: X]',
    'Belief Inspection: [list hallucinated assumptions found, e.g. "C assumed AWS Lambda (not in rough prompt)" — or "none"]',
    'Discarded: [what was removed from final prompt because unverifiable — or "none"]',
    'Synthesis: [what was borrowed from a losing candidate, or "none"]',
    '',
    '## ROLE',
    '[synthesised role — "You are a…"]',
    '',
    '## CONTEXT',
    '[synthesised context — 2-3 sentences with all specific details]',
    '',
    '## TASK',
    '1. [primary instruction]',
    '2. [secondary instruction]',
    '3. [tertiary instruction or mode constraint]',
    '',
    '## OUTPUT FORMAT',
    '<[tag]>',
    '[format specification]',
    '</[tag]>',
    '',
    '<example>',
    '[best example block — verbatim from any candidate]',
    '</example>',
    '',
    'REASONING RATIONALE must appear first. ## ROLE must immediately follow. No preamble outside this structure.',
    '',
    ...finalCandidates.map((c, i) => `Candidate ${String.fromCharCode(65 + i)}:\n${c}`),
  ].join('\n');

  const mergerRaw = await groqCall(
    apiKey, GROQ_OPTIMIZER_MODEL, mergerSystemMsg,
    `Original rough prompt (for Belief Inspection — discard any candidate assumption not grounded here):\n"${userPrompt}"\n\nRun the pairwise evaluation, perform Belief Inspection, then synthesise the final prompt.`,
    2200, 'Agent3', 0.1,
  );

  // Explain-First output begins with REASONING RATIONALE — extract and log it,
  // then slice from ## ROLE for the actual 4-block prompt.
  const roleIdx = mergerRaw.indexOf('## ROLE');
  if (roleIdx > 0) {
    console.log('[PromptForge] Agent 3 pairwise reasoning:\n', mergerRaw.slice(0, roleIdx).trim());
  }
  const mergedPrompt = roleIdx !== -1 ? mergerRaw.slice(roleIdx).trim() : mergerRaw;
  const finalResult = isRewrite(mergedPrompt)
    ? mergedPrompt
    : (console.warn('[PromptForge] Agent 3 dropped role line, using best candidate'), finalCandidates[0]);

  // ── Agent 4: Textual Gradient — Root-Cause Analysis ─────────────────────
  // Instead of directly patching the merged prompt, Agent 4 produces a
  // structured critique (the "gradient") that explains WHY a specific
  // constraint is likely to be ignored or hallucinated by Claude.
  // This gradient is then fed back to the Merger (Agent 3b) as a targeted
  // fix signal — creating a logical, traceable bridge between the merged
  // output and the final polished version.
  progress('⚡ Analysing...');

  let gradient = null;
  try {
    const gradientSystemMsg = [
      'You are a prompt robustness analyst. Your job is failure mode analysis only — do NOT rewrite the prompt.',
      '',
      'The input is a structured prompt: ## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT + <example>.',
      '',
      'STEP 0 — FAILURE MODE SIMULATION (perform internally, do not output):',
      'Simulate three distinct user mindsets reading this prompt:',
      '  RUSHED USER: Will they skip nuanced or multi-part instructions and take the path of least resistance?',
      '  SKEPTICAL USER: Does the methodology or instruction sequence contain logical gaps that would withstand scrutiny?',
      '  CREATIVE USER: Could someone use this prompt for an unintended purpose that produces a wrong or unhelpful response?',
      'Identify which mindset exposes the MOST FRAGILE point in this prompt.',
      'Your FIX DIRECTION must prioritise making the prompt robust against that mindset — "idiot-proof" for the most likely misuse.',
      '',
      'STEP 1 — GENERATOR-RETRIEVER DISCONNECT CHECK:',
      'Examine whether ## CONTEXT contains phrases irrelevant or tangential to ## TASK.',
      'If a disconnect is found, output:',
      '  CONSTRAINT: [## CONTEXT] "[quote the noisy phrase]"',
      '  ROOT CAUSE: Generator-Retriever disconnect — ## CONTEXT dilutes task signal with irrelevant information',
      '  FIX DIRECTION: Remove "[noisy phrase]" from ## CONTEXT; retain only what ## TASK explicitly requires',
      '',
      'STEP 2 — If NO disconnect: identify the single constraint most fragile under Failure Mode Simulation.',
      'Output:',
      '  CONSTRAINT: [## BLOCKNAME] "[quote the exact phrase most at risk]"',
      '  ROOT CAUSE: [one sentence — why this fails under the identified mindset]',
      '  FIX DIRECTION: [one sentence — the minimal, idiot-proofing edit that closes this failure mode]',
      '',
      'Always output EXACTLY three lines: CONSTRAINT / ROOT CAUSE / FIX DIRECTION — no step labels, no preamble.',
    ].join('\n');

    gradient = await groqCall(
      apiKey, GROQ_PRUNER_MODEL, gradientSystemMsg, finalResult, 200, 'Agent4-Gradient', 0.1,
    );
    console.log('[PromptForge] Agent 4 textual gradient:\n', gradient);
  } catch (err) {
    console.warn('[PromptForge] Agent 4 gradient failed:', err.message);
  }

  // ── Agent 3b: Gradient Application — Merger patches its own output ────────
  // The Merger receives its original merged prompt + the critic's root-cause
  // gradient and applies the targeted fix. Changing only what the gradient
  // identifies keeps the rest of the merge intact and ensures the final
  // output is a direct, traceable improvement over the merged version.
  progress('⚡ Polishing...');

  let polishedResult = finalResult;
  if (gradient) {
    try {
      const applySystemMsg = [
        'You are a prompt synthesis expert. You previously merged several candidates into a 4-block structured prompt.',
        'A root-cause analysis (textual gradient) has pinpointed the single biggest failure risk in one specific block.',
        '',
        'Apply the FIX DIRECTION to patch only the identified block (## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT).',
        'All other blocks must be copied UNCHANGED. The <example> block must always be copied UNCHANGED.',
        'Change as little as possible — surgical fix only.',
        '',
        'REQUIRED OUTPUT FORMAT — return the full 4-block structure + <example>:',
        '',
        '## ROLE',
        '[unchanged unless gradient targets ## ROLE]',
        '',
        '## CONTEXT',
        '[unchanged unless gradient targets ## CONTEXT]',
        '',
        '## TASK',
        '[unchanged unless gradient targets ## TASK]',
        '',
        '## OUTPUT FORMAT',
        '[unchanged unless gradient targets ## OUTPUT FORMAT]',
        '',
        '<example>',
        '[original example — always unchanged]',
        '</example>',
        '',
        '## ROLE must remain the first line and start with "You are a". No explanation, no label, no preamble.',
      ].join('\n');

      const applyUser = `MERGED PROMPT:\n${finalResult}\n\nTEXTUAL GRADIENT (root-cause analysis):\n${gradient}`;
      const agent3bRaw = await groqCall(
        apiKey, GROQ_OPTIMIZER_MODEL, applySystemMsg, applyUser, 1500, 'Agent3b', 0.1,
      );
      if (isRewrite(agent3bRaw)) {
        polishedResult = agent3bRaw;
      } else {
        console.warn('[PromptForge] Agent 3b dropped role line, keeping Agent 3 result');
      }
    } catch (err) {
      console.warn('[PromptForge] Agent 3b (gradient apply) failed, using Agent 3 result:', err.message);
    }
  }

  // ── "Why" rationale — one sentence explaining the most important change ──
  // Run in parallel with chain generation when in chain mode, solo otherwise.
  progress('⚡ Explaining...');

  const whySystemMsg = `Given an ORIGINAL and an OPTIMIZED prompt, write ONE sentence (max 18 words) naming the single most important change and why it matters. Lead with what changed. No preamble. Example: "Replaced 'help me' with 'List' — action verbs constrain output and prevent vague responses."`;
  const whyUser = `ORIGINAL: "${userPrompt}"\n\nOPTIMIZED:\n${polishedResult}`;

  if (mode === 'chain') {
    // Skeleton-of-Thought (SoT) chain mode:
    // Phase 1: 8b model generates a task-specific skeleton of thinking questions.
    // Phase 2: 70b model refines each skeleton point in parallel.
    // Phase 3: role line + refined points are merged into a structured priming prompt.
    // The user sends the priming prompt first → Claude answers the skeleton → user sends the main prompt.
    progress('⚡ Building chain (SoT)...');

    const skeletonSystemMsg = [
      'You are a Skeleton-of-Thought prompt designer. Given a structured task prompt,',
      'generate 4-6 specific thinking questions Claude must answer BEFORE starting the task.',
      '',
      'Rules:',
      '- Questions must be TASK-SPECIFIC — banned: "What are your goals?", "What format do you want?"',
      '- Each question targets a distinct knowledge or reasoning gap for this exact task',
      '- Answering all questions in sequence builds a complete mental scaffold',
      '- Max 12 words per question',
      '',
      'Return ONLY a numbered list of questions. No preamble, no explanation.',
    ].join('\n');

    // Phase 1: skeleton + rationale in parallel (both use fast 8b model)
    const [whySettled, skeletonSettled] = await Promise.allSettled([
      groqCall(apiKey, GROQ_PRUNER_MODEL, whySystemMsg, whyUser, 80, 'AgentWhy', 0.2),
      groqCall(apiKey, GROQ_PRUNER_MODEL, skeletonSystemMsg, polishedResult, 250, 'AgentChain-Skeleton', 0.2),
    ]);

    const rationale = whySettled.status === 'fulfilled' ? whySettled.value : '';

    if (skeletonSettled.status === 'fulfilled') {
      const skeletonPoints = skeletonSettled.value
        .split('\n')
        .map(l => l.replace(/^\d+\.\s*/, '').trim())
        .filter(p => p.length > 8 && p.length < 120)
        .slice(0, 6);

      console.log('[PromptForge] Chain SoT skeleton:', skeletonPoints);

      if (skeletonPoints.length >= 3) {
        // Phase 2: parallel expansion — 70b refines each skeleton question to be more precise
        const expandSettled = await Promise.allSettled(
          skeletonPoints.map((point, i) =>
            groqCall(
              apiKey, GROQ_OPTIMIZER_MODEL,
              'Rewrite this thinking question to be more specific and precise for the given task (max 15 words). Return ONLY the rewritten question.',
              `Task context:\n${polishedResult.slice(0, 400)}\n\nQuestion to refine: "${point}"`,
              45, `AgentChain-Expand${i + 1}`, 0.2,
            )
          )
        );

        // Fall back to raw skeleton point if any expansion fails
        const refinedPoints = expandSettled.map((r, i) =>
          r.status === 'fulfilled' ? r.value.trim() : skeletonPoints[i]
        );

        // Phase 3: merge — extract role line and compose the structured priming prompt
        const roleMatch  = polishedResult.match(/^##\s*ROLE\s*\n+(.+)/m);
        const roleLine   = roleMatch ? roleMatch[1].trim() : 'You are an expert assistant';
        const numbered   = refinedPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
        const priming    = `${roleLine}\n\nBefore the main task, briefly answer these skeleton questions (one sentence each):\n\n${numbered}\n\n(Reply with your skeleton answers — I'll send the full task next.)`;

        return { text: `${priming}\n\n---CHAIN→---\n\n${polishedResult}`, rationale };
      }
    }

    // Fallback: original simple priming — runs if skeleton has < 3 points or fails
    console.warn('[PromptForge] Chain SoT skeleton insufficient, falling back to simple priming');
    const chainSystemMsg = [
      'You are a prompt chain designer. Given a main task prompt, write a SHORT priming prompt to send FIRST (2 lines max).',
      'The priming prompt must:',
      '1. Use the same expert role from the main prompt',
      '2. Ask Claude to outline or think through the approach BEFORE doing the actual task',
      '3. NOT begin the actual task itself',
      'Return ONLY the priming prompt. No explanation, no label.',
    ].join('\n');

    let chainPriming = null;
    try {
      chainPriming = await groqCall(apiKey, GROQ_OPTIMIZER_MODEL, chainSystemMsg, polishedResult, 256, 'AgentChain', 0.3);
    } catch (err) {
      console.warn('[PromptForge] Chain fallback generation failed:', err.message);
    }

    if (chainPriming) return { text: `${chainPriming}\n\n---CHAIN→---\n\n${polishedResult}`, rationale };
    console.warn('[PromptForge] Chain generation failed, returning single prompt');
    return { text: polishedResult, rationale };
  }

  // Non-chain: just generate rationale
  let rationale = '';
  try {
    rationale = await groqCall(apiKey, GROQ_PRUNER_MODEL, whySystemMsg, whyUser, 80, 'AgentWhy', 0.2);
  } catch (err) {
    console.warn('[PromptForge] Rationale generation failed:', err.message);
  }

  return { text: polishedResult, rationale };
}

/* ── OPTIMIZE_WITH_CONTEXT handler (content script → background) ─────── */

async function handleOptimizeWithContext({ prompt, chatHistory = [], lastAssistantMessage = null, mode = 'auto', answers = [] }, tabId) {

  // 1. API key
  const stored = await chrome.storage.sync.get('groqApiKey');
  const apiKey = stored.groqApiKey;
  if (!apiKey) throw new Error('NO_API_KEY');

  // 2. Extract search keywords from the prompt + recent context
  const keywords = extractKeywords(prompt, chatHistory);

  // 3. Search prompts.chat for real matching prompts, sorted by score
  let examples = [];
  try {
    // Ask for 8 so we have room to sort and still get 3 good ones
    // &sort=votes is passed optimistically — ignored if unsupported
    const raw = await searchPromptsREST(keywords, 8);

    // Client-side sort by any vote/score field the API may return
    raw.sort((a, b) => {
      const score = r => r.votes ?? r.likes ?? r.upvotes ?? r.stars ?? r.score ?? 0;
      return score(b) - score(a);
    });

    examples = raw.map(normalizePrompt).filter(Boolean).slice(0, 3);
    console.log('[PromptForge] prompts.chat examples fetched:',
      examples.map(e => `"${e.title}"`).join(', ') || '(none)');
  } catch (err) {
    console.warn('[PromptForge] prompts.chat search failed:', err.message);
    // Proceed without examples — Groq will still rewrite, just without models
  }

  // 4. Analyse structural patterns in the fetched prompts
  const patternNotes = examples.length > 0 ? analyzePatterns(examples) : [];
  if (patternNotes.length > 0)
    console.log('[PromptForge] patterns detected:', patternNotes.join(', '));

  // 5. Load domain-keyed style playbooks accumulated from past user edits
  const { pfStylePlaybooks: stylePlaybooks = {}, pfStyleRules: legacyRules } =
    await chrome.storage.local.get(['pfStylePlaybooks', 'pfStyleRules']);

  // One-time migration: move legacy flat pfStyleRules into pfStylePlaybooks.generic
  if (legacyRules && legacyRules.length > 0 && !stylePlaybooks.generic) {
    stylePlaybooks.generic = legacyRules;
    await chrome.storage.local.set({ pfStylePlaybooks: stylePlaybooks });
    await chrome.storage.local.remove('pfStyleRules');
    console.log('[PromptForge] Migrated pfStyleRules → pfStylePlaybooks.generic');
  }

  const totalRules = Object.values(stylePlaybooks).flat().length;
  if (totalRules > 0)
    console.log('[PromptForge] Applying user style playbooks:', stylePlaybooks);

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
    'You are converting a one-time prompt into a reusable Claude system prompt for Claude Projects.',
    'Extract ONLY the permanent parts — role, expertise level, response style, output format preferences.',
    'Do NOT include anything task-specific (the actual request the user made).',
    'Write 3-5 lines starting with "You are…" that the user can set once and never repeat.',
    'Return ONLY the system prompt text, no explanation, no label.',
  ].join('\n');

  return await groqCall(
    apiKey, GROQ_PRUNER_MODEL, systemMsg,
    `Optimized prompt:\n${optimizedPrompt}`,
    300, 'AgentSysPrompt', 0.3,
  );
}

/* ── GENERATE_QUESTIONS handler (Agent 0) ───────────────────────────── */
// Uses the fast 8b model to produce 2 short clarifying questions specific to
// the user's input. Called before the main pipeline in 'guided' mode.

async function handleGenerateQuestions({ prompt, chatHistory = [], lastAssistantMessage = null }) {
  const stored = await chrome.storage.sync.get('groqApiKey');
  const apiKey = stored.groqApiKey;
  if (!apiKey) throw new Error('NO_API_KEY');

  const historyText = chatHistory.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');

  const systemMsg = `You are a prompt clarification specialist. Given a rough user prompt and conversation context, generate exactly 2 questions whose answers would MOST improve the rewritten prompt.

Step 1 (silently): Identify the domain from context — code / writing / data / creative / research / other.
Step 2: Ask questions targeted to that domain.

FOR CODE tasks ask about: exact language+version, specific error/constraint, input→output format, performance target
FOR WRITING tasks ask about: target audience and their expertise, tone (formal/casual/persuasive), length or publication
FOR DATA tasks ask about: what format the data is in, what decision the analysis should support
FOR CREATIVE tasks ask about: specific style/genre/inspiration, key constraint or mood
FOR LEARNING tasks ask about: current knowledge level, whether they want theory vs hands-on examples
FOR OTHER tasks ask about: scope/deadline constraint, specific format needed

GOOD questions (specific, change the output meaningfully):
- "Which Python version and library — and is the bottleneck CPU, memory, or I/O?" ✓
- "Is this for a technical blog post or an internal Slack summary, and how long?" ✓
- "Should the explanation use analogies for a beginner or assume production experience?" ✓

BAD questions (generic, waste the user's time):
- "What is your goal?" ✗  "Who is your audience?" ✗  "What format do you want?" ✗

Return ONLY 2 questions, one per line, no numbering, no labels, no preamble.`;

  const contextParts = [`User's prompt: "${prompt}"`];
  if (lastAssistantMessage) contextParts.push(`Last Claude response (what the user likely refers to):\n${lastAssistantMessage.slice(0, 600)}`);
  if (historyText) contextParts.push(`Recent conversation:\n${historyText}`);
  const userMsg = contextParts.join('\n\n');

  const raw = await groqCall(apiKey, GROQ_PRUNER_MODEL, systemMsg, userMsg, 180, 'Agent0');

  const questions = raw
    .split('\n')
    .map(q => q.replace(/^[\d.\-*]+\s*/, '').trim())
    .filter(q => q.length > 5)
    .slice(0, 2);

  if (questions.length === 0) throw new Error('Could not generate questions');
  return questions;
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
    '- Reference the 4-block structure when relevant (## ROLE / ## CONTEXT / ## TASK / ## OUTPUT FORMAT)',
    '- Describe a structural or linguistic pattern — NOT topic content',
    '',
    'GOOD: "Avoids specifying years of experience in ## ROLE — uses \'You are an expert X\' phrasing instead"',
    'GOOD: "Rewrites ## TASK as 2 items rather than 3 — prefers brevity over exhaustiveness"',
    'GOOD: "Uses <prose> tag instead of <numbered-list> in ## OUTPUT FORMAT for this domain"',
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

  // Extract domain from ## CONTEXT block (Agent 2 always writes "Domain: X" there)
  const domainMatch = optimized.match(/##\s*CONTEXT[\s\S]*?Domain:\s*(code|writing|data|creative|research|generic)/i);
  const domain = domainMatch ? domainMatch[1].toLowerCase() : 'generic';

  const newRules = await runAgentTrajectory(apiKey, optimized, userEdited, domain);
  if (newRules.length === 0) {
    console.log('[PromptForge] Trajectory: delta too small — no style rules extracted');
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
      console.log(`[PromptForge] ACE: synthesised ${domain} strategy doc →`, strategyDoc);
    } catch (err) {
      console.warn('[PromptForge] ACE strategy doc synthesis failed:', err.message);
    }
  }

  const updated = { ...existing, [domain]: { rules: updatedRules, strategyDoc } };
  await chrome.storage.local.set({ pfStylePlaybooks: updated });
  console.log(`[PromptForge] Trajectory: ${domain} playbook updated →`, updatedRules);
}

/* ── Message listener ────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  // Content script: guided mode — generate 2 clarifying questions
  if (message.type === 'GENERATE_QUESTIONS') {
    handleGenerateQuestions(message.payload)
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

  // Content script: open the options/settings page
  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return false;
  }

  return false;
});
