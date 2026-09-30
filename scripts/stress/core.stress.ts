// @vitest-environment jsdom
/**
 * The comparison's own cost, without a browser: reading, comparing and the
 * word-level diffs of large documents, and lining up long recordings. Writes
 * what it measured to tests/fixtures/out/stress/core.json.
 *
 * Run: npx vitest run --config scripts/stress/vitest.config.ts core
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { alignFrames, findDifferences } from '../../src/audio/align';
import { featureRate, features } from '../../src/audio/analyze';
import { compareDocs, inlineDiff } from '../../src/core/compare';
import { movesByRow } from '../../src/core/moves';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDocx } from '../../src/formats/docx/read';
import { readText } from '../../src/formats/text/read';

const DIR = join(__dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const results: Record<string, unknown>[] = [];
const mb = (n: number) => Math.round(n / 1048576);
const ms = (t0: number) => Math.round(performance.now() - t0);

for (const size of [1000, 5000, 10000, 25000, 50000]) {
  for (const ext of ['txt', 'docx'] as const) {
    const a = join(DIR, `doc-${size}-a.${ext}`);
    it.skipIf(!existsSync(a))(`documents: ${size} paragraphs, .${ext}`, () => {
      globalThis.gc?.();
      const heap0 = process.memoryUsage().heapUsed;
      let t = performance.now();
      const read = (side: 'a' | 'b') => {
        const bytes = readFileSync(join(DIR, `doc-${size}-${side}.${ext}`));
        return ext === 'txt' ? readText(bytes.toString('utf8'), `${side}.txt`) : readDocx(bytes, `${side}.docx`);
      };
      const [da, db] = [read('a'), read('b')];
      const readMs = ms(t);
      t = performance.now();
      const cmp = compareDocs(da, db, DEFAULT_OPTIONS);
      const compareMs = ms(t);
      t = performance.now();
      let words = 0;
      for (const r of cmp.rows) if (r.kind === 'mod' && r.l?.type === 'p' && r.r?.type === 'p') words += inlineDiff(r.l, r.r, DEFAULT_OPTIONS).changes.length;
      const inlineMs = ms(t);
      t = performance.now();
      const moves = movesByRow(cmp).size;
      const movesMs = ms(t);
      results.push({ kind: 'document', size, ext, blocks: [da.blocks.length, db.blocks.length], rows: cmp.rows.length, changes: cmp.hunks.length, wordChanges: words, moves, readMs, compareMs, inlineMs, movesMs, heapMB: mb(process.memoryUsage().heapUsed - heap0) });
    });
  }
}

/** A WAV file's first channel, at 16 kHz (as the page analyses it): linear resampling is enough to measure. */
function wav16k(path: string): Float32Array {
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
  const m = Math.floor((n * 16000) / rate);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = (i * rate) / 16000;
    const k = Math.floor(x);
    const f = x - k;
    const s0 = data.readInt16LE(k * 2 * channels) / 32768;
    const s1 = k + 1 < n ? data.readInt16LE((k + 1) * 2 * channels) / 32768 : s0;
    out[i] = s0 * (1 - f) + s1 * f;
  }
  return out;
}

for (const minutes of [1, 5, 10, 20, 30, 60]) {
  const a = join(DIR, `talk-${minutes}m-a.wav`);
  it.skipIf(!existsSync(a))(`recordings: ${minutes} min`, () => {
    const sa = wav16k(a);
    const sb = wav16k(join(DIR, `talk-${minutes}m-b.wav`));
    let t = performance.now();
    const fps = featureRate(Math.max(sa.length, sb.length) / 16000);
    const fa = features(sa, 16000, fps);
    const fb = features(sb, 16000, fps);
    const featuresMs = ms(t);
    t = performance.now();
    const path = alignFrames(fa, fb);
    const alignMs = ms(t);
    t = performance.now();
    const diffs = findDifferences(fa, fb, path);
    const findMs = ms(t);
    results.push({ kind: 'recording', minutes, frames: [fa.frames, fb.frames], fps: +fa.fps.toFixed(2), secondsPerFrame: +(1 / fa.fps).toFixed(2), differences: diffs.length, featuresMs, alignMs, findMs, samplesMB: mb((sa.length + sb.length) * 4) });
  });
}

for (const minutes of [10, 30, 60]) {
  const a = join(DIR, `speech-${minutes}m-a.wav`);
  it.skipIf(!existsSync(a))(`speech: ${minutes} min`, () => {
    const truth = JSON.parse(readFileSync(join(DIR, `speech-${minutes}m.json`), 'utf8')) as { reworded: number; removed: number; added: number };
    const sa = wav16k(a);
    const sb = wav16k(join(DIR, `speech-${minutes}m-b.wav`));
    let t = performance.now();
    const fps = featureRate(Math.max(sa.length, sb.length) / 16000);
    const fa = features(sa, 16000, fps);
    const fb = features(sb, 16000, fps);
    const featuresMs = ms(t);
    t = performance.now();
    const path = alignFrames(fa, fb);
    const alignMs = ms(t);
    const diffs = findDifferences(fa, fb, path);
    const kinds: Record<string, number> = {};
    for (const d of diffs) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
    results.push({ kind: 'speech', minutes, edits: truth, editCount: truth.reworded + truth.removed + truth.added, differences: diffs.length, kinds, fps: +fps.toFixed(2), featuresMs, alignMs });
  });
}

it('writes the results', () => {
  writeFileSync(join(DIR, 'core.json'), JSON.stringify(results, null, 1));
});
