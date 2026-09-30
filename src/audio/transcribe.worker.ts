/// <reference lib="webworker" />
/**
 * Speech to text, in a worker: Whisper (tiny, with word timings) through
 * transformers.js, run on the GPU where the browser offers WebGPU and on the
 * CPU (WebAssembly) otherwise. The model is served by the site when it has it
 * (npm run models), and fetched from Hugging Face otherwise; either way the
 * recording never leaves the browser.
 */
import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export type WorkerIn = { id: number; audio: Float32Array; base: string; language?: string };
export type WorkerOut =
  | { id: number; type: 'progress'; stage: 'model' | 'transcribing'; done?: number }
  | { id: number; type: 'done'; text: string; words: Array<{ text: string; start: number; end: number }>; quiet: Array<[number, number]> }
  | { id: number; type: 'error'; message: string };

const MODEL = 'onnx-community/whisper-tiny_timestamped';
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function load(base: string, id: number): Promise<AutomaticSpeechRecognitionPipeline> {
  asr ??= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    const has = (url: string) => fetch(url).then((r) => r.ok, () => false);
    env.allowLocalModels = true;
    env.localModelPath = `${base}/models/`;
    // Remote only when the site doesn't have the model itself.
    env.allowRemoteModels = !(await has(`${base}/models/${MODEL}/config.json`));
    const ort = `${base}/ort/`;
    if (await has(`${ort}ort-wasm-simd-threaded.mjs`)) (env.backends.onnx.wasm as { wasmPaths?: string }).wasmPaths = ort;
    // The model files are large: kept by transformers.js (and the site's service worker), not the HTTP cache, which can refuse them.
    const plain = fetch;
    (env as { fetch?: typeof fetch }).fetch = (input: RequestInfo | URL, init?: RequestInit) => plain(input, { ...init, cache: 'no-store' });
    const gpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    return (await pipeline('automatic-speech-recognition', MODEL, {
      device: gpu ? 'webgpu' : 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === 'progress') post({ id, type: 'progress', stage: 'model', done: (p.progress ?? 0) / 100 });
      },
    })) as AutomaticSpeechRecognitionPipeline;
  })();
  asr.catch(() => {
    asr = null;
  });
  return asr;
}

/** Whisper's chance that nothing is said above which a stretch has no speech (OpenAI's Whisper's threshold). */
const NO_SPEECH = 0.6;
/** The stretch Whisper listens to at once: 30 s at 16 kHz. */
const WINDOW = 480000;

/**
 * The stretches of the recording (seconds) in which nothing is said, where
 * Whisper makes words up all the same: each 30 s whose chance of no speech is
 * high, read as OpenAI's Whisper reads it (the probability of the "no speech"
 * token straight after the start of the transcript). None, if it can't be read.
 */
async function quiet(run: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<Array<[number, number]>> {
  try {
    const { Tensor } = await import('@huggingface/transformers');
    const tokenizer = run.tokenizer as unknown as { convert_tokens_to_ids(t: string[]): Array<number | undefined> };
    const [start, nocaptions, nospeech] = tokenizer.convert_tokens_to_ids(['<|startoftranscript|>', '<|nocaptions|>', '<|nospeech|>']);
    const none = nocaptions ?? nospeech;
    if (start === undefined || none === undefined) return [];
    const model = run.model as unknown as (x: object) => Promise<{ logits: { data: Float32Array } }>;
    const out: Array<[number, number]> = [];
    for (let at = 0; at < audio.length; at += WINDOW) {
      const { input_features } = await run.processor(audio.subarray(at, at + WINDOW));
      const { logits } = await model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.of(BigInt(start)), [1, 1]) });
      let max = -Infinity;
      for (const x of logits.data) max = Math.max(max, x);
      let sum = 0;
      for (const x of logits.data) sum += Math.exp(x - max);
      if (Math.exp(logits.data[none]! - max) / sum > NO_SPEECH) out.push([at / 16000, Math.min(at + WINDOW, audio.length) / 16000]);
    }
    return out;
  } catch {
    return [];
  }
}

function post(m: WorkerOut): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const { id, audio, base, language } = e.data;
  try {
    const run = await load(base, id);
    post({ id, type: 'progress', stage: 'transcribing' });
    const out = (await run(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: 'transcribe' } : {}),
    })) as { text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> };
    const words: Array<{ text: string; start: number; end: number }> = [];
    for (const c of out.chunks ?? []) {
      const text = c.text.trim();
      if (!text) continue;
      const end = c.timestamp[1] ?? c.timestamp[0];
      // Punctuation that follows a word without a space ("9" then "%") belongs to it, as the server's words do.
      const last = words[words.length - 1];
      if (last && !/^\s/.test(c.text) && !/[\p{L}\p{N}]/u.test(text)) {
        last.text += text;
        last.end = Math.max(last.end, end);
      } else words.push({ text, start: c.timestamp[0], end });
    }
    post({ id, type: 'done', text: out.text.trim(), words, quiet: await quiet(run, audio) });
  } catch (err) {
    post({ id, type: 'error', message: (err as Error).message || String(err) });
  }
};
