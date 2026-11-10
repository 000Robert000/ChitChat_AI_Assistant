# ESE-TECH × ChitChat

Company website for **ESE-TECH Industrial Solutions Corporation** with **ChitChat**, an AI assistant that answers from the company **knowledge base**.

- **AI model:** Google Gemini (free tier), no credit card needed
- **Knowledge base:** the files in the `knowledge/` folder, searched for every question (Retrieval-Augmented Generation)
- Optional: switch back to Dify.ai with `AI_PROVIDER=dify`

## Quick start

1. Get a free Gemini API key: https://aistudio.google.com/apikey (sign in with Google → **Create API key**)
2. In this folder:
   ```bash
   npm install
   copy .env.example .env      # macOS/Linux: cp .env.example .env
   ```
3. Open `.env` and paste the key after `GEMINI_API_KEY=`
4. `npm start` → open **http://localhost:3000**

Requires Node.js 18+ (20.12+ recommended so `.env` loads automatically).

## The knowledge base

```
knowledge/
├── 01-company-profile.md        ← the official ESE-TECH knowledge base document (source of truth)
├── 02-faq-extended.md           ← ~30 customer questions answered from the company facts
├── 03-service-request-guide.md  ← what to prepare, support/quote templates, emergencies
├── 04-technical-reference.md    ← general VFD/PLC/SCADA knowledge, fault types, safety, maintenance
├── 05-glossary.md               ← industry terms (VFD, MCC, LOTO, harmonics, PE2…)
└── 06-faq-filipino.md           ← Filipino/Tagalog FAQ so questions in Filipino are found too
```

Files 02–06 only restate company facts from 01 or add general, non-company-specific engineering knowledge, so nothing about ESE-TECH is invented. The bot presents technical reference answers as general guidance and puts safety first.

- Every `#` / `##` heading becomes a searchable section. `.md`, `.txt` and `.docx` files are all supported, so you can drop the original Word document here too.
- Edits are picked up automatically while the server is running.
- For each question the server ranks sections with **BM25** keyword search (with synonyms, e.g. "boss" → CEO/President), sends the top sections to Gemini as context, and Gemini answers **only** from them. The chat shows which sections were used under "From the knowledge base".

Check it in the browser while presenting:
- `http://localhost:3000/api/knowledge` shows the loaded files and sections
- `http://localhost:3000/api/knowledge/search?q=who+is+the+ceo` shows the ranked sections for a question

## How it works

```
Browser (website + chat widget)
   │  POST /api/chat/stream
   ▼
Express server (server.js)
   ├─ lib/knowledge.js  → search knowledge/ for relevant sections
   └─ lib/gemini.js     → Gemini API (streaming) with those sections as context
   ▼
Answer streams back word by word, with sources
```

## Project structure

```
chitchat-backend/
├── server.js            API server
├── lib/knowledge.js     Knowledge base loader + BM25 search
├── lib/gemini.js        Gemini streaming client (tries several free models in order)
├── knowledge/           Knowledge base documents
├── data/                Created automatically: chat-log.jsonl, feedback.jsonl
├── public/              Website: index.html, style.css, app.js, assets/
├── .env.example
└── package.json
```

## API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/chat/stream` | Chat (Server-Sent Events stream) |
| POST | `/api/messages/:id/feedback` | 👍 / 👎 rating → `data/feedback.jsonl` |
| GET  | `/api/messages/:id/suggested` | Follow-up question chips |
| GET  | `/api/knowledge` | Loaded knowledge base files and sections |
| GET  | `/api/knowledge/search?q=…` | Test the retrieval for a question |
| GET  | `/api/health` | Health check |

## Troubleshooting

| Message in the chat | Fix |
|---|---|
| "The Gemini API key is invalid" | Re-copy the key into `.env`, then restart `npm start` |
| "The free Gemini quota is used up" | Free tier limits requests per minute/day; wait and retry, or create a key in another Google project |
| "Chat server was not found" | The Node server isn't running; run `npm start` and open http://localhost:3000 |
| Wrong or "I don't have that detail" answers | Add or fix the information in `knowledge/ese-tech-knowledge-base.md` |

To pick specific models, set `GEMINI_MODEL=model-a,model-b` in `.env` (model IDs are listed in Google AI Studio).

## Security notes

- Keys live only in `.env` (git-ignored). The old Dify key that was hard-coded in the first version should be regenerated or deleted in Dify.
- Requests are rate-limited per IP (`RATE_LIMIT_PER_MIN`, default 20) and capped at 2,000 characters.
- Set `ALLOWED_ORIGINS` in production so only your domain can call the API.
- Free-tier Gemini requests may be used by Google to improve its products, so don't put confidential data in the knowledge base.
