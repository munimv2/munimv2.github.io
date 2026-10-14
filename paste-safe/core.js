// Paste-Safe core: find private names and details in text, swap them for
// placeholders, and put them back later. Pure functions, no DOM, no network.
// The NER model output is passed in, so this file runs the same in Node tests.

export const VERSION = '0.3.1';

// Lower number wins when two findings overlap.
const PRIORITY = { TERM: 0, EMAIL: 1, URL: 1, CARD: 1, IBAN: 1, ID: 1, IP: 1, PHONE: 2, PERSON: 3, ORG: 3, PLACE: 3, NAME: 3, MISC: 4 };

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

// A capitalised name of one to three words: "Rose", "Laurent Mercier", "Siobhán Ní Bhriain".
const NAME = String.raw`\p{Lu}[\p{L}'’-]*\p{L}(?:[ \t]+\p{Lu}[\p{L}'’-]*\p{L}){0,2}`;
const TITLES = String.raw`(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Professor|Sir|Dame|Madame|Mme|Mademoiselle|Mlle|Monsieur|Herr|Frau|Señor|Señora|Signor|Signora)`;
const NAME_RULES = [
  // A title: "Mr. Kowalczyk", "Dr Laurent Mercier", "Madame Dubois".
  new RegExp(String.raw`(?<![\p{L}\p{N}_])${TITLES}\.?[ \t]+(${NAME})`, 'gu'),
  // A greeting that ends at a comma or line end: "Hi Maria,", "Dear Rose,".
  new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:[Hh]i|[Hh]ello|[Hh]ey|[Dd]ear|[Gg]ood (?:morning|afternoon|evening))[ \t]+(?:${TITLES}\.?[ \t]+)?(${NAME})(?=[ \t]*(?:[,!:;\r\n]|$))`, 'gu'),
  // A sign-off followed by the name on its own: "Kind regards, Linh Tran." or "Thanks,\nSam".
  new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:[Rr]egards|[Bb]est wishes|[Bb]est|[Cc]heers|[Ss]incerely|[Tt]hanks|[Tt]hank you|[Yy]ours(?: sincerely| truly| faithfully)?)[ \t]*,[ \t]*\r?\n?[ \t]*(${NAME})(?=[ \t]*(?:[.,!"”\r\n]|$))`, 'gu'),
];
// Words a greeting is often followed by that are not anyone's name.
const NOT_NAMES = new Set(['All', 'Everyone', 'Everybody', 'There', 'Team', 'Folks', 'Friends', 'Colleagues', 'Sir', 'Madam',
  'Customer', 'Client', 'Hiring', 'Valued', 'Guys', 'Both', 'Again', 'Partners', 'Members', 'Neighbours', 'Neighbors', 'Parents']);

