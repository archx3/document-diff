/**
 * How the transcription service holds up: many recordings at once, long ones,
 * one over the limit, and short ones waiting behind a long one. Each is sent
 * to the site's /api/transcribe (which passes it to server/transcribe), as the
 * page sends it (16 kHz mono WAV), and timed, while the whisper processes'
 * CPU and memory are sampled.
 *
 * Run: node scripts/stress/transcribe-load.mjs [site]   (default http://localhost:4174)
 * Needs the site and the transcription service running, and make-speech.mjs's recordings.
 * Writes tests/fixtures/out/stress/transcribe.json.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = (process.argv[2] ?? 'http://localhost:4174').replace(/\/+$/, '');
const DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const RATE = 16000;

/** A WAV file's first channel as samples in [-1, 1], and its rate. */
function readWav(path) {
  const b = readFileSync(path);
  let off = 12;
  let rate = 0;
  let channels = 1;
  let data = b.subarray(0, 0);
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
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2 * channels) / 32768;
  return { rate, samples: out };
}

/** The first `seconds` of a recording as the page sends it: 16 kHz mono, 16-bit WAV. */
function wav16k(path, seconds = Infinity) {
  const { rate, samples } = readWav(path);
  const n = Math.min(Math.floor((samples.length * RATE) / rate), Math.floor(seconds * RATE));
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / RATE;
    const k = Math.floor(x);
    const f = x - k;
    const s = samples[k] * (1 - f) + (samples[k + 1] ?? samples[k]) * f;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
  }
  return { body: out, seconds: n / RATE };
}

/** The whisper processes now: how many, their CPU (percent of one core) and memory. */
function whisper() {
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pcpu=,rss=,comm='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => /whisper/.test(l));
    return rows.reduce((t, l) => {
      const [cpu, rss] = l.trim().split(/\s+/);
      return { n: t.n + 1, cpu: t.cpu + Number(cpu), mb: t.mb + Number(rss) / 1024 };
    }, { n: 0, cpu: 0, mb: 0 });
  } catch {
    return { n: 0, cpu: 0, mb: 0 };
  }
}

/** Samples the whisper processes until stopped: the most at once, and peak CPU and memory. */
function sampler() {
  const peak = { n: 0, cpu: 0, mb: 0 };
  const t = setInterval(() => {
    const w = whisper();
    peak.n = Math.max(peak.n, w.n);
    peak.cpu = Math.max(peak.cpu, Math.round(w.cpu));
    peak.mb = Math.max(peak.mb, Math.round(w.mb));
  }, 250);
  return () => (clearInterval(t), peak);
}

async function send(rec, label) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${SITE}/api/transcribe/?lang=en`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: rec.body });
    const json = await res.json().catch(() => ({}));
    return { label, status: res.status, ms: Math.round(performance.now() - t0), words: json.words?.length ?? 0, error: json.error };
  } catch (e) {
    return { label, status: 0, ms: Math.round(performance.now() - t0), error: String(e) };
  }
}

const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const results = { site: SITE, when: new Date().toISOString(), health: await (await fetch(`${SITE}/api/transcribe/`)).json(), runs: [] };
console.log('service', results.health);

// Many at once: a 5-second clip, sent by 1 to 32 readers at the same moment.
const clip = wav16k(join(DIR, 'speech-10m-a.wav'), 5);
for (const n of [1, 2, 4, 8, 16, 32]) {
  const stop = sampler();
  const t0 = performance.now();
  const all = await Promise.all(Array.from({ length: n }, (_, i) => send(clip, `clip ${i + 1}`)));
  const wall = Math.round(performance.now() - t0);
  const ms = all.map((r) => r.ms);
  const run = { kind: 'at once', recordings: n, seconds: clip.seconds, wallMs: wall, statuses: [...new Set(all.map((r) => r.status))], p50: pct(ms, 50), p90: pct(ms, 90), max: Math.max(...ms), whisper: stop() };
  results.runs.push(run);
  console.log(JSON.stringify(run));
}

// Long ones, one at a time: how long each takes, against its length.
for (const [file, seconds] of [
  ['speech-10m-a.wav', 60],
  ['speech-10m-a.wav', 300],
  ['speech-10m-a.wav', 600],
  ['speech-30m-a.wav', 1770],
]) {
  const rec = wav16k(join(DIR, file), seconds);
  const stop = sampler();
  const r = await send(rec, `${seconds} s`);
  const run = { kind: 'long', seconds: Math.round(rec.seconds), mb: +(rec.body.length / 1048576).toFixed(1), ...r, realtime: +(rec.seconds / (r.ms / 1000)).toFixed(1), whisper: stop() };
  results.runs.push(run);
  console.log(JSON.stringify(run));
}

// Over the limit: the service refuses it (413), once a worker is free to read it.
{
  const rec = wav16k(join(DIR, 'speech-30m-a.wav'));
  const r = await send(rec, 'over the limit');
  const run = { kind: 'over the limit', seconds: Math.round(rec.seconds), mb: +(rec.body.length / 1048576).toFixed(1), ...r };
  results.runs.push(run);
  console.log(JSON.stringify(run));
}

// Short ones behind long ones: two 10-minute recordings take both workers, then four clips arrive.
{
  const long = wav16k(join(DIR, 'speech-10m-a.wav'), 600);
  const stop = sampler();
  const t0 = performance.now();
  const longs = [send(long, 'long 1'), send(long, 'long 2')];
  await new Promise((r) => setTimeout(r, 1000));
  const clips = await Promise.all(Array.from({ length: 4 }, (_, i) => send(clip, `clip ${i + 1}`)));
  const done = await Promise.all(longs);
  const run = { kind: 'behind long ones', longMs: done.map((r) => r.ms), clipMs: clips.map((r) => r.ms), statuses: [...new Set([...done, ...clips].map((r) => r.status))], wallMs: Math.round(performance.now() - t0), whisper: stop() };
  results.runs.push(run);
  console.log(JSON.stringify(run));
}

writeFileSync(join(DIR, 'transcribe.json'), JSON.stringify(results, null, 1));
