import { describe, expect, it } from 'vitest';
import { alignFrames, findDifferences, timeMap } from '../../src/audio/align';
import { features, fft, loudness, peaks, spectrogram } from '../../src/audio/analyze';
import { diffWords, heardWords, pairedSentences } from '../../src/audio/words';

const RATE = 16000;

/** A recording made of tones: [frequency (0 for silence), seconds, gain]. */
function tones(parts: Array<[number, number, number?]>): Float32Array {
  const total = parts.reduce((n, [, s]) => n + Math.round(s * RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  let seed = 1;
  for (const [f, s, gain = 0.5] of parts) {
    const n = Math.round(s * RATE);
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const noise = ((seed / 2147483647) * 2 - 1) * 0.002;
      out[at + i] = (f ? gain * Math.sin((2 * Math.PI * f * i) / RATE) : 0) + noise;
    }
    at += n;
  }
  return out;
}

function compare(a: Float32Array, b: Float32Array, sensitivity = 70) {
  const fa = features(a, RATE);
  const fb = features(b, RATE);
  const path = alignFrames(fa, fb);
  return { diffs: findDifferences(fa, fb, path, { sensitivity }), map: timeMap(path, fa.fps, fb.fps) };
}

const round = (x: number) => Math.round(x * 10) / 10;

describe('audio analysis', () => {
  it('finds a tone with the FFT', () => {
    const re = new Float64Array(64);
    const im = new Float64Array(64);
    for (let i = 0; i < 64; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / 64);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]!));
    expect(mags.indexOf(Math.max(...mags.slice(0, 32)))).toBe(5);
  });

  it('draws peaks, loudness and a spectrogram', () => {
    const s = tones([[440, 1], [0, 1]]);
    const p = peaks(s, 2);
    expect(p[1]).toBeGreaterThan(0.45);
    expect(Math.abs(p[3]!)).toBeLessThan(0.01);
    const l = loudness(s, RATE);
    expect(l[0]).toBeGreaterThan(-10);
    expect(l[1]).toBeLessThan(-50);
    const sg = spectrogram(s, RATE, 4, 512);
    // The loudest bin of the first column is the tone's (440 Hz, bin 14 of 256).
    const col = Array.from(sg.data.slice(0, sg.bins));
    expect(Math.abs(col.indexOf(Math.max(...col)) - Math.round((440 / 8000) * 256))).toBeLessThanOrEqual(1);
  });
});

describe('audio differences', () => {
  const base: Array<[number, number, number?]> = [
    [440, 1],
    [660, 1],
    [880, 1],
    [523, 1],
  ];

  it('finds nothing between a recording and itself', () => {
    expect(compare(tones(base), tones(base)).diffs).toEqual([]);
  });

  it('finds a changed stretch where it is on both', () => {
    const b = tones([[440, 1], [550, 1], [880, 1], [523, 1]]);
    const { diffs } = compare(tones(base), b);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.kind).toBe('changed');
    expect([round(diffs[0]!.aStart), round(diffs[0]!.aEnd)]).toEqual([1, 2]);
    expect([round(diffs[0]!.bStart), round(diffs[0]!.bEnd)]).toEqual([1, 2]);
  });

  it('finds what B added, and lines up what comes after it', () => {
    const b = tones([[440, 1], [330, 1], [660, 1], [880, 1], [523, 1]]);
    const { diffs, map } = compare(tones(base), b);
    expect(diffs.map((d) => d.kind)).toEqual(['added']);
    expect(round(diffs[0]!.bStart)).toBeCloseTo(1, 0);
    expect(round(diffs[0]!.bEnd - diffs[0]!.bStart)).toBeCloseTo(1, 0);
    // 2.5 s into A is 3.5 s into B, after the added second.
    expect(map.aToB(2.5)).toBeCloseTo(3.5, 0);
    expect(map.bToA(3.5)).toBeCloseTo(2.5, 0);
  });

  it('finds what B removed', () => {
    const b = tones([[440, 1], [880, 1], [523, 1]]);
    const { diffs } = compare(tones(base), b);
    expect(diffs.map((d) => d.kind)).toEqual(['removed']);
    expect([round(diffs[0]!.aStart), round(diffs[0]!.aEnd)]).toEqual([1, 2]);
  });

  it('finds a change in loudness, and lets it through at a low sensitivity', () => {
    const b = tones([[440, 1], [660, 1], [880, 1, 0.08], [523, 1]]);
    expect(compare(tones(base), b).diffs.map((d) => [d.kind, round(d.aStart)])).toEqual([['changed', 2]]);
    expect(compare(tones(base), b, 0).diffs).toEqual([]);
  });
});

describe('transcripts', () => {
  it('compares two transcripts word by word, ignoring case and punctuation, keeping each word’s time', async () => {
    const { diffWords, wordChanges } = await import('../../src/audio/words');
    const words = (s: string, at = 0) => s.split(' ').map((text, i) => ({ text, start: at + i * 0.5, end: at + i * 0.5 + 0.4 }));
    const runs = diffWords(words('The fee is nine thousand dollars.'), words('the fee is ten thousand dollars'));
    expect(runs.map((r) => [r.same, r.a.map((w) => w.text).join(' '), r.b.map((w) => w.text).join(' ')])).toEqual([
      [true, 'The fee is', 'the fee is'],
      [false, 'nine', 'ten'],
      [true, 'thousand dollars.', 'thousand dollars'],
    ]);
    expect(wordChanges(runs)).toEqual([{ aStart: 1.5, aEnd: 1.9, bStart: 1.5, bEnd: 1.9, removed: 'nine', added: 'ten' }]);
  });
});

