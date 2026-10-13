// Paste-Safe core: find private names and details in text, swap them for
// placeholders, and put them back later. Pure functions, no DOM, no network.
// The NER model output is passed in, so this file runs the same in Node tests.

export const VERSION = '0.1.0';

// Lower number wins when two findings overlap.
const PRIORITY = { TERM: 0, EMAIL: 1, URL: 1, CARD: 1, IBAN: 1, ID: 1, IP: 1, PHONE: 2, PERSON: 3, ORG: 3, PLACE: 3, MISC: 4 };

export const TYPES = Object.keys(PRIORITY);

const NER_TYPES = { PER: 'PERSON', ORG: 'ORG', LOC: 'PLACE', MISC: 'MISC' };

const WORD_CHAR = /[\p{L}\p{N}]/u;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Split long text into pieces the model can read whole (BERT stops at 512 tokens).
export function chunkText(text, maxLen = 1200) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + maxLen, text.length);
    if (end < text.length) {
      const window = text.slice(offset, end);
      let cut = window.lastIndexOf('\n');
      if (cut < maxLen / 2) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! ')) + 1;
      if (cut < maxLen / 2) cut = window.lastIndexOf(' ');
      if (cut > 0) end = offset + cut + 1;
    }
    chunks.push({ text: text.slice(offset, end), offset });
    offset = end;
  }
  return chunks;
}

// Give each model token its place in the text. Transformers.js returns
// { word, entity, score, index } per token; word pieces start with '##'.
export function alignTokens(text, tokens, offset = 0) {
  const out = [];
  let cursor = 0;
  const ordered = [...tokens].sort((a, b) => a.index - b.index);
  for (const t of ordered) {
    let word = String(t.word || '');
    const piece = word.startsWith('##');
    if (piece) word = word.slice(2);
    if (!word || word === '[UNK]') continue;
    const at = text.indexOf(word, cursor);
    if (at === -1 || at - cursor > 40) continue;
    out.push({ start: at + offset, end: at + word.length + offset, entity: t.entity, score: t.score, piece });
    cursor = at + word.length;
  }
  return out;
}

