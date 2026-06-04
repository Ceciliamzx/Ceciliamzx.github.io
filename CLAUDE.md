# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**London Uncovered（读懂伦敦）** — A bilingual (zh/en) AI cultural assistant for students, visitors, and global workers in London. Deployed on Vercel with a serverless Node.js backend and static frontend.

## Commands

```bash
# Install dependencies
npm install

# Run locally (backend only — requires env vars)
npm start          # node api/index.js on port 3000

# Deploy
vercel             # preview deploy
vercel --prod      # production deploy
```

No test suite exists yet. No linter is configured.

## Required Environment Variables

Set these in Vercel project settings or a local `.env`:

```
DEEPSEEK_API_KEY=...        # DeepSeek chat API key
KV_URL=...                  # Vercel KV (Redis) connection string
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
```

## Architecture

### Stack
- **Backend**: Express.js serverless function (`api/index.js`) — exported as `module.exports = app`, not `app.listen()`
- **Frontend**: Vanilla JS single-page HTML files (`public/index.html`, `public/admin.html`) — no build step, no framework
- **Storage**: Vercel KV (Redis-compatible) via `@vercel/kv`
- **LLM**: DeepSeek Chat API via the `openai` SDK (same interface, different `baseURL`)
- **Hosting**: Vercel — routes defined in `vercel.json`

### Request Flow (Chat)

```
POST /api/chat  { question, lang, mode, sessionId }
  1. Load session history from KV  (key: session:{sessionId})
  2. runAgentLoop(messages, lang, mode)
       └─ DeepSeek LLM with tool_choice: "auto"
            ├─ tool: search_wiki(query)   → KV get('wiki')  → keyword score
            ├─ tool: search_faq(query)    → KV get('faqs')  → keyword score
            └─ tool: get_knowledge_overview() → counts + titles
       └─ loops up to 5 steps until finish_reason === 'stop'
  3. Append user+assistant turn to session history → KV set (TTL 2h, max 20 turns)
  4. Append to KV list 'metrics'  (trimmed to 500 entries)
  5. Return { answer, tool_calls, metrics }
```

### KV Data Schema

| Key | Type | Contents |
|-----|------|----------|
| `faqs` | JSON array | `{ id, question_zh, question_en, answer_zh, answer_en }` |
| `wiki` | JSON array | `{ id, title_zh, title_en, body_zh, body_en, tags[], updated_at }` |
| `events` | Redis list | Event objects: `{ type, timestamp, ...extra }` |
| `feedback` | Redis list | `{ id, message, email, reply, timestamp }` |
| `metrics` | Redis list | Per-query performance + token data |
| `settings` | JSON object | `{ siteName, defaultLanguage, answerMode }` |
| `session:{id}` | JSON array | Conversation messages array, TTL 2h |

### Frontend Architecture

Both HTML files are self-contained (CSS + JS inline). Key patterns:

- `index.html`: maintains `sessionId` in `sessionStorage`; falls back to local `KB` array if `/api/chat` fails; all UI strings live in a `UI_TEXT` dict for zh/en switching
- `admin.html`: tab-based SPA with panel show/hide; calls all `/api/*` endpoints directly
- No bundler — edits to HTML are immediate after deploy

### Routing (vercel.json)

- `/api/*` → `api/index.js` (serverless)
- `/admin*` → `public/admin.html`
- `/*` → `public/$1` (static)
- `/` → `public/index.html`
