// Paste-Safe test set page: runs the same masking as the main page over the
// 30 labelled made-up messages in eval-data.js and counts what would still show.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { VERSION, chunkText, findSpans, maskText } from './core.js';
import { CASES } from './eval-data.js';
import { scoreCase, summarize, resultLine } from './evalcore.js';

const MODEL = 'Xenova/bert-base-NER';
const NER_TYPES = ['PER', 'ORG', 'LOC'];
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
  try {
    status('Loading the name-finding model (about 110 MB, once)...');
    const ner = await pipeline('token-classification', MODEL, { dtype: 'q8' });
    const scores = { '0.6': [], '0.4': [] };
    for (const [i, c] of CASES.entries()) {
      status(`Message ${i + 1} of ${CASES.length}...`);
      const nerTokens = [];
      for (const chunk of chunkText(c.text)) {
        nerTokens.push({ ...chunk, tokens: await ner(chunk.text, { ignore_labels: [] }) });
      }
      for (const minScore of Object.keys(scores)) {
        const spans = findSpans(c.text, { nerTokens, nerTypes: NER_TYPES, minScore: Number(minScore) });
        const r = { id: c.id, ...scoreCase(c.text, spans, c) };
        scores[minScore].push(r);
        if (minScore === '0.6') renderRow(c, maskText(c.text, spans).masked, r);
      }
    }
    $('result').textContent = [
      resultLine(`EVAL ${VERSION} at confidence 0.6 (the default)`, summarize(scores['0.6'])),
      resultLine('EVAL at confidence 0.4', summarize(scores['0.4'])),
    ].join('\n');
    status(`Done: ${CASES.length} messages.`);
  } catch (err) {
    status(`EVAL FAILED: ${err.message}`);
  } finally {
    $('run').disabled = false;
  }
}

$('count').textContent = String(CASES.length);
$('run').addEventListener('click', run);
