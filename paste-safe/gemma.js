// The optional second look, shared by the main page and the test page:
// Gemma 3 270M runs in this browser tab through Transformers.js, lists the
// names it sees, and core.js keeps only those really in the text.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { secondLookMessages, parseNameList } from './core.js';

export const GEMMA_MODEL = 'onnx-community/gemma-3-270m-it-ONNX';

// Transformers.js 4.3.1 loads ONNX Runtime's asyncify WASM build, which has no
// CPU kernel for the GatherBlockQuantized op in Gemma's 4-bit file ("Could not
// find an implementation for GatherBlockQuantized(1)"). The plain build has
// one. Both pages import this file before any model loads, so the first
// model's session already starts on the plain build. Nothing here uses WebGPU.
const ORT = env.backends?.onnx;
if (ORT?.wasm) {
  const dist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT.versions?.web || '1.31.0-dev.20260914-8d85527a0'}/dist/`;
  ORT.wasm.wasmPaths = {
    mjs: `${dist}ort-wasm-simd-threaded.mjs`,
    wasm: `${dist}ort-wasm-simd-threaded.wasm`,
  };
}

// 4-bit first (about 323 MB); the 8-bit file (about 545 MB) only if that fails.
const DTYPES = ['q4', 'q8'];
export const DTYPE_NAMES = { q4: '4-bit', q8: '8-bit' };

let generator = null;
export let gemmaDtype = null;

// onProgress(percent, megabytes) is called while the files download.
export async function loadGemma(onProgress = () => {}) {
  if (generator) return generator;
  let lastError = null;
  for (const dtype of DTYPES) {
    const seen = new Map();
    try {
      generator = await pipeline('text-generation', GEMMA_MODEL, {
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
          onProgress(Math.round((100 * loaded) / total), Math.round(total / 1e6));
        },
      });
      gemmaDtype = dtype;
      return generator;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// The names Gemma finds in one chunk of text, as [{ name, type }].
export async function secondLook(text) {
  const output = await generator(secondLookMessages(text), { max_new_tokens: 128, do_sample: false });
  return parseNameList(text, output[0].generated_text.at(-1).content);
}
