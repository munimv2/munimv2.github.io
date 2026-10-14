// Paste-Safe test-set scoring: given the spans Paste-Safe chose for a
// labelled message, which private strings would still show, and which
// masked words were not private. Pure functions, like core.js.

const WORD_CHAR = /[\p{L}\p{N}]/u;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every whole-word place an item appears in the text (case-sensitive).
export function occurrences(text, item) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(item)}(?![\\p{L}\\p{N}_])`, 'gu');
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

// An item counts as hidden only if every letter and digit of every mention
// is inside a masked span. "[PERSON_1] Okafor" leaks "Daniel Okafor".
export function scoreCase(text, spans, { names = [], details = [] } = {}) {
  const covered = new Uint8Array(text.length);
  for (const s of spans) covered.fill(1, s.start, s.end);
  const gold = [];
  const leakedOf = (items) => items.filter((item) => {
    const found = occurrences(text, item);
    gold.push(...found);
    return !found.length || found.some(({ start, end }) => {
      for (let i = start; i < end; i++) if (WORD_CHAR.test(text[i]) && !covered[i]) return true;
      return false;
    });
  });
  const leakedNames = leakedOf(names);
  const leakedDetails = leakedOf(details);
  const extra = spans
    .filter((s) => !gold.some((g) => s.start < g.end && g.start < s.end))
    .map((s) => text.slice(s.start, s.end));
  return {
    names: { total: names.length, leaked: leakedNames },
    details: { total: details.length, leaked: leakedDetails },
    extra,
  };
}

// Add up per-message scores; results are { id, ...scoreCase() }.
export function summarize(results) {
  const sum = { cases: results.length, names: 0, namesHidden: 0, details: 0, detailsHidden: 0, missed: [], extra: [] };
  for (const r of results) {
    sum.names += r.names.total;
    sum.namesHidden += r.names.total - r.names.leaked.length;
    sum.details += r.details.total;
    sum.detailsHidden += r.details.total - r.details.leaked.length;
    sum.missed.push(...[...r.names.leaked, ...r.details.leaked].map((item) => `${item} (#${r.id})`));
    sum.extra.push(...r.extra.map((t) => `${t} (#${r.id})`));
  }
  return sum;
}

export function resultLine(label, sum) {
  return `${label}: names hidden ${sum.namesHidden}/${sum.names}, contact details and numbers hidden ${sum.detailsHidden}/${sum.details}, `
    + `non-private words masked ${sum.extra.length} | missed: ${sum.missed.join(', ') || 'none'} | over-masked: ${sum.extra.join(', ') || 'none'}`;
}
