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

export function shortList(items, max = 12) {
  if (!items.length) return 'nothing';
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more (all listed on the test page)`;
}

// The "How well it works" section of a write-up, in Markdown, so the numbers
// are copied from the run rather than retyped. rows: [{ label, sum }], the
// first row being the default setting; examples: [{ id, masked }].
export function reportMarkdown({ version, date, url, rows, examples = [] }) {
  const s = rows[0].sum;
  const lines = [
    '### How well it works',
    '',
    `Paste-Safe ${version} was run over its [test set](${url}): ${s.cases} made-up requests of the kind people paste into a chat AI, `
      + `with ${s.names} names of people, organizations and places and ${s.details} contact details and numbers labelled. `
      + 'A name counts as hidden only if every letter of every mention is masked. '
      + 'The always-mask list was left empty, so this measures the model, the patterns and the name rules on their own.',
    '',
    '| Setting | Names hidden | Contact details and numbers hidden | Ordinary words masked by mistake |',
    '|---|---|---|---|',
    ...rows.map(({ label, sum }) => `| ${label} | ${sum.namesHidden}/${sum.names} | ${sum.detailsHidden}/${sum.details} | ${sum.extra.length} |`),
    '',
    `**Missed at the default setting:** ${shortList(s.missed)}.`,
    '',
    `**Masked by mistake at the default setting:** ${shortList(s.extra)}.`,
  ];
  if (examples.length) {
    lines.push('', `How ${examples.length === 1 ? 'one of the misses' : `${examples.length} of the misses`} looked after masking:`);
    for (const ex of examples) lines.push('', `> #${ex.id}: ${ex.masked.replace(/\s*\n\s*/g, ' ')}`);
  }
  lines.push(
    '',
    'The name rules (a capitalised name after a title such as Mr or Dr, after a greeting such as Dear or Hi, or under a sign-off such as Kind regards) '
      + 'were added after the test set was written, by the same AI agents who wrote it, so read the default row as a best case on these messages, not a promise. '
      + 'The messages themselves were made up by those agents, not taken from real clients. '
      + 'For a name that must never leak, the fix is the always-mask list: add it once and it is masked every time, whatever the model thinks.',
    '',
    `*Measured in a desktop browser on ${date}. The test page runs in your browser, so anyone can re-run it.*`,
  );
  return lines.join('\n');
}