// Names that the words around them give away, which the model misses most
// often outside its English news training. Each becomes a PERSON span.
export function ruleSpans(text) {
  const spans = [];
  for (const re of NAME_RULES) {
    for (const m of text.matchAll(re)) {
      let name = m[1];
      if (NOT_NAMES.has(name.split(/[ \t]/)[0])) continue;
      const start = m.index + m[0].length - name.length;
      name = name.replace(/['’]s$/, '');
      spans.push({ start, end: start + name.length, type: 'PERSON', source: 'rule' });
    }
  }
  return spans;
}

// The optional second look: a small open model (Gemma 3 270M) is asked, on
// the device, to list the names it sees. One worked example shows it the
// answer format, including a name written in lower case.
const LOOK_ASK = 'List every name of a person, organization or place in the text below, one per line, '
  + 'starting each line with person:, organization: or place:. Copy each name exactly as it is written. '
  + 'If there are none, write none.\n\nText:\n';
const LOOK_EXAMPLE = 'please tell ravi that Litware paid. Ana Silva from the Porto office will call.';
const LOOK_EXAMPLE_REPLY = 'person: ravi\norganization: Litware\nperson: Ana Silva\nplace: Porto';

export function secondLookMessages(text) {
  return [
    { role: 'user', content: LOOK_ASK + LOOK_EXAMPLE },
    { role: 'assistant', content: LOOK_EXAMPLE_REPLY },
    { role: 'user', content: LOOK_ASK + text },
  ];
}

const LOOK_TYPES = [
  [/^(?:person|people|name)s?$/i, 'PERSON'],
  [/^(?:organi[sz]ation|org|company|business)s?$/i, 'ORG'],
  [/^(?:place|location|city|country)s?$/i, 'PLACE'],
];
// Words a small model lists as names that are not private.
const NOT_LOOK_NAMES = new Set(['none', 'n/a', 'text', 'name', 'names', 'person', 'people', 'organization', 'place',
  'i', 'you', 'we', 'he', 'she', 'they', 'today', 'tomorrow', 'yesterday',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
const LEADING_TITLE = new RegExp(String.raw`^${TITLES}\.?[ \t]+`, 'u');
const ONLY_TITLE = new RegExp(String.raw`^${TITLES}\.?$`, 'u');

// Read the second look's reply: keep only names that really are in the text
// (a model may invent or reword them), each as it is written there.
export function parseNameList(text, reply) {
  const names = [];
  const seen = new Set();
  for (const line of String(reply || '').split(/\r?\n/)) {
    let body = line.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '');
    let type = 'NAME';
    const label = /^([\p{L} ]+?)\s*:\s*(.*)$/u.exec(body);
    const kind = label && LOOK_TYPES.find(([re]) => re.test(label[1].trim()));
    if (kind) {
      type = kind[1];
      body = label[2];
    }
    for (let name of body.split(/[,;]/)) {
      name = name.trim().replace(/^["'“‘([]+|["'”’)\].]+$/gu, '').replace(LEADING_TITLE, '').trim();
      if (name.length < 2 || name.length > 60 || /[[\]_]/.test(name) || !/\p{L}/u.test(name)) continue;
      if (NOT_LOOK_NAMES.has(name.toLowerCase()) || ONLY_TITLE.test(name)) continue;
      const found = findAll(text, name, type, 'llm', false)[0] || findAll(text, name, type, 'llm', true)[0];
      if (!found) continue;
      const surface = text.slice(found.start, found.end);
      if (seen.has(surface)) continue;
      seen.add(surface);
      names.push({ name: surface, type });
    }
  }
  return names;
}

const LOOK_NER = { PERSON: 'PER', ORG: 'ORG', PLACE: 'LOC' };

// Every mention of each name the second look listed, for the kinds of name
// being masked. A name of no stated kind counts while any kind is on.
export function llmSpans(text, names, nerTypes = ['PER', 'ORG', 'LOC']) {
  const spans = [];
  for (const { name, type } of names) {
    const wanted = type === 'NAME' ? ['PER', 'ORG', 'LOC'].some((t) => nerTypes.includes(t)) : nerTypes.includes(LOOK_NER[type]);
    if (wanted) spans.push(...findAll(text, name, type, 'llm', false));
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

// Once the model, a name rule or the second look has found a name, mask every
// other mention of it too, including a person's first or last name used on its own later.
export function propagate(text, spans) {
  const seen = new Map();
  for (const s of spans) {
    if (s.source !== 'ner' && s.source !== 'rule' && s.source !== 'llm') continue;
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

// A first or last name on its own takes the placeholder of the one full name
// it belongs to, so "Daniel Okafor ... Daniel's line" stays one person for the
// AI. A part two full names share ("Daniel Okafor", "Daniel Reyes") keeps its
// own placeholder, and so does a name the key already holds on its own.
function personAliases(text, spans, key) {
  const fullNames = new Set([
    ...key.entries.filter((e) => e.type === 'PERSON').map((e) => e.original),
    ...spans.filter((s) => s.type === 'PERSON').map((s) => text.slice(s.start, s.end)),
  ]);
  const owners = new Map();
  for (const full of fullNames) {
    if (!/\s/.test(full)) continue;
    for (const part of full.match(/\p{Lu}[\p{L}'’-]{2,}/gu) || []) {
      if (!owners.has(part)) owners.set(part, new Set());
      owners.get(part).add(full);
    }
  }
  const aliases = new Map();
  for (const [part, fulls] of owners) {
    if (fulls.size !== 1) continue;
    if (key.entries.some((e) => e.type === 'PERSON' && e.original === part)) continue;
    aliases.set(part, [...fulls][0]);
  }
  return aliases;
}

// Swap each chosen span for its placeholder. The key is reused across texts,
// so the same name gets the same placeholder all session.
export function maskText(text, spans, key = newKey()) {
  const aliases = personAliases(text, spans, key);
  let masked = '';
  let last = 0;
  for (const s of spans) {
    let original = text.slice(s.start, s.end);
    if (s.type === 'PERSON' && aliases.has(original)) original = aliases.get(original);
    masked += text.slice(last, s.start) + placeholderFor(key, s.type, original);
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

// Everything except the model calls, in one step. The name rules only add
// people, so they are off when people are not being masked. llmNames are the
// second look's names from parseNameList.
export function findSpans(text, { nerTokens = [], contact = true, numbers = true, terms = [], keep = [], minScore = 0.6, nerTypes = ['PER', 'ORG', 'LOC'], rules = true, llmNames = [] } = {}) {
  let spans = [];
  for (const chunk of nerTokens) {
    const aligned = alignTokens(chunk.text, chunk.tokens, chunk.offset);
    spans.push(...entitySpans(text, aligned, { minScore, nerTypes }));
  }
  if (rules && nerTypes.includes('PER')) spans.push(...ruleSpans(text));
  spans.push(...llmSpans(text, llmNames, nerTypes));
  spans = propagate(text, spans);
  spans.push(...patternSpans(text, { contact, numbers }));
  spans.push(...termSpans(text, terms));
  return resolveSpans(text, spans, keep);
}
