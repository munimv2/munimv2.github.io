// The optional second look, shared by the main page and the test page:
// Gemma 3 270M runs in this browser tab through Transformers.js, lists the
// names it sees, and core.js keeps only those really in the text.
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { secondLookMessages, parseNameList } from './core.js';

export const GEMMA_MODEL = 'onnx-community/gemma-3-270m-it-ONNX';

let generator = null;

// onProgress(percent, megabytes) is called while the files download.
export async function loadGemma(onProgress = () => {}) {
  if (generator) return generator;
  const seen = new Map();
  generator = await pipeline('text-generation', GEMMA_MODEL, {
    dtype: 'q4',
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
  return generator;
}

// The names Gemma finds in one chunk of text, as [{ name, type }].
export async function secondLook(text) {
  const output = await generator(secondLookMessages(text), { max_new_tokens: 128, do_sample: false });
  return parseNameList(text, output[0].generated_text.at(-1).content);
}
