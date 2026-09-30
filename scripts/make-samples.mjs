/**
 * Writes the melody pair for the samples page (public/samples/melody-v*.wav):
 * a short tune, then the same tune with one note changed and a note added at
 * the end. Run with `node scripts/make-samples.mjs`; the other samples are
 * written by hand or copied from tests/fixtures.
 */
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const NOTE = 0.42;
const GAP = 0.06;

const FREQ = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, C5: 523.25 };

/** One note: a soft organ tone (a sine and two overtones) with a short attack and release. */
function note(freq, seconds) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.02) * Math.min(1, (seconds - t) / 0.08);
    const s = Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) + 0.12 * Math.sin(6 * Math.PI * freq * t);
    out[i] = 0.42 * env * s;
  }
  return out;
}

function tune(notes) {
  const parts = [new Float32Array(Math.round(0.25 * RATE))];
  for (const [name, beats = 1] of notes) {
    parts.push(note(FREQ[name], NOTE * beats), new Float32Array(Math.round(GAP * RATE)));
  }
  parts.push(new Float32Array(Math.round(0.3 * RATE)));
  const len = parts.reduce((s, p) => s + p.length, 0);
  const all = new Float32Array(len);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return buf;
}

const A = [['C4'], ['D4'], ['E4'], ['C4'], ['E4'], ['F4'], ['G4', 2]];
const B = [['C4'], ['D4'], ['E4'], ['C4'], ['E4'], ['A4'], ['G4', 2], ['C5', 2]];

writeFileSync('public/samples/melody-v1.wav', wav(tune(A)));
writeFileSync('public/samples/melody-v2.wav', wav(tune(B)));
