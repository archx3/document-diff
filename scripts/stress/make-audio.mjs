/**
 * Long recordings for the stress tests: two takes of a talk made of the
 * speech sample said over and over, B with some sentences said differently
 * (the sample's other take) and a pause added now and then, so there is
 * something to find and the takes drift apart in time.
 *
 * Run: node scripts/stress/make-audio.mjs [minutes …]   (default: 1 5 10 20 30 60)
 * Writes tests/fixtures/out/stress/talk-<minutes>m-a.wav and -b.wav (22.05 kHz mono, as the samples),
 * and with --large, talk-<minutes>m-a-stereo.wav (44.1 kHz stereo) and talk-<minutes>m-a.m4a (AAC).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const SAMPLES = join(import.meta.dirname, '..', '..', 'public', 'samples');

/** The PCM samples (16-bit, mono) and rate of a WAV file. */
function readWav(path) {
  const b = readFileSync(path);
  let off = 12;
  let rate = 0;
  let channels = 1;
  let data;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
    }
    if (id === 'data') data = b.subarray(off + 8, off + 8 + len);
    off += 8 + len + (len & 1);
  }
  const n = data.length / 2 / channels;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2 * channels);
  return { rate, pcm };
}

function writeWav(path, pcm, rate, channels = 1) {
  const bytes = pcm.length * 2 * channels;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2 * channels, 28);
  out.writeUInt16LE(2 * channels, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(bytes, 40);
  for (let i = 0, k = 44; i < pcm.length; i++) for (let c = 0; c < channels; c++, k += 2) out.writeInt16LE(pcm[i], k);
  writeFileSync(path, out);
}

/** The same samples at twice the rate (each one twice): a larger file that sounds the same. */
function doubled(pcm) {
  const out = new Int16Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) out[2 * i] = out[2 * i + 1] = pcm[i];
  return out;
}

const minutes = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const large = process.argv.includes('--large');
const one = readWav(join(SAMPLES, 'speech-v1.wav'));
const two = readWav(join(SAMPLES, 'speech-v2.wav'));
if (one.rate !== two.rate) throw new Error('the samples differ in rate');
const rate = one.rate;
const pause = (s) => new Int16Array(Math.round(s * rate));
mkdirSync(OUT, { recursive: true });

for (const m of minutes.length ? minutes : [1, 5, 10, 20, 30, 60]) {
  const total = Math.round(m * 60 * rate);
  const a = new Int16Array(total);
  const b = new Int16Array(total + Math.round(m * 6 * rate));
  let ia = 0;
  let ib = 0;
  for (let k = 0; ia < total; k++) {
    const put = (dst, at, src) => {
      const n = Math.min(src.length, dst.length - at);
      if (n > 0) dst.set(src.subarray(0, n), at);
      return at + Math.max(0, n);
    };
    ia = put(a, ia, one.pcm);
    ia = put(a, ia, pause(1));
    // One sentence in 7 said differently in B, and one pause in 11 longer.
    ib = put(b, ib, k % 7 === 3 ? two.pcm : one.pcm);
    ib = put(b, ib, pause(k % 11 === 5 ? 2.5 : 1));
  }
  const stem = join(OUT, `talk-${m}m`);
  writeWav(`${stem}-a.wav`, a, rate);
  writeWav(`${stem}-b.wav`, b.subarray(0, ib), rate);
  if (large) {
    writeWav(`${stem}-a-stereo.wav`, doubled(a), rate * 2, 2);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', `${stem}-a.wav`, `${stem}-a.m4a`]);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', `${stem}-b.wav`, `${stem}-b.m4a`]);
  }
  console.log(`${m} min: A ${(a.length / rate / 60).toFixed(1)} min, B ${(ib / rate / 60).toFixed(1)} min`);
}
