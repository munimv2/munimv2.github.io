// Minimal repro: does onnx-community/gemma-3-270m-it-ONNX load and generate on
// device 'wasm' with the ONNX Runtime build Transformers.js 4.3.1 picks by
// default (asyncify), and with the plain build of the same version?
// By MV2 of Munim, Inc., made with AI agents. Apache-2.0.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL = 'onnx-community/gemma-3-270m-it-ONNX';
const STORE = 'gbq-repro-results';
const CASES = { 'default-q4': 'A', 'plain-q4': 'B', 'default-q8': 'C' };

const params = new URLSearchParams(location.search);
const build = params.get('build');
const dtype = params.get('dtype');
const caseId = CASES[`${build}-${dtype}`];

const out = document.getElementById('out');
const status = document.getElementById('status');
const runButton = document.getElementById('run');

const ORT = env.backends.onnx;
const ortVersion = ORT.versions?.web ?? 'unknown';

// The only difference between the cases: B points the runtime at the plain
// build of the same onnxruntime-web version before any model loads.
if (build === 'plain') {
  const dist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;
  ORT.wasm.wasmPaths = {
    mjs: `${dist}ort-wasm-simd-threaded.mjs`,
    wasm: `${dist}ort-wasm-simd-threaded.wasm`,
  };
}

function wasmFile() {
  const paths = ORT.wasm.wasmPaths;
  const url = typeof paths === 'string' ? paths : paths?.wasm;
  return url ? url.split('/').pop() : '(not set)';
}

function line(text) {
  out.textContent += `${text}\n`;
}

function loadResults() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function showResults() {
  const results = loadResults();
  const rows = Object.keys(results).sort().map((id) => {
    const r = results[id];
    return `| ${id} | ${cell(r.wasm)} | ${r.dtype} | ${r.ok ? 'yes' : 'no'} | ${cell(r.detail)} |`;
  });
  document.getElementById('results').textContent = rows.length
    ? ['| Case | WASM file loaded | dtype | Loaded and replied | Reply, or first error |', '|---|---|---|---|---|', ...rows].join('\n')
    : '(none yet)';
}

document.getElementById('system').textContent = [
  `- transformers.js: 4.3.1 (jsDelivr ESM build)`,
  `- onnxruntime-web: ${ortVersion}`,
  `- Browser: ${navigator.userAgent}`,
  `- navigator.gpu: ${'gpu' in navigator ? 'present' : 'absent'}`,
  `- Model: ${MODEL}, device 'wasm'`,
].join('\n');
showResults();

for (const [buttonId, sourceId] of [['copy-system', 'system'], ['copy-results', 'results']]) {
  document.getElementById(buttonId).addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById(sourceId).textContent);
    status.textContent = 'Copied.';
  });
}
document.getElementById('clear').addEventListener('click', () => {
  localStorage.removeItem(STORE);
  showResults();
});

if (caseId) {
  runButton.disabled = false;
  status.textContent = `Case ${caseId}: build=${build} dtype=${dtype}. Click Run (the first run downloads about 320-550 MB).`;
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  const wasm = wasmFile();
  line(`Case ${caseId}: onnxruntime-web ${ortVersion}, WASM file ${wasm}, dtype ${dtype}`);
  const seen = new Map();
  let ok = false;
  let detail = '';
  try {
    const generator = await pipeline('text-generation', MODEL, {
      dtype,
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        seen.set(p.file, [p.loaded, p.total]);
        let loaded = 0;
        let total = 0;
        for (const [l, t] of seen.values()) {
          loaded += l;
          total += t;
        }
        status.textContent = `Downloading ${Math.round((100 * loaded) / total)}% of ${Math.round(total / 1e6)} MB...`;
      },
    });
    status.textContent = 'Generating...';
    const result = await generator([{ role: 'user', content: 'Reply with one word: hello' }], {
      max_new_tokens: 8,
      do_sample: false,
    });
    ok = true;
    detail = JSON.stringify(result[0].generated_text.at(-1).content);
  } catch (err) {
    detail = String(err?.message ?? err).slice(0, 400);
  }
  const record = { wasm, dtype, ok, detail };
  const results = loadResults();
  results[caseId] = record;
  localStorage.setItem(STORE, JSON.stringify(results));
  showResults();
  line(`GBQ-RESULT case=${caseId} wasm=${record.wasm} dtype=${dtype} ok=${ok} ${ok ? 'reply' : 'error'}=${detail}`);
  status.textContent = `Done: case ${caseId} ${ok ? 'loaded and replied' : 'FAILED'}.`;
});
