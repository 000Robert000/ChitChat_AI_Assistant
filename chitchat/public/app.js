/* =========================================================
   ESE-TECH site + ChitChat widget (Dify.ai via /api proxy)
   ========================================================= */
(() => {
  'use strict';

  // Same-origin when served by server.js; falls back to localhost if index.html is opened as a file
  // Same-origin when the page is served by server.js (http://localhost:3000).
  // If the page is opened some other way (XAMPP/Apache, Live Server, double-clicking the file),
  // talk to the Node server on port 3000 instead.
  const NODE_ORIGIN = 'http://localhost:3000';
  const servedByNode = location.protocol !== 'file:' && !(/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== '3000');
  const API = window.CHITCHAT_API || (servedByNode ? '' : NODE_ORIGIN);
  const STORE_KEY = 'chitchat.v2';
  const MAX_STORED = 60;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------------- site behaviour ---------------- */

  $('#year').textContent = new Date().getFullYear();

  // mobile nav
  const navToggle = $('.nav-toggle');
  const navLinks = $('#navLinks');
  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') !== 'true';
    navToggle.setAttribute('aria-expanded', String(open));
    navLinks.classList.toggle('open', open);
  });
  $$('#navLinks a').forEach(a => a.addEventListener('click', () => {
    navToggle.setAttribute('aria-expanded', 'false');
    navLinks.classList.remove('open');
  }));

  // scroll progress bar + active nav link
  const header = $('.site-header');
  const sections = $$('main section[id]');
  const onScroll = () => {
    const h = document.documentElement;
    header.style.setProperty('--scroll', (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)).toFixed(3));
    let current = '';
    for (const s of sections) if (s.getBoundingClientRect().top < 120) current = s.id;
    $$('#navLinks a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${current}`));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // reveal on scroll
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 6) * 60}ms`; io.observe(el); });
  } else {
    $$('.reveal').forEach(el => el.classList.add('in'));
  }

  /* ---------------- chat state ---------------- */

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  })).replace(/-/g, '');

  const load = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
  const state = Object.assign({ userId: uuid(), conversationId: '', messages: [] }, load());
  const save = () => {
    try {
      state.messages = state.messages.slice(-MAX_STORED);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch { /* storage full or blocked — chat still works in memory */ }
  };
  save();

  /* ---------------- elements ---------------- */

  const panel = $('#ccPanel');
  const launcher = $('#ccLauncher');
  const list = $('#ccMessages');
  const welcome = $('#ccWelcome');
  const form = $('#ccForm');
  const input = $('#ccInput');
  const sendBtn = $('#ccSend');
  const stopBtn = $('#ccStop');
  const jump = $('#ccJump');
  const nudge = $('#ccNudge');
  const statusEl = $('#ccStatus');

  let busy = false;
  let controller = null;
  let generation = 0; // bumps on "new conversation" so late replies are discarded

  /* ---------------- open / close ---------------- */

  function openChat(prefill) {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    launcher.classList.add('open');
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close ChitChat assistant');
    $('#ccBadge').hidden = true;
    hideNudge();
    scrollToEnd(true);
    if (prefill) send(prefill);
    else setTimeout(() => input.focus(), 120);
  }
  function closeChat() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    launcher.classList.remove('open');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Open ChitChat assistant');
    launcher.focus();
  }
  const isOpen = () => panel.classList.contains('open');

  launcher.addEventListener('click', () => (isOpen() ? closeChat() : openChat()));
  $('#ccClose').addEventListener('click', closeChat);
  $('#ccExpand').addEventListener('click', () => panel.classList.toggle('expanded'));
  $('#ccNew').addEventListener('click', newConversation);
  addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) closeChat(); });

  // any element on the page can open the chat, optionally with a question
  document.addEventListener('click', e => {
    const ask = e.target.closest('[data-ask]');
    if (ask) { e.preventDefault(); openChat(ask.dataset.ask); return; }
    if (e.target.closest('[data-open-chat]')) { e.preventDefault(); openChat(); }
  });
  $('#ccStarter').addEventListener('click', e => {
    const b = e.target.closest('button[data-q]');
    if (b) send(b.dataset.q);
  });

  // gentle nudge once per session
  function hideNudge() { nudge.hidden = true; try { sessionStorage.setItem('cc.nudged', '1'); } catch {} }
  $('.cc-nudge-x').addEventListener('click', hideNudge);
  nudge.addEventListener('click', e => { if (!e.target.closest('.cc-nudge-x')) openChat(); });
  let nudged = false; try { nudged = !!sessionStorage.getItem('cc.nudged'); } catch {}
  if (!nudged && !state.messages.length) setTimeout(() => { if (!isOpen()) { nudge.hidden = false; $('#ccBadge').hidden = false; } }, 9000);

  /* ---------------- composer ---------------- */

  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    sendBtn.disabled = busy || !input.value.trim();
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = '';
    autosize();
    send(q);
  });
  stopBtn.addEventListener('click', () => controller?.abort());

  function setBusy(v) {
    busy = v;
    sendBtn.hidden = v;
    stopBtn.hidden = !v;
    statusEl.textContent = v ? 'Typing…' : 'ESE-TECH support assistant';
    autosize();
  }

  /* ---------------- scrolling ---------------- */

  // follow new content only while the reader is at the bottom; if they scroll up, show a "new messages" pill
  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  let stick = true;
  function scrollToEnd(force) {
    if (force) stick = true;
    if (stick) { list.scrollTop = list.scrollHeight; jump.hidden = true; }
    else jump.hidden = false;
  }
  list.addEventListener('scroll', () => { stick = nearBottom(); if (stick) jump.hidden = true; }, { passive: true });
  jump.addEventListener('click', () => scrollToEnd(true));

  /* ---------------- markdown (safe, minimal) ---------------- */

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(text) {
    const tokens = [];
    const keep = html => `\u0000${tokens.push(html) - 1}\u0000`;
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^\s)]+)\)/g,
      (_, t, u) => keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
    s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, u => keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
    s = s.replace(/\b(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<.,;:!?)]*)/gi, u => keep(`<a href="https://${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
    s = s.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, m => keep(`<a href="mailto:${m}">${m}</a>`));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[i]);
  }

  function renderBlocks(src) {
    const lines = src.split('\n');
    let html = '', para = [], listType = null, table = [];
    const flushPara = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
    const flushList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.filter(r => !/^\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim())));
      html += '<table>' + rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join('')}</tr>`).join('') + '</table>';
      table = [];
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line.trim()); continue; }
      flushTable();
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)/))) { flushPara(); flushList(); html += `<h4>${inline(m[1])}</h4>`; continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
        const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
        flushPara();
        if (listType !== type) { flushList(); html += `<${type}>`; listType = type; }
        html += `<li>${inline(m[1])}</li>`;
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara(); flushList(); flushTable();
    return html;
  }

  function markdown(src) {
    src = src.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, ''); // hide reasoning-model thoughts
    return src.split('```').map((part, i) => {
      if (i % 2) {
        const code = part.replace(/^[\w-]*\n/, '');
        return `<pre><code>${esc(code)}</code></pre>`;
      }
      return renderBlocks(part);
    }).join('');
  }

  /* ---------------- message rendering ---------------- */

  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M7 10v11H4V10zM7 10l4-7c1.5 0 2.5 1 2.2 2.6L12.5 9H19a2 2 0 0 1 2 2.3l-1.3 7.5A2 2 0 0 1 17.7 21H7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M17 14V3h3v11zM17 14l-4 7c-1.5 0-2.5-1-2.2-2.6l.7-3.4H5a2 2 0 0 1-2-2.3l1.3-7.5A2 2 0 0 1 6.3 3H17"/></svg>',
  };
  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  function rowEl(msg) {
    const row = document.createElement('div');
    row.className = `cc-row ${msg.role}${msg.error ? ' error' : ''}`;
    row.innerHTML = msg.role === 'bot'
      ? `<span class="cc-mini"><img src="assets/chitchat-mark.png" alt=""></span><div class="cc-col"><div class="cc-bubble"></div><div class="cc-meta"></div></div>`
      : `<div class="cc-col"><div class="cc-bubble"></div><div class="cc-meta"></div></div>`;
    fillRow(row, msg);
    return row;
  }

  function fillRow(row, msg) {
    const bubble = $('.cc-bubble', row);
    if (msg.role === 'user') bubble.textContent = msg.text;
    else bubble.innerHTML = markdown(msg.text) + sourcesHtml(msg.sources);
    const meta = $('.cc-meta', row);
    meta.innerHTML = `<span>${fmtTime(msg.time)}</span>`;
    if (msg.role === 'bot' && !msg.error && msg.text) {
      meta.insertAdjacentHTML('beforeend', `<button data-act="copy" title="Copy" aria-label="Copy answer">${ICON.copy}</button>`);
      if (msg.id) meta.insertAdjacentHTML('beforeend',
        `<button data-act="like" title="Helpful" aria-label="Helpful" class="${msg.feedback === 'like' ? 'on' : ''}">${ICON.up}</button>` +
        `<button data-act="dislike" title="Not helpful" aria-label="Not helpful" class="${msg.feedback === 'dislike' ? 'on' : ''}">${ICON.down}</button>`);
    }
    if (msg.error && msg.retry) meta.insertAdjacentHTML('beforeend', `<button class="retry" data-act="retry">Try again</button>`);
    row.dataset.idx = state.messages.indexOf(msg);
  }

  function sourcesHtml(sources) {
    if (!sources?.length) return '';
    const names = [...new Set(sources.map(s => s.document_name || s.dataset_name).filter(Boolean))];
    if (!names.length) return '';
    return `<details class="cc-sources"><summary>From the knowledge base (${names.length})</summary><ul>${names.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>`;
  }

  function renderAll() {
    $$('.cc-row, .cc-suggest', list).forEach(n => n.remove());
    welcome.hidden = state.messages.length > 0;
    state.messages.forEach(m => list.appendChild(rowEl(m)));
    scrollToEnd(true);
  }

  // copy / feedback / retry
  list.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) {
      const sug = e.target.closest('.cc-suggest button');
      if (sug) send(sug.textContent);
      return;
    }
    const row = btn.closest('.cc-row');
    const msg = state.messages[+row.dataset.idx];
    if (!msg) return;
    const act = btn.dataset.act;

    if (act === 'copy') {
      const plain = msg.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      try { await navigator.clipboard.writeText(plain); }
      catch { const t = document.createElement('textarea'); t.value = plain; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
      btn.innerHTML = ICON.check; setTimeout(() => (btn.innerHTML = ICON.copy), 1400);
    }
    if (act === 'like' || act === 'dislike') {
      msg.feedback = msg.feedback === act ? null : act;
      save(); fillRow(row, msg);
      fetch(`${API}/api/messages/${encodeURIComponent(msg.id)}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: msg.feedback, user: state.userId }),
      }).catch(() => {});
    }
    if (act === 'retry' && !busy) {
      const q = msg.retry;
      state.messages.splice(state.messages.indexOf(msg), 1);
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'user' && last.text === q) state.messages.pop();
      save(); renderAll(); send(q);
    }
  });

  function newConversation() {
    generation++;
    controller?.abort();
    state.conversationId = '';
    state.messages = [];
    save(); renderAll();
    input.focus();
  }

  /* ---------------- sending + streaming ---------------- */

  async function send(text, isRetryAfterReset = false) {
    text = String(text || '').trim();
    if (!text || busy) return;

    $$('.cc-suggest', list).forEach(n => n.remove());
    welcome.hidden = true;

    if (!isRetryAfterReset) {
      const userMsg = { role: 'user', text, time: Date.now() };
      state.messages.push(userMsg); save();
      list.appendChild(rowEl(userMsg));
    }

    const botMsg = { role: 'bot', text: '', time: Date.now(), id: '', sources: null };
    const row = rowEl(botMsg);
    const bubble = $('.cc-bubble', row);
    bubble.innerHTML = '<span class="cc-typing" aria-label="ChitChat is typing"><i></i><i></i><i></i></span>';
    list.appendChild(row);
    scrollToEnd(true);
    setBusy(true);

    controller = new AbortController();
    const myGen = generation;
    let frame = 0;
    const paint = () => {
      frame = 0;
      bubble.innerHTML = markdown(botMsg.text);
      bubble.classList.add('cc-cursor');
      scrollToEnd();
    };

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, conversation_id: state.conversationId, user: state.userId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.code === 'conversation_not_found' && state.conversationId && !isRetryAfterReset) {
          state.conversationId = ''; save(); row.remove(); setBusy(false);
          return send(text, true); // old thread expired on Dify — start a fresh one
        }
        if (res.status === 404 && !err.error) throw new Error('the chat server was not found. Make sure the Node server is running (npm start) and open the site at http://localhost:3000.');
        throw new Error(err.error || `Server responded ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split(/\r?\n\r?\n/);
        buf = events.pop();
        for (const block of events) {
          const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
          if (!data) continue;
          let ev; try { ev = JSON.parse(data); } catch { continue; }
          if (ev.conversation_id) state.conversationId = ev.conversation_id;
          if (ev.message_id) botMsg.id = ev.message_id;
          switch (ev.event) {
            case 'message':
            case 'agent_message':
              botMsg.text += ev.answer || '';
              if (!frame) frame = requestAnimationFrame(paint);
              break;
            case 'message_replace':
              botMsg.text = ev.answer || '';
              if (!frame) frame = requestAnimationFrame(paint);
              break;
            case 'workflow_finished':
              if (!botMsg.text && ev.data?.outputs?.answer) botMsg.text = ev.data.outputs.answer;
              break;
            case 'message_end':
              botMsg.sources = ev.metadata?.retriever_resources || null;
              break;
            case 'error':
              throw new Error(ev.message || 'The assistant ran into a problem.');
          }
        }
      }
      if (frame) cancelAnimationFrame(frame);
      if (!botMsg.text.trim()) botMsg.text = "Sorry, I couldn't come up with an answer. Could you rephrase your question?";
      finish(row, botMsg);
      loadSuggestions(botMsg.id);
    } catch (err) {
      if (frame) cancelAnimationFrame(frame);
      if (err.name === 'AbortError') {
        if (botMsg.text.trim()) { botMsg.text += ' …'; finish(row, botMsg); }
        else row.remove();
      } else {
        console.error('[ChitChat]', err);
        const offline = err instanceof TypeError;
        botMsg.error = true;
        botMsg.retry = text;
        botMsg.text = offline
          ? "I can't reach the ChitChat server right now. Please check your connection and try again. For urgent concerns, call **0949 940 1722** or email **sales.dept@esetech.com.ph**."
          : `Sorry — ${err.message}`;
        finish(row, botMsg);
      }
    } finally {
      if (myGen !== generation) row.remove();
      controller = null;
      setBusy(false);
      if (isOpen() && matchMedia('(pointer: fine)').matches) input.focus();
    }
  }

  function finish(row, msg) {
    if (!row.isConnected) return;
    msg.time = Date.now();
    state.messages.push(msg);
    save();
    $('.cc-bubble', row).classList.remove('cc-cursor');
    row.className = `cc-row bot${msg.error ? ' error' : ''}`;
    fillRow(row, msg);
    scrollToEnd();
    if (!isOpen()) $('#ccBadge').hidden = false;
  }

  async function loadSuggestions(messageId) {
    if (!messageId) return;
    try {
      const r = await fetch(`${API}/api/messages/${encodeURIComponent(messageId)}/suggested?user=${encodeURIComponent(state.userId)}`);
      const { data } = await r.json();
      if (!data?.length || busy) return;
      const box = document.createElement('div');
      box.className = 'cc-suggest';
      data.forEach(q => { const b = document.createElement('button'); b.textContent = q; box.appendChild(b); });
      list.appendChild(box);
      scrollToEnd();
    } catch { /* follow-ups are optional */ }
  }

  renderAll();
})();
