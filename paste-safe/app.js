// Paste-Safe page wiring. The model runs here in the browser through
// Transformers.js; the text you paste is never sent anywhere.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { VERSION, chunkText, findSpans, maskText, restoreText, newKey } from './core.js';

env.allowLocalModels = false;

const MODEL = 'Xenova/bert-base-NER';
const $ = (id) => document.getElementById(id);

const SAMPLE = `Hi Maria,

Following our call, here is the brief for Northwind Traders. Their CFO, Daniel Okafor, wants the Q3 newsletter to explain the move from Leeds to Rotterdam without naming the old landlord, Harrow Estates.

Daniel's direct line is +44 20 7946 0958 and his email is daniel.okafor@northwind-traders.example. Invoices go to IBAN GB33 BUKB 2020 1555 5555 55. Draft due Friday; please keep Project Bluebird out of anything public.

Thanks,
Sam`;

let key = newKey();
let ner = null;
let nerFailed = false;

function status(text) {
  $('status').textContent = text;
}

async function loadModel() {
  if (ner || nerFailed) return ner;
  status('Loading the name-finding model (about 110 MB, once; your browser keeps it)...');
  const seen = new Map();
  try {
    ner = await pipeline('token-classification', MODEL, {
      dtype: 'q8',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        seen.set(p.file, [p.loaded, p.total]);
        let loaded = 0;
        let total = 0;
        for (const [l, t] of seen.values()) {
          loaded += l;
          total += t;
        }
        status(`Loading the name-finding model: ${Math.round((100 * loaded) / total)}% of ${Math.round(total / 1e6)} MB`);
      },
    });
    status('Model ready. It runs on this device.');
  } catch (err) {
    nerFailed = true;
    status(`The model could not load (${err.message}). Contact details, numbers and your own list still work; names will not be found automatically.`);
  }
  return ner;
}

function nerTypes() {
  return ['PER', 'ORG', 'LOC', 'MISC'].filter((t) => $(`ner-${t}`).checked);
}

function lines(id) {
  return $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function runMask() {
  const text = $('input').value;
  if (!text.trim()) {
    status('Paste some text first.');
    return;
  }
  $('mask').disabled = true;
  try {
    const types = nerTypes();
    const nerTokens = [];
    if (types.length && (await loadModel())) {
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        status(`Reading part ${i + 1} of ${chunks.length}...`);
        const tokens = await ner(chunks[i].text, { ignore_labels: [] });
        nerTokens.push({ ...chunks[i], tokens });
      }
    }
    const spans = findSpans(text, {
      nerTokens,
      nerTypes: types,
      contact: $('opt-contact').checked,
      numbers: $('opt-numbers').checked,
      terms: lines('always'),
      keep: lines('never'),
      minScore: Number($('min-score').value),
    });
    const { masked } = maskText(text, spans, key);
    $('masked').value = masked;
    renderKey();
    status(`Masked ${spans.length} item${spans.length === 1 ? '' : 's'}. Read the result before you paste it anywhere: automatic detection can miss things.`);
  } catch (err) {
    status(`Something went wrong: ${err.message}`);
  } finally {
    $('mask').disabled = false;
  }
}

function renderKey() {
  const body = $('key-rows');
  body.replaceChildren();
  for (const e of key.entries) {
    const row = document.createElement('tr');
    for (const value of [e.placeholder, e.original]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  $('key-count').textContent = String(key.entries.length);
}

function runRestore() {
  const { restored, count, leftover } = restoreText($('answer').value, key);
  $('restored').value = restored;
  let note = `Put back ${count} item${count === 1 ? '' : 's'}.`;
  if (leftover.length) note += ` Not in this key: ${leftover.join(', ')}.`;
  status(note);
}

async function copy(id) {
  try {
    await navigator.clipboard.writeText($(id).value);
    status('Copied.');
  } catch {
    $(id).select();
    status('Select-all done; press Ctrl+C (or Cmd+C) to copy.');
  }
}

function downloadKey() {
  const blob = new Blob([JSON.stringify(key, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'paste-safe-key.json';
  a.click();
  URL.revokeObjectURL(a.href);
  status('Key saved to your downloads. It holds the real names: keep it private.');
}

async function loadKey(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error('no entries');
    key = { version: VERSION, entries: data.entries.filter((e) => e.placeholder && e.type && typeof e.original === 'string') };
    renderKey();
    status(`Loaded a key with ${key.entries.length} entries.`);
  } catch (err) {
    status(`That file is not a Paste-Safe key (${err.message}).`);
  }
}

function clearKey() {
  key = newKey();
  renderKey();
  status('Key cleared. New placeholders start from 1.');
}

$('mask').addEventListener('click', runMask);
$('restore').addEventListener('click', runRestore);
$('copy-masked').addEventListener('click', () => copy('masked'));
$('copy-restored').addEventListener('click', () => copy('restored'));
$('save-key').addEventListener('click', downloadKey);
$('load-key').addEventListener('change', (ev) => ev.target.files[0] && loadKey(ev.target.files[0]));
$('clear-key').addEventListener('click', clearKey);
$('sample').addEventListener('click', () => {
  $('input').value = SAMPLE;
  $('always').value = 'Project Bluebird';
});
$('version').textContent = VERSION;
renderKey();
