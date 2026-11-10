/**
 * Google Gemini API (free tier available — get a key at https://aistudio.google.com/apikey)
 * Streams the answer as it is generated.
 */
const BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';

// Tried in order: if one is unavailable for your key or out of free quota, the next is used.
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

class GeminiError extends Error {
  constructor(message, status, retryable) { super(message); this.status = status; this.retryable = retryable; }
}

function friendly(status, body) {
  const msg = body?.error?.message || '';
  if (status === 400 && /api key/i.test(msg)) return 'The Gemini API key is invalid. Check GEMINI_API_KEY in your .env file.';
  if (status === 403) return 'This Gemini API key is not allowed to use the model. Check the key in Google AI Studio.';
  if (status === 429) return 'The free Gemini quota is used up for now. Please wait a minute and try again.';
  if (status >= 500) return 'Gemini is temporarily unavailable. Please try again shortly.';
  return msg || `Gemini error (${status})`;
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
  let lastErr;
  for (const model of list) {
    let res;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: contents.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = new GeminiError('Could not reach the Gemini API. Check your internet connection.', 502, true);
      continue;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[Gemini] ${model} → ${res.status} ${body?.error?.message || ''}`);
      // wrong model name / not offered / out of quota → try the next model
      const tryNext = res.status === 404 || res.status === 429 || res.status >= 500 || (res.status === 400 && /model/i.test(body?.error?.message || ''));
      lastErr = new GeminiError(friendly(res.status, body), res.status, tryNext);
      if (tryNext) continue;
      throw lastErr;
    }

    // Parse the Server-Sent Events stream
    let full = '', buf = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
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
    return { model, text: full };
  }
  throw lastErr || new GeminiError('No Gemini model is available for this API key.', 502, false);
}

module.exports = { streamGemini, DEFAULT_MODELS };
