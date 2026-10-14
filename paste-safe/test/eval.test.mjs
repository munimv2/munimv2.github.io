import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpans } from '../core.js';
import { occurrences, scoreCase, summarize, resultLine, shortList, reportMarkdown } from '../evalcore.js';
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
    const r = scoreCase(c.text, findSpans(c.text, { rules: false }), c);
    assert.deepEqual(r.details.leaked, [], `#${c.id}`);
  }
});

test('the name rules alone catch the titled, greeted and signed names in the test set and mask nothing else', () => {
  const expected = {
    1: ['Maria'], 3: ['Kowalczyk'], 8: ['Dubois', 'Laurent Mercier'], 12: ['Nguyen', 'Linh Tran'],
    18: ['Rose'], 25: ['Abernathy'], 28: ['Abdi'], 30: ['Takahashi', 'Ahmed'],
  };
  for (const c of CASES) {
    const r = scoreCase(c.text, findSpans(c.text), c);
    assert.deepEqual(r.extra, [], `#${c.id}`);
    for (const name of expected[c.id] || []) assert.ok(!r.names.leaked.includes(name), `#${c.id}: ${name}`);
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

test('long lists are cut short and empty ones say nothing', () => {
  assert.equal(shortList([]), 'nothing');
  assert.equal(shortList(['a', 'b']), 'a, b');
  assert.equal(shortList(['a', 'b', 'c'], 2), 'a, b and 1 more (all listed on the test page)');
});

test('the write-up section reports every setting from the run', () => {
  const sum = (namesHidden, missed, extra) => ({ cases: 2, names: 5, namesHidden, details: 1, detailsHidden: 1, missed, extra });
  const md = reportMarkdown({
    version: '9.9.9',
    date: '2026-10-14',
    url: 'https://example.test/eval.html',
    rows: [
      { label: 'Default', sum: sum(4, ['james (#7)'], []) },
      { label: 'Model alone', sum: sum(3, ['james (#7)', 'Rose (#18)'], ['met (#1)']) },
    ],
    examples: [{ id: 7, masked: 'tell james that\nit is done' }],
  });
  assert.ok(md.startsWith('### How well it works\n\nPaste-Safe 9.9.9 was run over its [test set](https://example.test/eval.html): 2 made-up requests'));
  assert.ok(md.includes('with 5 names of people, organizations and places and 1 contact details and numbers labelled.'));
  assert.ok(md.includes('\n| Default | 4/5 | 1/1 | 0 |\n| Model alone | 3/5 | 1/1 | 1 |\n'));
  assert.ok(md.includes('**Missed at the default setting:** james (#7).'));
  assert.ok(md.includes('**Masked by mistake at the default setting:** nothing.'));
  assert.ok(md.includes('How one of the misses looked after masking:\n\n> #7: tell james that it is done'));
  assert.ok(md.endsWith('*Measured in a desktop browser on 2026-10-14. The test page runs in your browser, so anyone can re-run it.*'));
});
