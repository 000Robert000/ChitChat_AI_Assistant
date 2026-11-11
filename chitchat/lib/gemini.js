/**
 * Google Gemini API (free tier available — get a key at https://aistudio.google.com/apikey)
 * Streams the answer as it is generated.
 */
const BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

// Tried in order: if one is unavailable for your key or out of free quota, the next is used.
const DEFAULT_MODELS = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-flash-latest'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIRST_BYTE_TIMEOUT = Number(process.env.GEMINI_TIMEOUT_MS) || 15000;
const IDLE_TIMEOUT = Number(process.env.GEMINI_IDLE_MS) || 30000;

class GeminiError extends Error {
  constructor(message, status, retryable) { super(message); this.status = status; this.retryable = retryable; }
}

function friendly(status, body) {
  const msg = body?.error?.message || '';
  if (status === 400 && /api key/i.test(msg)) return 'The Gemini API key is invalid. Check GEMINI_API_KEY in your .env file.';
  if (status === 403) return 'This Gemini API key is not allowed to use the model. Check the key in Google AI Studio.';
  if (status === 429) return 'The free Gemini quota is used up for now. Please wait a minute and try again.';
  if (status >= 500) return 'Google’s AI servers are busy right now. Please try again in a moment.';
  return msg || `Gemini error (${status})`;
}

// Fallback: ask for the whole answer at once (used when streaming stalls)
async function generateOnce({ apiKey, model, body, signal }) {
  const ac = new AbortController();
  const onOuter = () => ac.abort();
  signal?.addEventListener('abort', onOuter, { once: true });
  const t = setTimeout(() => ac.abort(), FIRST_BYTE_TIMEOUT);
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: friendly(res.status, json), status: res.status };
    const text = (json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    return text ? { text } : { error: 'Empty answer', status: 502 };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { error: 'Google’s AI servers are busy right now. Please try again in a moment.', status: 504 };
  } finally { clearTimeout(t); signal?.removeEventListener('abort', onOuter); }
}

/**
 * @param {object} o
 * @param {string} o.apiKey
 * @param {string[]} [o.models]
 * @param {string} o.system   system instructions
 * @param {{role:'user'|'model', text:string}[]} o.contents
 * @param {(text:string)=>void} o.onText
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{model:string, text:string}>}
 */
async function streamGemini({ apiKey, models, system, contents, onText, signal }) {
  const list = models?.length ? models : DEFAULT_MODELS;
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: contents.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
  });
  const tryOnce = async model => {
    console.warn(`[Gemini] ${model} → streaming stalled, asking for the full answer instead`);
    const r = await generateOnce({ apiKey, model, body: requestBody, signal });
    if (r.text) { onText(r.text); return { model, text: r.text }; }
    console.warn(`[Gemini] ${model} → ${r.status} ${r.error}`);
    lastErr = new GeminiError(r.error, r.status, true);
    return null;
  };
  let lastErr;
  for (const model of list) {
   // a busy model (503) gets one more try after a short pause before moving to the next model
   for (let attempt = 0; attempt < 2; attempt++) {
    // Each attempt has its own timer: no reply within 20 s, or a 30 s silence mid-answer, counts as a failure
    const ac = new AbortController();
    let timedOut = false;
    const onOuterAbort = () => ac.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    let timer = setTimeout(() => { timedOut = true; ac.abort(); }, FIRST_BYTE_TIMEOUT);
    const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ac.abort(); }, IDLE_TIMEOUT); };
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onOuterAbort); };

    let res;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
        signal: ac.signal,
      });
    } catch (err) {
      cleanup();
      if (signal?.aborted) throw err; // the visitor pressed Stop
      if (timedOut) { const r = await tryOnce(model); if (r) return r; break; }
      lastErr = new GeminiError('Could not reach the Gemini API. Check your internet connection.', 502, true);
      break;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      cleanup();
      console.warn(`[Gemini] ${model} → ${res.status} ${body?.error?.message || ''}`);
      // wrong model name / not offered / out of quota → try the next model
      const tryNext = res.status === 404 || res.status === 429 || res.status >= 500 || (res.status === 400 && /model/i.test(body?.error?.message || ''));
      lastErr = new GeminiError(friendly(res.status, body), res.status, tryNext);
      if (res.status === 503 && attempt === 0) { await sleep(1500); continue; }
      if (tryNext) break;
      throw lastErr;
    }

    // Parse the Server-Sent Events stream
    let full = '', buf = '';
    const decoder = new TextDecoder();
    resetIdle();
    try {
    for await (const chunk of res.body) {
      resetIdle();
      buf += decoder.decode(chunk, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop();
      for (const ev of events) {
        const data = ev.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data) continue;
        let json; try { json = JSON.parse(data); } catch { continue; }
        const parts = json.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.thought || !p.text) continue; // skip "thinking" parts
          full += p.text;
          onText(p.text);
        }
      }
    }
    } catch (err) {
      cleanup();
      if (signal?.aborted) throw err;
      if (timedOut && !full) { const r = await tryOnce(model); if (r) return r; break; }
      if (timedOut) throw new GeminiError('The answer was interrupted because Google’s AI stopped responding. Please try again.', 504, false);
      throw err;
    }
    cleanup();
    return { model, text: full };
   }
  }
  throw lastErr || new GeminiError('No Gemini model is available for this API key.', 502, false);
}

module.exports = { streamGemini, DEFAULT_MODELS };