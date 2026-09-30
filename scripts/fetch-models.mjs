/**
 * Downloads the speech-recognition model (Whisper tiny, with word timings,
 * quantized: about 41 MB) into public/models/, and copies ONNX Runtime's
 * WebAssembly files into public/ort/, so transcription runs from the site
 * itself — offline, and without any request to a model hub. Without them the
 * app downloads the same model from Hugging Face the first time it is used.
 *
 *   npm run models
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MODEL = 'onnx-community/whisper-tiny_timestamped';
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'added_tokens.json',
  'special_tokens_map.json',
  'normalizer.json',
  'vocab.json',
  'merges.txt',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const OUT = join('public', 'models', MODEL);

async function download(file) {
  const to = join(OUT, file);
  if (existsSync(to) && statSync(to).size > 0) return 'kept';
  const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${file}`);
  if (res.status === 404) return 'none';
  if (!res.ok) throw new Error(`${file}: ${res.status} ${res.statusText}`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, new Uint8Array(await res.arrayBuffer()));
  return 'fetched';
}

for (const f of FILES) {
  const how = await download(f);
  console.log(`${how.padEnd(8)} ${MODEL}/${f}`);
}

// ONNX Runtime's WebAssembly (the engine the model runs on), served beside the site.
const ort = join('node_modules', 'onnxruntime-web', 'dist');
mkdirSync(join('public', 'ort'), { recursive: true });
for (const f of readdirSync(ort)) {
  if (!/^ort-wasm-simd-threaded(\.jsep|\.asyncify)?\.(wasm|mjs)$/.test(f)) continue;
  copyFileSync(join(ort, f), join('public', 'ort', f));
  console.log(`copied   ort/${f}`);
}