// Join tagged tokens into entity spans, then widen each span to whole words
// so a half-tagged name ("Sheeh" + untagged "an") is still masked whole.
export function entitySpans(text, aligned, { minScore = 0.6, nerTypes = ['PER', 'ORG', 'LOC'] } = {}) {
  const raw = [];
  let cur = null;
  for (const t of aligned) {
    const m = /^([BI])-(\w+)$/.exec(t.entity || '');
    if (!m) {
      cur = null;
      continue;
    }
    const [, bio, tag] = m;
    const gap = cur ? text.slice(cur.end, t.start) : null;
    const joins = cur && cur.tag === tag && /^\s*$/.test(gap) && (bio === 'I' || t.piece || gap === '');
    if (joins) {
      cur.end = t.end;
      cur.scores.push(t.score);
    } else {
      cur = { start: t.start, end: t.end, tag, scores: [t.score] };
      raw.push(cur);
    }
  }
  const spans = [];
  for (const s of raw) {
    if (!nerTypes.includes(s.tag) || !NER_TYPES[s.tag]) continue;
    const mean = s.scores.reduce((a, b) => a + b, 0) / s.scores.length;
    if (mean < minScore) continue;
    let { start, end } = s;
    while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
    while (end < text.length && WORD_CHAR.test(text[end])) end++;
    spans.push({ start, end, type: NER_TYPES[s.tag], source: 'ner' });
  }
  return spans;
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const DATE_LIKE = /^(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/;

// Contact details and numbers that regular expressions find better than a model.
export function patternSpans(text, { contact = true, numbers = true } = {}) {
  const spans = [];
  const add = (re, type, check) => {
    for (const m of text.matchAll(re)) {
      let value = m[0];
      if (type === 'URL') value = value.replace(/[.,;:!?]+$/, '');
      if (check && !check(value)) continue;
      spans.push({ start: m.index, end: m.index + value.length, type, source: 'pattern' });
    }
  };
  if (contact) {
    add(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'EMAIL');
    add(/\bhttps?:\/\/[^\s<>"')\]]+/g, 'URL');
    add(/(?<![\w+])\+?(?:\(\d{1,4}\)|\d{1,4})(?:[\s.-]?(?:\(\d{1,4}\)|\d{2,5})){1,5}(?!\w)/g, 'PHONE', (v) => {
      const digits = v.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return false;
      if (DATE_LIKE.test(v)) return false;
      if (!/[\s.()-]/.test(v) && !v.startsWith('+')) return false;
      return v.startsWith('+') || v.startsWith('(') || digits.length >= 9;
    });
  }
  if (numbers) {
    add(/\b(?:\d[ -]?){12,18}\d\b/g, 'CARD', (v) => luhn(v.replace(/\D/g, '')));
    add(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, 'IBAN');
    add(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP', (v) => v.split('.').every((n) => Number(n) <= 255));
    add(/\b\d{3}-\d{2}-\d{4}\b/g, 'ID');
  }
  return spans;
}

function findAll(text, needle, type, source, ignoreCase) {
  const spans = [];
  if (!needle) return spans;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, ignoreCase ? 'giu' : 'gu');
  for (const m of text.matchAll(re)) spans.push({ start: m.index, end: m.index + m[0].length, type, source });
  return spans;
}

// Terms the user always wants masked (client names, project code names).
export function termSpans(text, terms) {
  const spans = [];
  for (const term of terms.map((t) => t.trim()).filter(Boolean)) spans.push(...findAll(text, term, 'TERM', 'list', true));
  return spans;
}

// Once the model has found a name, mask every other mention of it too,
// including a person's first or last name used on its own later.
export function propagate(text, spans) {
  const seen = new Map();
  for (const s of spans) {
    if (s.source !== 'ner') continue;
    const surface = text.slice(s.start, s.end);
    if (surface.length >= 2 && !seen.has(surface)) seen.set(surface, s.type);
    if (s.type !== 'PERSON') continue;
    for (const part of surface.match(/\p{Lu}[\p{L}'’-]{2,}/gu) || []) {
      if (part !== surface && !seen.has(part)) seen.set(part, 'PERSON');
    }
  }
  const extra = [];
  for (const [surface, type] of seen) extra.push(...findAll(text, surface, type, 'ner', false));
  return spans.concat(extra);
}

// Keep the best finding wherever two overlap, then sort by position.
export function resolveSpans(text, spans, keep = []) {
  const keepSet = new Set(keep.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const ranked = spans
    .filter((s) => s.end > s.start && !keepSet.has(text.slice(s.start, s.end).toLowerCase()))
    .sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const chosen = [];
  for (const s of ranked) {
    if (chosen.some((c) => s.start < c.end && c.start < s.end)) continue;
    chosen.push(s);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

export function newKey() {
  return { version: VERSION, entries: [] };
}

function placeholderFor(key, type, original) {
  const found = key.entries.find((e) => e.type === type && e.original === original);
  if (found) return found.placeholder;
  const n = key.entries.filter((e) => e.type === type).length + 1;
  const placeholder = `[${type}_${n}]`;
  key.entries.push({ placeholder, type, original });
  return placeholder;
}

// Swap each chosen span for its placeholder. The key is reused across texts,
// so the same name gets the same placeholder all session.
export function maskText(text, spans, key = newKey()) {
  let masked = '';
  let last = 0;
  for (const s of spans) {
    masked += text.slice(last, s.start) + placeholderFor(key, s.type, text.slice(s.start, s.end));
    last = s.end;
  }
  masked += text.slice(last);
  return { masked, key };
}

// Put the originals back into an answer. Chat models sometimes drop the
// brackets or change case, so "[PERSON_1]", "[person 1]" and "PERSON_1" all count.
export function restoreText(text, key) {
  let restored = text;
  let count = 0;
  for (const e of key.entries) {
    const m = /^\[([A-Z]+)_(\d+)\]$/.exec(e.placeholder);
    if (!m) continue;
    const [, type, n] = m;
    const re = new RegExp(`\\[\\s*${type}[ _-]?${n}\\s*\\]|(?<![\\p{L}\\p{N}_])${type}_${n}(?![\\p{L}\\p{N}_])`, 'giu');
    restored = restored.replace(re, () => {
      count++;
      return e.original;
    });
  }
  const leftover = [...restored.matchAll(new RegExp(`\\[(?:${TYPES.join('|')})_\\d+\\]`, 'g'))].map((m) => m[0]);
  return { restored, count, leftover: [...new Set(leftover)] };
}

// Everything except the model call, in one step.
export function findSpans(text, { nerTokens = [], contact = true, numbers = true, terms = [], keep = [], minScore = 0.6, nerTypes } = {}) {
  let spans = [];
  for (const chunk of nerTokens) {
    const aligned = alignTokens(chunk.text, chunk.tokens, chunk.offset);
    spans.push(...entitySpans(text, aligned, { minScore, nerTypes }));
  }
  spans = propagate(text, spans);
  spans.push(...patternSpans(text, { contact, numbers }));
  spans.push(...termSpans(text, terms));
  return resolveSpans(text, spans, keep);
}
