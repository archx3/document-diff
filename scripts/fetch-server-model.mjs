// Downloads a whisper.cpp model for the transcription service (server/transcribe).
// `npm run server:model` fetches ggml-base (142 MB, many languages); pass another
// name (tiny, base.en, small, small.en, medium …) for a different size.
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const name = process.argv[2] ?? 'base';
const dir = new URL('../server/transcribe/models/', import.meta.url);
const file = new URL(`ggml-${name}.bin`, dir);
mkdirSync(dir, { recursive: true });
if (existsSync(file)) {
  console.log(`Already here: server/transcribe/models/ggml-${name}.bin`);
  process.exit(0);
}
const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
const part = new URL(`ggml-${name}.bin.part`, dir);
await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
renameSync(part, file);
console.log(`Saved server/transcribe/models/ggml-${name}.bin`);
