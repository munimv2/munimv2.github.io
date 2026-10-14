import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkText, alignTokens, entitySpans, patternSpans, termSpans, resolveSpans, ruleSpans,
  findSpans, maskText, restoreText, newKey,
} from '../core.js';

// Tokens shaped like Transformers.js token-classification output.
const tok = (list) => list.map(([word, entity], i) => ({ word, entity, score: 0.99, index: i + 1 }));
const surfaces = (text, spans) => spans.map((s) => text.slice(s.start, s.end));

test('chunkText keeps every character and its offset', () => {
  const text = 'One sentence here. '.repeat(200) + '\nLast line without end';
  const chunks = chunkText(text, 300);
  assert.equal(chunks.map((c) => c.text).join(''), text);
  for (const c of chunks) {
    assert.ok(c.text.length <= 300);
    assert.equal(text.slice(c.offset, c.offset + c.text.length), c.text);
  }
});

test('word pieces join and half-tagged words widen to the whole word', () => {
  const text = 'Please email Sheehan Munim at Acme Corp in Chicago.';
  const tokens = tok([
    ['Please', 'O'], ['email', 'O'], ['She', 'B-PER'], ['##eh', 'I-PER'], ['##an', 'O'],
    ['Mu', 'I-PER'], ['##nim', 'I-PER'], ['at', 'O'], ['Acme', 'B-ORG'], ['Corp', 'I-ORG'],
    ['in', 'O'], ['Chicago', 'B-LOC'], ['.', 'O'],
  ]);
  const spans = entitySpans(text, alignTokens(text, tokens));
  assert.deepEqual(surfaces(text, spans), ['Sheehan', 'Munim', 'Acme Corp', 'Chicago']);
  assert.deepEqual(spans.map((s) => s.type), ['PERSON', 'PERSON', 'ORG', 'PLACE']);
});

test('a fully tagged name is one span', () => {
  const text = 'Please email Sheehan Munim today.';
  const tokens = tok([['She', 'B-PER'], ['##eh', 'I-PER'], ['##an', 'I-PER'], ['Mu', 'I-PER'], ['##nim', 'I-PER']]);
  assert.deepEqual(surfaces(text, entitySpans(text, alignTokens(text, tokens))), ['Sheehan Munim']);
});

test('low scores and unwanted types are dropped', () => {
  const text = 'Ana went to Lisbon for the World Cup.';
  const tokens = [
    { word: 'Ana', entity: 'B-PER', score: 0.3, index: 1 },
    { word: 'Lisbon', entity: 'B-LOC', score: 0.95, index: 4 },
    { word: 'World', entity: 'B-MISC', score: 0.95, index: 7 },
    { word: 'Cup', entity: 'I-MISC', score: 0.95, index: 8 },
  ];
  assert.deepEqual(surfaces(text, entitySpans(text, alignTokens(text, tokens))), ['Lisbon']);
  const withMisc = entitySpans(text, alignTokens(text, tokens), { nerTypes: ['PER', 'ORG', 'LOC', 'MISC'] });
  assert.deepEqual(surfaces(text, withMisc), ['Lisbon', 'World Cup']);
});

test('chunk offsets carry through alignment', () => {
  const text = 'Intro line.\nCall Maria tomorrow.';
  const chunks = chunkText(text, 14);
  const nerTokens = chunks.map((c) => ({
    ...c,
    tokens: c.text.includes('Maria') ? tok([['Call', 'O'], ['Maria', 'B-PER'], ['tomorrow', 'O']]) : [],
  }));
  const spans = findSpans(text, { nerTokens });
  assert.deepEqual(surfaces(text, spans), ['Maria']);
});

test('name rules find names after titles, greetings and sign-offs', () => {
  const text = "Hi Maria,\nMr. Kowalczyk asked Dr Laurent Mercier about Madame Dubois's file. Dear Team, thanks.\nKind regards, Linh Tran.";
  const spans = ruleSpans(text);
  assert.deepEqual(surfaces(text, spans).sort(), ['Dubois', 'Kowalczyk', 'Laurent Mercier', 'Linh Tran', 'Maria']);
  assert.ok(spans.every((s) => s.type === 'PERSON'));
  assert.deepEqual(surfaces('Thanks,\nSam', ruleSpans('Thanks,\nSam')), ['Sam']);
  assert.deepEqual(surfaces('Dear Mr Nguyen, thank you.', ruleSpans('Dear Mr Nguyen, thank you.')), ['Nguyen', 'Nguyen']);
});

test('name rules leave ordinary sentences alone', () => {
  for (const text of [
    'This is the brief. Hi there, team.',
    'Thanks, Maria will call you.',
    'Please tell the Dr about it.',
    'hey, Rob says hello.',
    'Dear All, the office is closed.',
  ]) assert.deepEqual(ruleSpans(text), [], text);
});

test('a name found by a rule is masked everywhere, and the rules can be turned off', () => {
  const text = 'Dear Rose, the lease is ready. Rose can sign on Friday.';
  assert.equal(maskText(text, findSpans(text)).masked, 'Dear [PERSON_1], the lease is ready. [PERSON_1] can sign on Friday.');
  assert.deepEqual(findSpans(text, { rules: false }), []);
  assert.deepEqual(findSpans(text, { nerTypes: ['ORG', 'LOC'] }), []);
});

