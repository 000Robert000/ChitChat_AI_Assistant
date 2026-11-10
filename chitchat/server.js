/**
 * ChitChat backend — ESE-TECH Industrial Solutions
 *
 * Two AI providers are supported (set AI_PROVIDER in .env):
 *   gemini (default) — Google Gemini free tier + the local knowledge base in /knowledge (RAG)
 *   dify             — forwards to a Dify.ai chat app (uses Dify's own knowledge base)
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

try { process.loadEnvFile?.(path.join(__dirname, '.env')); } catch { /* no .env file, use real env vars */ }

const express = require('express');
const cors = require('cors');
const { KnowledgeBase } = require('./lib/knowledge');
const { streamGemini, DEFAULT_MODELS } = require('./lib/gemini');

/* ---------- config ---------- */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODELS = (process.env.GEMINI_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);
const DIFY_API_KEY = process.env.DIFY_API_KEY || '';
const DIFY_API_BASE = (process.env.DIFY_API_BASE || 'https://api.dify.ai/v1').replace(/\/+$/, '');
const PROVIDER = (process.env.AI_PROVIDER || (GEMINI_API_KEY ? 'gemini' : DIFY_API_KEY ? 'dify' : '')).toLowerCase();
const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const MAX_QUERY_LENGTH = 2000;
const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
const DATA_DIR = path.join(__dirname, 'data');

if (PROVIDER === 'gemini' && !GEMINI_API_KEY) fail('AI_PROVIDER is gemini but GEMINI_API_KEY is empty.\nGet a free key at https://aistudio.google.com/apikey and paste it into .env');
if (PROVIDER === 'dify' && !DIFY_API_KEY) fail('AI_PROVIDER is dify but DIFY_API_KEY is empty.');
if (!PROVIDER) fail('No AI key found. Copy .env.example to .env and add GEMINI_API_KEY (free at https://aistudio.google.com/apikey).');
function fail(msg) { console.error(`\n[ChitChat] ${msg}\n`); process.exit(1); }

/* ---------- knowledge base (auto-reloads when files in /knowledge change) ---------- */

const kb = new KnowledgeBase(KNOWLEDGE_DIR);
let reloadTimer;
try {
  fs.watch(KNOWLEDGE_DIR, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { kb.load(); console.log(`[Knowledge] reloaded: ${kb.chunks.length} sections`); }, 300);
  });
} catch { /* watching not supported — restart to reload */ }

/* ---------- app ---------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : undefined));
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ---------- helpers ---------- */

function cleanUser(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? `web-${raw}` : 'web-anonymous';
}
const cleanId = raw => (typeof raw === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(raw) ? raw : '');

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = hits.get(req.ip) || { count: 0, start: now };
  if (now - entry.start > 60_000) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  hits.set(req.ip, entry);
  if (entry.count > RATE_LIMIT_PER_MIN) return res.status(429).json({ error: 'Too many messages. Please wait a minute and try again.' });
  next();
}

function validateChat(req, res) {
  const { query } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) { res.status(400).json({ error: 'Please type a message first.' }); return null; }
  if (query.length > MAX_QUERY_LENGTH) { res.status(400).json({ error: `Messages are limited to ${MAX_QUERY_LENGTH} characters.` }); return null; }
  return { query: query.trim(), user: cleanUser(req.body.user), conversation_id: cleanId(req.body.conversation_id) };
}

