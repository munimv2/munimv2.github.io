import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpans } from '../core.js';
import { occurrences, scoreCase, summarize, resultLine } from '../evalcore.js';
import { CASES } from '../eval-data.js';

test('a name only counts as hidden when every mention is fully masked', () => {
  const text = 'Daniel Okafor met Ana in Leeds.';
  const spans = [{ start: 0, end: 6 }, { start: 14, end: 17 }, { start: 25, end: 30 }];
  const r = scoreCase(text, spans, { names: ['Daniel Okafor', 'Ana', 'Leeds'] });
  assert.deepEqual(r.names, { total: 3, leaked: ['Daniel Okafor', 'Ana'] });
  assert.deepEqual(r.details, { total: 0, leaked: [] });
  assert.deepEqual(r.extra, ['met']);
});

test('punctuation inside a name does not need masking; a missing label counts as leaked', () => {
  const text = "Ask Sarah O'Connell at Adeyemi & Partners.";
  const spans = [{ start: 4, end: 9 }, { start: 10, end: 11 }, { start: 12, end: 19 }, { start: 23, end: 30 }, { start: 33, end: 41 }];
  const r = scoreCase(text, spans, { names: ["Sarah O'Connell", 'Adeyemi & Partners', 'Nobody'] });
  assert.deepEqual(r.names.leaked, ['Nobody']);
  assert.deepEqual(r.extra, []);
});

test('the test set is well formed', () => {
  assert.equal(CASES.length, 30);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  for (const c of CASES) {
    for (const item of [...c.names, ...c.details]) {
      assert.ok(occurrences(c.text, item).length > 0, `#${c.id}: "${item}" is not in the text`);
    }
  }
});

test('the patterns alone hide every contact detail and number in the test set', () => {
  for (const c of CASES) {
    const r = scoreCase(c.text, findSpans(c.text), c);
    assert.deepEqual(r.details.leaked, [], `#${c.id}`);
  }
});

test('summary line adds up the messages', () => {
  const text = 'Daniel Okafor met Ana in Leeds.';
  const first = { id: 1, ...scoreCase(text, [{ start: 0, end: 6 }, { start: 14, end: 17 }, { start: 25, end: 30 }], { names: ['Daniel Okafor', 'Ana', 'Leeds'] }) };
  const second = { id: 2, names: { total: 2, leaked: [] }, details: { total: 1, leaked: ['x@y.example'] }, extra: [] };
  assert.equal(
    resultLine('EVAL', summarize([first, second])),
    'EVAL: names hidden 3/5, contact details and numbers hidden 0/1, non-private words masked 1 | missed: Daniel Okafor (#1), Ana (#1), x@y.example (#2) | over-masked: met (#1)',
  );
});
