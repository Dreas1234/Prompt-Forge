# Prompt Forge

A Chrome extension that finds and surfaces professionally-crafted AI prompts from [prompts.chat](https://prompts.chat) based on what you're trying to do.

## What it does

1. You type what you want (e.g. *"help me write a cold email"*)
2. It searches prompts.chat via their REST API and MCP endpoint in parallel
3. The best-matching curated prompt is shown as the **Optimized Prompt**
4. Up to 4 related prompts appear below as inspiration — all one-click copyable

## Install (no build step required)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `prompt-forge/` folder
5. The Prompt Forge icon appears in your toolbar — click it to open

## How to use

| Step | Action |
|------|--------|
| 1 | Type or paste your prompt idea in the textarea |
| 2 | Optionally select a **context filter** chip (Coding, Writing, Marketing…) |
| 3 | Click **Optimize Prompt** or press **Ctrl+Enter** / **Cmd+Enter** |
| 4 | Click **Copy** to copy the optimized prompt to your clipboard |
| 5 | Browse **Related Prompts** and click any to copy it |

## APIs used

| Endpoint | Purpose |
|----------|---------|
| `GET https://prompts.chat/api/prompts?q={query}&perPage=8` | Search the curated prompt library |
| `POST https://prompts.chat/api/mcp` | MCP JSON-RPC `search_prompts` call for additional results |

Both calls run in parallel. If either fails the extension gracefully falls back to whatever results are available.

## File structure

```
prompt-forge/
├── manifest.json     — MV3 extension manifest
├── popup.html        — Extension popup UI
├── popup.js          — UI logic (zero dependencies)
├── background.js     — Service worker; makes API calls
├── styles.css        — Dark purple theme
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Troubleshooting

**No results returned**
- Try removing the category filter and using broader keywords
- The prompts.chat API may occasionally be unavailable; try again in a moment

**Extension icon not showing**
- After loading unpacked, click the puzzle-piece icon in the Chrome toolbar and pin Prompt Forge

**Popup says "Unexpected error"**
- Open DevTools → Extensions → Inspect the service worker for background.js logs
- Open the popup's DevTools (right-click popup → Inspect) for frontend logs

## Permissions

- `host_permissions: https://prompts.chat/*` — required so the service worker can fetch from prompts.chat without CORS restrictions. No other permissions are requested.
- No data is stored, no analytics, no external services beyond prompts.chat.