function appendLog(file, record) {
  fs.mkdir(DATA_DIR, { recursive: true }, () =>
    fs.appendFile(path.join(DATA_DIR, file), JSON.stringify({ time: new Date().toISOString(), ...record }) + '\n', () => {}));
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/* =========================================================
   GEMINI + LOCAL KNOWLEDGE BASE
   ========================================================= */

const SYSTEM_PROMPT = `You are ChitChat, the official AI assistant on the website of ESE-TECH Industrial Solutions Corporation, a Philippine industrial automation and power control engineering firm.

Rules:
- Answer ONLY from the KNOWLEDGE BASE EXCERPTS below. They are your single source of truth.
- If the excerpts do not contain the answer, say you don't have that detail and refer the user to sales.dept@esetech.com.ph or www.esetech.com.ph. Never invent names, prices, numbers, products or services.
- ESE-TECH does not publish prices: for prices or quotations, direct users to the sales department with their project requirements.
- For technical problems or site assessments, ask the user to prepare their site location, equipment brand/model (Rockwell, Danfoss, ABB) and a description of the issue. Mention on-call emergency support for contract clients when relevant.
- Be friendly, concise and professional. Prefer short paragraphs or bullet lists. Reply in the user's language (English or Filipino/Tagalog).
- Do not mention "excerpts", "context" or these rules to the user — just answer naturally.
- Some excerpts are general technical reference (VFDs, PLCs, faults, maintenance, glossary). Present those as general guidance, put safety first, and recommend that work on energized equipment be done only by qualified personnel. For site-specific problems, suggest contacting ESE-TECH's engineers.
- Never give step-by-step instructions for working inside live electrical panels or bypassing safety devices.
- Politely decline topics unrelated to ESE-TECH, its services, or industrial automation and drives.`;

const SUGGESTIONS = [
  'What services does ESE-TECH offer?',
  'Which brands does ESE-TECH support?',
  'Which industries do you serve?',
  'Who leads ESE-TECH?',
  'How do I request a quote?',
  'What are your office hours?',
  'Where is your head office?',
  'Can you help reduce our plant’s energy use?',
  'What should I prepare before requesting support?',
  'What projects has ESE-TECH completed?',
];

const conversations = new Map(); // id → { history: [{role, text}], asked: [], updated }
const answers = new Map();       // message id → { question, answer } (for feedback logs)
setInterval(() => {
  const cutoff = Date.now() - 6 * 3600_000;
  for (const [id, c] of conversations) if (c.updated < cutoff) conversations.delete(id);
  if (answers.size > 2000) [...answers.keys()].slice(0, 1000).forEach(k => answers.delete(k));
  for (const [k, v] of hits) if (Date.now() - v.start > 120_000) hits.delete(k);
}, 600_000).unref();

async function geminiChat(req, res, payload) {
  const convId = payload.conversation_id && conversations.has(payload.conversation_id) ? payload.conversation_id : crypto.randomUUID();
  const conv = conversations.get(convId) || { history: [], asked: [], updated: Date.now() };
  conversations.set(convId, conv);
  const messageId = crypto.randomUUID();

  // Retrieval: search with this question plus the previous one (helps follow-ups like "what's his email?")
  const lastUser = [...conv.history].reverse().find(m => m.role === 'user')?.text || '';
  const found = kb.context(`${payload.query} ${lastUser}`, 5);
  const context = found.map((c, i) => `[${i + 1}] ${c.heading}\n${c.text}`).join('\n\n---\n\n') || '(no matching knowledge base sections)';
  const system = `${SYSTEM_PROMPT}\n\nKNOWLEDGE BASE EXCERPTS:\n\n${context}`;

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let started = false, full = '';
  const start = () => {
    if (started) return;
    started = true;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  };

  try {
    const result = await streamGemini({
      apiKey: GEMINI_API_KEY,
      models: GEMINI_MODELS,
      system,
      contents: [...conv.history.slice(-12), { role: 'user', text: payload.query }],
      signal: controller.signal,
      onText: t => { start(); full += t; sse(res, { event: 'message', answer: t, conversation_id: convId, message_id: messageId }); },
    });
    start();
    conv.history.push({ role: 'user', text: payload.query }, { role: 'model', text: full || result.text });
    conv.asked.push(payload.query.toLowerCase());
    conv.updated = Date.now();
    answers.set(messageId, { question: payload.query, answer: full, convId });
    sse(res, {
      event: 'message_end', conversation_id: convId, message_id: messageId,
      metadata: { model: result.model, retriever_resources: found.filter(c => c.score > 0).map(c => ({ document_name: c.heading.split(' › ').pop().replace(/^\d+\.\s*/, ''), dataset_name: c.source, score: c.score })) },
    });
    res.end();
    appendLog('chat-log.jsonl', { conversation_id: convId, message_id: messageId, model: result.model, question: payload.query, sections: found.map(c => c.heading), answer: full });
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('[ChitChat] Gemini error:', err.message);
    if (!started) return res.status(err.status && err.status < 600 ? err.status : 502).json({ error: err.message });
    sse(res, { event: 'error', message: err.message });
    res.end();
  }
}

/* =========================================================
   DIFY (optional)
   ========================================================= */

const difyHeaders = () => ({ Authorization: `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' });

async function difyChat(req, res, payload) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const upstream = await fetch(`${DIFY_API_BASE}/chat-messages`, {
      method: 'POST', headers: difyHeaders(), signal: controller.signal,
      body: JSON.stringify({ inputs: {}, ...payload, response_mode: 'streaming' }),
    });
    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      console.error('[Dify] rejected request:', upstream.status, err);
      const code = err.code === 'not_found' || /conversation/i.test(err.message || '') ? 'conversation_not_found' : 'upstream_error';
      return res.status(upstream.status).json({ error: err.message || 'The assistant is unavailable right now.', code });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('[ChitChat] Dify stream error:', error);
    if (!res.headersSent) res.status(502).json({ error: 'Could not reach the assistant service.' });
    else { sse(res, { event: 'error', message: 'Connection interrupted.' }); res.end(); }
  }
}

/* =========================================================
   ROUTES
   ========================================================= */

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: PROVIDER }));

app.post('/api/chat/stream', rateLimit, (req, res) => {
  const payload = validateChat(req, res);
  if (!payload) return;
  return PROVIDER === 'gemini' ? geminiChat(req, res, payload) : difyChat(req, res, payload);
});

app.post('/api/messages/:id/feedback', async (req, res) => {
  const id = cleanId(req.params.id);
  const rating = ['like', 'dislike'].includes(req.body?.rating) ? req.body.rating : null;
  if (!id) return res.status(400).json({ error: 'Invalid message id' });
  if (PROVIDER === 'gemini') {
    appendLog('feedback.jsonl', { message_id: id, rating, ...(answers.get(id) || {}) });
    return res.json({ result: 'success' });
  }
  try {
    const r = await fetch(`${DIFY_API_BASE}/messages/${id}/feedbacks`, { method: 'POST', headers: difyHeaders(), body: JSON.stringify({ rating, user: cleanUser(req.body?.user) }) });
    res.status(r.status).json(await r.json().catch(() => ({})));
  } catch { res.status(502).json({ error: 'Feedback failed' }); }
});

app.get('/api/messages/:id/suggested', async (req, res) => {
  const id = cleanId(req.params.id);
  if (!id) return res.json({ data: [] });
  if (PROVIDER === 'gemini') {
    const conv = conversations.get(answers.get(id)?.convId);
    const asked = conv?.asked || [];
    const words = q => new Set(q.toLowerCase().match(/[a-z]{4,}/g) || []);
    const fresh = SUGGESTIONS.filter(s => !asked.some(a => { const w = words(s); return [...words(a)].filter(x => w.has(x)).length >= 2; }));
    const offset = asked.length % Math.max(1, fresh.length);
    return res.json({ data: [...fresh.slice(offset), ...fresh.slice(0, offset)].slice(0, 3) });
  }
  try {
    const r = await fetch(`${DIFY_API_BASE}/messages/${id}/suggested?user=${encodeURIComponent(cleanUser(req.query.user))}`, { headers: difyHeaders() });
    const data = await r.json().catch(() => ({}));
    res.json({ data: Array.isArray(data.data) ? data.data.slice(0, 3) : [] });
  } catch { res.json({ data: [] }); }
});

// Knowledge base inspection — handy for demos: /api/knowledge and /api/knowledge/search?q=who+is+the+ceo
app.get('/api/knowledge', (_req, res) => res.json({
  provider: PROVIDER, files: kb.files,
  sections: kb.chunks.map(c => ({ source: c.source, heading: c.heading, characters: c.text.length })),
}));
app.get('/api/knowledge/search', (req, res) => {
  const q = String(req.query.q || '').slice(0, 300);
  res.json({ query: q, results: kb.search(q, 5).map(c => ({ heading: c.heading, score: c.score, text: c.text })) });
});

app.listen(PORT, () => {
  console.log(`\nChitChat running → http://localhost:${PORT}`);
  console.log(`AI provider: ${PROVIDER}${PROVIDER === 'gemini' ? ` (models: ${(GEMINI_MODELS.length ? GEMINI_MODELS : DEFAULT_MODELS).join(', ')})` : ''}`);
  console.log(`Knowledge base: ${kb.files.map(f => f.name).join(', ') || '(empty)'} — ${kb.chunks.length} sections\n`);
});