test('patterns find contact details and numbers but not dates or versions', () => {
  const text = [
    'Mail ana@example.com or see https://example.com/brief.',
    'Phone +1 555-123-4567, office (020) 7946 0958, desk 555-123-4567.',
    'Due 2026-10-13 or 12.10.2026, budget 1 000 000, version 1.88.6.',
    'Card 4111 1111 1111 1111, IBAN DE89 3704 0044 0532 0130 00, host 192.168.1.10, SSN 123-45-6789.',
    'Not a card: 1234 5678 9012 3456.',
  ].join('\n');
  const found = resolveSpans(text, patternSpans(text));
  const byType = (type) => found.filter((s) => s.type === type).map((s) => text.slice(s.start, s.end));
  assert.deepEqual(byType('EMAIL'), ['ana@example.com']);
  assert.deepEqual(byType('URL'), ['https://example.com/brief']);
  assert.deepEqual(byType('PHONE'), ['+1 555-123-4567', '(020) 7946 0958', '555-123-4567']);
  assert.deepEqual(byType('CARD'), ['4111 1111 1111 1111']);
  assert.deepEqual(byType('IBAN'), ['DE89 3704 0044 0532 0130 00']);
  assert.deepEqual(byType('IP'), ['192.168.1.10']);
  assert.deepEqual(byType('ID'), ['123-45-6789']);
  for (const s of found) {
    const value = text.slice(s.start, s.end);
    assert.ok(!['2026-10-13', '12.10.2026', '1 000 000', '1.88.6'].includes(value), value);
  }
});

test('always-mask terms ignore case; never-mask terms win', () => {
  const text = 'Project Falcon ships from Chicago.';
  const spans = [
    ...termSpans(text, ['project falcon', '  ']),
    { start: 26, end: 33, type: 'PLACE', source: 'ner' },
  ];
  assert.deepEqual(surfaces(text, resolveSpans(text, spans)), ['Project Falcon', 'Chicago']);
  assert.deepEqual(surfaces(text, resolveSpans(text, spans, ['chicago'])), ['Project Falcon']);
});

test('mask, then restore an answer that bent the placeholders', () => {
  const text = 'Sheehan Munim met Acme Corp. Sheehan will call +1 555-123-4567 or mail sheehan@example.com.';
  const nerTokens = [{
    text, offset: 0,
    tokens: tok([['She', 'B-PER'], ['##eh', 'I-PER'], ['##an', 'I-PER'], ['Mu', 'I-PER'], ['##nim', 'I-PER'],
      ['met', 'O'], ['Acme', 'B-ORG'], ['Corp', 'I-ORG']]),
  }];
  const spans = findSpans(text, { nerTokens });
  const { masked, key } = maskText(text, spans);
  assert.equal(masked, '[PERSON_1] met [ORG_1]. [PERSON_1] will call [PHONE_1] or mail [EMAIL_1].');
  assert.deepEqual(key.entries.map((e) => [e.placeholder, e.original]), [
    ['[PERSON_1]', 'Sheehan Munim'], ['[ORG_1]', 'Acme Corp'],
    ['[PHONE_1]', '+1 555-123-4567'], ['[EMAIL_1]', 'sheehan@example.com'],
  ]);

  const answer = 'Dear person_1, [ORG_1] agreed. Ask [PERSON 1] to ring [PHONE_1]. [PERSON_9] is new.';
  const { restored, count, leftover } = restoreText(answer, key);
  assert.equal(restored, 'Dear Sheehan Munim, Acme Corp agreed. Ask Sheehan Munim to ring +1 555-123-4567. [PERSON_9] is new.');
  assert.equal(count, 4);
  assert.deepEqual(leftover, ['[PERSON_9]']);
});

// A PERSON span over the first `word` found at or after `from`.
const person = (text, word, from = 0) => {
  const start = text.indexOf(word, from);
  return { start, end: start + word.length, type: 'PERSON' };
};

test('a first or last name on its own shares the full name\'s placeholder', () => {
  const text = "Daniel's line is busy, so Daniel Okafor asked us to write to Okafor's assistant.";
  const spans = [person(text, 'Daniel'), person(text, 'Daniel Okafor', 1), person(text, 'Okafor', 40)];
  const { masked, key } = maskText(text, spans);
  assert.equal(masked, "[PERSON_1]'s line is busy, so [PERSON_1] asked us to write to [PERSON_1]'s assistant.");
  assert.deepEqual(key.entries.map((e) => [e.placeholder, e.original]), [['[PERSON_1]', 'Daniel Okafor']]);
  assert.equal(restoreText("Reply to [PERSON_1]'s assistant.", key).restored, "Reply to Daniel Okafor's assistant.");
});

test('a first name two people share, or one the key already holds alone, keeps its own placeholder', () => {
  const two = 'Daniel Okafor and Daniel Reyes met. Daniel will write.';
  const shared = [person(two, 'Daniel Okafor'), person(two, 'Daniel Reyes'), person(two, 'Daniel', 20)];
  assert.equal(maskText(two, shared).masked, '[PERSON_1] and [PERSON_2] met. [PERSON_3] will write.');

  const key = newKey();
  maskText('Ask Daniel.', [person('Ask Daniel.', 'Daniel')], key);
  const later = 'Daniel Okafor agreed. Daniel will call.';
  const { masked } = maskText(later, [person(later, 'Daniel Okafor'), person(later, 'Daniel', 5)], key);
  assert.equal(masked, '[PERSON_2] agreed. [PERSON_1] will call.');
});

test('the key is shared across texts and never confuses 1 with 10', () => {
  const key = newKey();
  for (let i = 1; i <= 10; i++) {
    const name = `Client${i}`;
    maskText(name, [{ start: 0, end: name.length, type: 'TERM' }], key);
  }
  assert.equal(maskText('Client3', [{ start: 0, end: 7, type: 'TERM' }], key).masked, '[TERM_3]');
  assert.equal(restoreText('[TERM_10] and [TERM_1] and TERM_1.', key).restored, 'Client10 and Client1 and Client1.');
  assert.equal(restoreText('Pay $1 to [TERM_2]', key).restored, 'Pay $1 to Client2');
});
