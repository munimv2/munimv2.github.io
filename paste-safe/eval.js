// Paste-Safe test set page: runs the same masking as the main page over the
// 30 labelled made-up messages in eval-data.js and counts what would still show.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { VERSION, chunkText, findSpans, maskText } from './core.js';
import { CASES } from './eval-data.js';
import { scoreCase, summarize, resultLine, reportMarkdown } from './evalcore.js';

const MODEL = 'Xenova/bert-base-NER';
const NER_TYPES = ['PER', 'ORG', 'LOC'];
const REPORT_URL = 'https://munimv2.github.io/paste-safe/eval.html';
// The first setting is the page default and the one shown in the table.
const SETTINGS = [
  { label: 'Default (confidence 0.6, name rules on)', minScore: 0.6, rules: true },
  { label: 'Model alone (confidence 0.6, name rules off)', minScore: 0.6, rules: false },
  { label: 'Mask more (confidence 0.4, name rules on)', minScore: 0.4, rules: true },
];
const $ = (id) => document.getElementById(id);

function status(text) {
  $('status').textContent = text;
}

function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.append(td);
}

function renderRow(c, masked, r) {
  const row = document.createElement('tr');
  cell(row, `#${c.id}`);
  cell(row, masked);
  cell(row, `${r.names.total - r.names.leaked.length}/${r.names.total}`);
  cell(row, [...r.names.leaked, ...r.details.leaked].join(', ') || '-');
  cell(row, r.extra.join(', ') || '-');
  $('rows').append(row);
}

async function run() {
  $('run').disabled = true;
  $('rows').replaceChildren();
  $('result').textContent = '';
  $('report').value = '';
  try {
    status('Loading the name-finding model (about 110 MB, once)...');
    const ner = await pipeline('token-classification', MODEL, { dtype: 'q8' });
    const scores = SETTINGS.map(() => []);
    const examples = [];
    for (const [i, c] of CASES.entries()) {
      status(`Message ${i + 1} of ${CASES.length}...`);
      const nerTokens = [];
      for (const chunk of chunkText(c.text)) {
        nerTokens.push({ ...chunk, tokens: await ner(chunk.text, { ignore_labels: [] }) });
      }
      for (const [n, setting] of SETTINGS.entries()) {
        const spans = findSpans(c.text, { nerTokens, nerTypes: NER_TYPES, minScore: setting.minScore, rules: setting.rules });
        const r = { id: c.id, ...scoreCase(c.text, spans, c) };
        scores[n].push(r);
        if (n > 0) continue;
        const { masked } = maskText(c.text, spans);
        renderRow(c, masked, r);
        if (r.names.leaked.length && examples.length < 2) examples.push({ id: c.id, masked });
      }
    }
    const rows = SETTINGS.map((setting, n) => ({ label: setting.label, sum: summarize(scores[n]) }));
    $('result').textContent = [
      resultLine(`EVAL ${VERSION} ${rows[0].label}`, rows[0].sum),
      resultLine(`EVAL ${rows[1].label}`, rows[1].sum),
    ].join('\n');
    $('report').value = reportMarkdown({
      version: VERSION, date: new Date().toISOString().slice(0, 10), url: REPORT_URL, rows, examples,
    });
    status(`Done: ${CASES.length} messages.`);
  } catch (err) {
    status(`EVAL FAILED: ${err.message}`);
  } finally {
    $('run').disabled = false;
  }
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText($('report').value);
    $('copy-status').textContent = 'Copied.';
  } catch {
    $('report').select();
    $('copy-status').textContent = 'Selected; press Ctrl+C (or Cmd+C) to copy.';
  }
}

$('count').textContent = String(CASES.length);
$('version').textContent = VERSION;
$('run').addEventListener('click', run);
$('copy-report').addEventListener('click', copyReport);
