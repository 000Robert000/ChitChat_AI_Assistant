/**
 * ChitChat knowledge base
 * -----------------------
 * Loads every .md / .txt / .docx file in the /knowledge folder, splits it into
 * sections, and finds the sections most relevant to a question using BM25
 * (the ranking method classic search engines use). The best sections are given
 * to the AI as context, so answers come from the company document — this is
 * Retrieval-Augmented Generation (RAG), with no paid embedding service needed.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- reading files ---------- */

// Minimal .docx reader: a .docx is a zip; the text lives in word/document.xml
function readDocx(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid .docx (zip) file');
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === 'word/document.xml') {
      const lName = buf.readUInt16LE(local + 26);
      const lExtra = buf.readUInt16LE(local + 28);
      const start = local + 30 + lName + lExtra;
      const raw = buf.subarray(start, start + size);
      const xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
      return xmlToText(xml);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('word/document.xml not found');
}

function xmlToText(xml) {
  return xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, para => {
      const isHeading = /<w:pStyle w:val="(Heading|Title)\d*"/i.test(para);
      const isList = /<w:numPr>/.test(para);
      const text = para.replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '');
      if (!text.trim()) return '\n';
      return (isHeading ? '# ' : isList ? '- ' : '') + text + '\n\n';
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n');
}

/* ---------- splitting into sections ---------- */

function chunkDocument(text, source, { numberedHeadings = true } = {}) {
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '');
  const lines = text.split('\n');
  const chunks = [];
  let top = '', sub = '', buf = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    buf = [];
    if (!body) return;
    const heading = [top, sub].filter(Boolean).join(' › ') || 'General';
    // long sections are split by paragraph so each chunk stays focused
    const paras = body.split(/\n\s*\n/);
    let part = '';
    for (const para of paras) {
      if ((part + para).length > 900 && part) { chunks.push(makeChunk(source, heading, part)); part = ''; }
      part += (part ? '\n\n' : '') + para;
    }
    if (part) chunks.push(makeChunk(source, heading, part));
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)/);
    const h2 = line.match(/^#{2,6}\s+(.*)/);
    // also treat "1. Title Case Heading" lines (common in .docx/.txt) as headings
    const numbered = numberedHeadings && !h1 && !h2 && line.match(/^(\d{1,2}\.\s+[A-Z][^.:]{3,80})$/);
    if (h1 || numbered) { flush(); top = (h1 ? h1[1] : numbered[1]).trim(); sub = ''; continue; }
    if (h2) { flush(); sub = h2[1].trim(); continue; }
    buf.push(line);
  }
  flush();
  return chunks;
}

function makeChunk(source, heading, text) {
  const clean = text.replace(/\*\*/g, '').replace(/\s+\n/g, '\n').trim();
  return { id: `${source}#${heading}#${clean.length}`, source, heading, text: clean };
}

/* ---------- search (BM25) ---------- */

const STOP = new Set('a an the is are was were be been of to in on at for and or but with by from as it its this that these those what which who whom whose how when where why do does did can could you your i me my we our us they them their he she his her about into than then there here any some please tell know give get want need ' +
  // common Filipino/Tagalog function words
  'ang ng sa mga ba po ko mo ano sino saan paano kailan na at ay kayo nyo niyo ninyo namin natin si ni yung iyong ito iyan doon dito lang din rin naman'.split(' '));