describe('transcripts cut into sentences together', () => {
  const said = (text: string, from = 0) => text.split(' ').map((t, i) => ({ text: t, start: from + i * 0.3, end: from + i * 0.3 + 0.25 }));
  it('cuts both where either ends a sentence, in what they share, so the sentences face each other', () => {
    const a = said('Revenue grew by 9% this quarter, thank you all for joining.');
    const b = said('Revenue grew by 12% this quarter. We hired four new engineers, thank you all for joining.');
    const pairs = pairedSentences(diffWords(a, b));
    expect(pairs.map((p) => [p.a.map((w) => w.text).join(' '), p.b.map((w) => w.text).join(' ')])).toEqual([
      ['Revenue grew by 9% this quarter,', 'Revenue grew by 12% this quarter.'],
      ['thank you all for joining.', 'We hired four new engineers, thank you all for joining.'],
    ]);
  });
  it('cuts at a long pause too', () => {
    const a = [...said('one two'), ...said('three four', 5)];
    expect(pairedSentences(diffWords(a, a)).map((p) => p.a.length)).toEqual([2, 2]);
  });
});

describe('words made up where nothing was said', () => {
  const w = (text: string, start: number, end = start + 0.2) => ({ text, start, end });
  it('drops a repetition that runs on past the end of the recording, all of it', () => {
    // A tune 4.3 s long, heard by Whisper as "ooh" until the 30 s it listens to.
    const ooh = Array.from({ length: 40 }, (_, i) => w(i ? 'ooh,' : 'Ooh,', 1.28 + i * 0.7));
    expect(heardWords(ooh, 4.3)).toEqual([]);
  });
  it('drops what is said where the model hears no speech', () => {
    expect(heardWords([w('You', 5.02, 14.96)], 5.23, [[0, 5.23]])).toEqual([]);
    const long = [w('Welcome', 2), w('back.', 2.4), w('Thanks', 31), w('for', 31.3), w('watching!', 31.6)];
    expect(heardWords(long, 40, [[30, 40]]).map((x) => x.text)).toEqual(['Welcome', 'back.']);
  });
  it('keeps what was said, its last word brought back to the end of the recording', () => {
    const said = [w('Thank', 6.62), w('you', 6.8), w('all', 6.96), w('for', 7.08, 7.44), w('joining.', 7.48, 10)];
    expect(heardWords(said, 7.56)).toEqual([...said.slice(0, 4), { text: 'joining.', start: 7.48, end: 7.56 }]);
  });
  it('drops a word that is one sound over and over', () => {
    // The transcription server's reading of the tune: its "O" tokens have no spaces between them.
    expect(heardWords([w('OOOOOOOOOOOOOOOOOOOOOO', 0.25, 4.3)], 4.33)).toEqual([]);
    expect(heardWords([w('Mmmmmm.', 1)], 3)).toEqual([]);
    const said = [w('Nooooo,', 0.5), w('Ahhh,', 1), w('too', 1.5), w('bookkeeper.', 2)];
    expect(heardWords(said, 3)).toEqual(said);
  });
  it('keeps words said again and again inside the recording', () => {
    const no = [w('No,', 1), w('no,', 1.3), w('no,', 1.6), w('no.', 1.9)];
    expect(heardWords(no, 3)).toEqual(no);
  });
});

describe('transcripts kept with the comparison', () => {
  const said = { text: 'Hello there.', words: [{ text: 'Hello', start: 0.2, end: 0.5 }, { text: 'there.', start: 0.5, end: 0.9 }] };
  it('reads back what was saved, and nothing that isn’t a transcript', async () => {
    const { readKeptTranscripts } = await import('../../src/ui/audio/use-audio-compare');
    expect(readKeptTranscripts({ byRecording: { 'aud:1': said, 'aud:2': { text: '', words: [] } }, shown: false })).toEqual({
      byRecording: { 'aud:1': said, 'aud:2': { text: '', words: [] } },
      shown: false,
    });
    expect(readKeptTranscripts({ byRecording: { 'aud:1': { text: 'x', words: [{ text: 'x' }] } } })).toEqual({ byRecording: {}, shown: true });
    expect(readKeptTranscripts(undefined)).toBeNull();
    expect(readKeptTranscripts('nonsense')).toBeNull();
  });
  it('keeps only the transcripts of the recordings compared', async () => {
    const { keptFor } = await import('../../src/ui/audio/use-audio-compare');
    const kept = { byRecording: { 'aud:1': said, 'aud:2': said, 'aud:old': said }, shown: true };
    expect(keptFor(kept, ['aud:2', 'aud:1'])).toEqual({ byRecording: { 'aud:1': said, 'aud:2': said }, shown: true });
    expect(keptFor(kept, ['', ''])).toBeNull();
    expect(keptFor(null, ['aud:1'])).toBeNull();
  });
});

describe('transcripts compared with or without their punctuation', () => {
  const w = (s: string) => s.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }));
  it('ignores punctuation and capitals unless told not to, but not the symbols that are said', () => {
    const changed = (a: string, b: string, ignore?: { punctuation: boolean; case: boolean }) => diffWords(w(a), w(b), ignore).filter((r) => !r.same).length;
    expect(changed('this quarter. Thank you', 'this quarter, thank you')).toBe(0);
    expect(changed('this quarter. Thank you', 'this quarter, thank you', { punctuation: false, case: true })).toBe(1);
    expect(changed('this quarter. Thank you', 'this quarter. thank you', { punctuation: true, case: false })).toBe(1);
    expect(changed('grew by 9%', 'grew by 9')).toBe(1);
  });
});