// Everyday words people type → words used in the document
const SYNONYMS = {
  ceo: ['president', 'ceo', 'leadership'], president: ['ceo', 'leadership'], boss: ['ceo', 'president', 'leadership'],
  owner: ['ceo', 'president', 'leadership'], head: ['ceo', 'president', 'leadership', 'manager'], leader: ['leadership', 'ceo', 'manager'],
  manager: ['manager', 'leadership'], founder: ['ceo', 'president', 'leadership'], team: ['leadership', 'manager'],
  location: ['located', 'office', 'address'], address: ['office', 'located', 'address'], where: ['located', 'office'], located: ['office', 'address'],
  phone: ['phone', 'emergency', 'contact'], number: ['phone', 'contact'], call: ['phone', 'emergency'], contact: ['contact', 'email', 'phone', 'inquiries'],
  email: ['email', 'contact'], hour: ['hours', 'monday', 'friday'], open: ['hours'], schedule: ['hours'], time: ['hours'],
  price: ['quote', 'sales'], cost: ['quote', 'sales'], quotation: ['quote', 'sales'], quote: ['quote', 'sales'], buy: ['quote', 'sales', 'brands'],
  brand: ['brands', 'rockwell', 'danfoss', 'abb', 'partner'], partner: ['partner', 'rockwell', 'danfoss', 'abb'],
  service: ['services', 'capabilities'], offer: ['services', 'capabilities'], do: ['services'],
  vfd: ['vfd', 'drives', 'variable', 'frequency'], drive: ['drives', 'vfd'], plc: ['plc', 'plcs', 'automation', 'integration'],
  scada: ['scada', 'integration'], hmi: ['hmi', 'integration'], energy: ['energy', 'efficiency', 'pe2'], save: ['energy', 'efficiency'],
  repair: ['repair', 'field', 'troubleshooting', 'emergency'], broken: ['repair', 'troubleshooting', 'emergency'], support: ['support', 'emergency', 'field'],
  training: ['training', 'consultancy'], industry: ['industries', 'sectors'], client: ['industries', 'sectors'],
  history: ['formerly', 'registration', 'incorporation'], founded: ['registration', 'incorporation', 'formerly'], established: ['registration', 'incorporation'],
  project: ['milestones', 'success', 'migration'], experience: ['milestones', 'success'],
  fault: ['fault', 'faults', 'troubleshooting'], error: ['fault', 'faults'], alarm: ['fault', 'faults', 'alarm'], trip: ['fault', 'faults', 'overcurrent'],
  tripping: ['fault', 'faults', 'overcurrent'], reset: ['fault', 'reset'], overheating: ['overtemperature', 'cooling'], hot: ['overtemperature', 'cooling'],
  safe: ['safety', 'loto'], safety: ['safety', 'loto', 'ppe'], maintenance: ['maintenance', 'preventive', 'checklist'], emergency: ['emergency', 'on-call'],
  harmonic: ['harmonics', 'pulse'], pulse: ['pulse', 'harmonics'], inverter: ['vfd', 'drive'], speed: ['vfd', 'drive', 'speed'], motor: ['motor', 'vfd', 'mcc'],
  job: ['hiring', 'job'], hiring: ['hiring', 'job'], career: ['hiring', 'job'], weekend: ['weekends', 'hours'], saturday: ['weekends', 'hours'], sunday: ['weekends', 'hours'],
  presyo: ['price', 'quotation', 'presyo'], magkano: ['price', 'quotation', 'presyo'], kuryente: ['kuryente', 'energy'], opisina: ['opisina', 'office'],
  bukas: ['bukas', 'hours'], oras: ['oras', 'hours'], may: ['may'], ari: ['ari', 'ceo'], tumawag: ['phone', 'emergency'],
};

const tokenize = s => (s.toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter(t => !STOP.has(t))
  .map(t => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));

class KnowledgeBase {
  constructor(dir) {
    this.dir = dir;
    this.load();
  }

  load() {
    this.chunks = [];
    this.files = [];
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    for (const name of fs.readdirSync(this.dir).sort()) {
      const file = path.join(this.dir, name);
      const ext = path.extname(name).toLowerCase();
      try {
        let text;
        if (ext === '.md' || ext === '.txt') text = fs.readFileSync(file, 'utf8');
        else if (ext === '.docx') text = readDocx(file);
        else continue;
        const chunks = chunkDocument(text, name, { numberedHeadings: ext !== '.md' });
        this.chunks.push(...chunks);
        this.files.push({ name, chunks: chunks.length });
      } catch (err) {
        console.warn(`[Knowledge] skipped ${name}: ${err.message}`);
      }
    }
    // build BM25 index (heading words count double)
    this.docs = this.chunks.map(c => {
      const tokens = [...tokenize(c.heading), ...tokenize(c.heading), ...tokenize(c.text)];
      const tf = new Map();
      tokens.forEach(t => tf.set(t, (tf.get(t) || 0) + 1));
      return { tf, len: tokens.length };
    });
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
    this.df = new Map();
    this.docs.forEach(d => d.tf.forEach((_, t) => this.df.set(t, (this.df.get(t) || 0) + 1)));
  }

  search(query, k = 4) {
    const base = tokenize(query);
    const terms = new Set(base);
    base.forEach(t => (SYNONYMS[t] || []).forEach(s => tokenize(s).forEach(x => terms.add(x))));
    const N = this.docs.length, k1 = 1.4, b = 0.5;
    const scored = this.docs.map((d, i) => {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5));
        const w = base.includes(t) ? 1 : 0.6; // synonyms count a bit less than the user's own words
        score += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / this.avgLen));
      }
      return { ...this.chunks[i], score: +score.toFixed(3) };
    });
    return scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }

  // Context block for the AI prompt
  context(query, k = 4) {
    let hits = this.search(query, k);
    // nothing matched (e.g. "hello"): give the overview + contact sections so the bot can still help
    if (!hits.length) hits = this.chunks.filter(c => /profile|overview/i.test(c.heading)).slice(0, 1);
    // always include the contact section so the bot can hand off to a human
    const contact = this.chunks.find(c => /contact|support/i.test(c.heading));
    if (contact && !hits.some(h => h.id === contact.id)) hits.push({ ...contact, score: 0 });
    return hits;
  }
}

module.exports = { KnowledgeBase, chunkDocument, readDocx };
