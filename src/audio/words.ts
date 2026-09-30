/**
 * Two transcripts compared word by word (the same Myers diff as documents),
 * ignoring case and punctuation unless told not to: the words that stayed,
 * and the ones taken out of A or put into B — each word with its time in its
 * recording, so a changed word can be heard.
 */
import { Interner, diffSequences, toRegions } from '../core/myers';
import { withoutPunctuation } from '../core/tokens';
import type { Word } from './transcribe';

export interface WordRun {
  /** The same words in both (spoken at their own times in each). */
  same: boolean;
  a: Word[];
  b: Word[];
}

/** What comparing two transcripts leaves out (both, unless told otherwise: the transcriber guesses them). */
export interface WordsIgnore {
  punctuation: boolean;
  case: boolean;
}

const LENIENT: WordsIgnore = { punctuation: true, case: true };

const key = (w: Word, ignore = LENIENT) => {
  const t = ignore.punctuation ? withoutPunctuation(w.text) : w.text;
  return (ignore.case ? t.toLowerCase() : t).trim();
};

export function diffWords(a: readonly Word[], b: readonly Word[], ignore = LENIENT): WordRun[] {
  const intern = new Interner();
  const ka = a.map((w) => intern.id(key(w, ignore)));
  const kb = b.map((w) => intern.id(key(w, ignore)));
  return toRegions(diffSequences(ka, kb)).map((r) => ({ same: r.eq, a: a.slice(r.a0, r.a1), b: b.slice(r.b0, r.b1) }));
}

/** The changed stretches of two transcripts, as times in each recording (for marking the tracks). */
export function wordChanges(runs: readonly WordRun[]): Array<{ aStart?: number; aEnd?: number; bStart?: number; bEnd?: number; removed: string; added: string }> {
  return runs
    .filter((r) => !r.same)
    .map((r) => ({
      aStart: r.a[0]?.start,
      aEnd: r.a[r.a.length - 1]?.end,
      bStart: r.b[0]?.start,
      bEnd: r.b[r.b.length - 1]?.end,
      removed: r.a.map((w) => w.text).join(' '),
      added: r.b.map((w) => w.text).join(' '),
    }));
}

/** A word or phrase (of up to this many words) said this many times in a row is a repetition. */
const PHRASE = 4;
const REPEATS = 3;
/** A "word" that is one letter over and over ("OOOOOOOO"): the same repetition, of a sound too short to have spaces. */
const STUCK = /^(\p{L})\1{5,}$/iu;

/**
 * The words really said in a recording `duration` seconds long. Where there
 * is no speech (music, noise, silence), Whisper makes words up: it says "you",
 * or gets stuck saying one word or phrase over and over, on past the end of
 * the recording, or one sound ("OOOOOOOO"). Those go: every word in a stretch
 * the model itself takes to be `quiet`, every word that starts after the
 * recording ends, the whole of a repetition that does (its first few times are
 * just as made up), and every word that is one letter over and over. The last
 * word's end, which Whisper often puts past the end, is brought back to it.
 */
export function heardWords(words: readonly Word[], duration: number, quiet: ReadonlyArray<readonly [number, number]> = []): Word[] {
  const drop = words.map((w) => w.start >= duration || quiet.some(([from, to]) => w.start >= from && w.start < to) || STUCK.test(withoutPunctuation(w.text)));
  const same = (i: number, j: number, n: number) => {
    for (let k = 0; k < n; k++) if (key(words[i + k]!) !== key(words[j + k]!)) return false;
    return true;
  };
  for (let i = 0; i < words.length; ) {
    // The longest repetition starting here.
    let len = 0;
    for (let n = 1; n <= PHRASE; n++) {
      let times = 1;
      while (i + (times + 1) * n <= words.length && same(i, i + times * n, n)) times++;
      if (times >= REPEATS && times * n > len) len = times * n;
    }
    if (len && words.slice(i, i + len).some((w) => w.start >= duration)) drop.fill(true, i, i + len);
    i += len || 1;
  }
  return words.filter((_, i) => !drop[i]).map((w) => (w.end > duration ? { ...w, end: Math.max(w.start, duration) } : w));
}

/** A pause this long (seconds) ends a sentence, even without a full stop. */
const PAUSE = 1.2;
/** The most words in one sentence (transcripts aren't always punctuated). */
const MAX_WORDS = 40;
const ends = (w: Word | undefined) => !!w && /[.?!…]["”’)]?$/.test(w.text.trim());

/**
 * The two transcripts cut into sentences at the same places, so that each of
 * A's sentences faces the one B says in its place. They are cut only where
 * both say the same thing, after a word that ends a sentence (or a long
 * pause) in either; what only one of them says stays with the words around it.
 */
export function pairedSentences(runs: readonly WordRun[]): Array<{ a: Word[]; b: Word[] }> {
  const out: Array<{ a: Word[]; b: Word[] }> = [];
  let a: Word[] = [];
  let b: Word[] = [];
  const cut = () => {
    if (a.length || b.length) out.push({ a, b });
    a = [];
    b = [];
  };
  runs.forEach((r, k) => {
    if (!r.same) {
      a.push(...r.a);
      b.push(...r.b);
      return;
    }
    r.a.forEach((wa, i) => {
      const wb = r.b[i]!;
      a.push(wa);
      b.push(wb);
      const lastOfAll = k === runs.length - 1 && i === r.a.length - 1;
      if (lastOfAll) return;
      const na = r.a[i + 1] ?? runs[k + 1]?.a[0];
      const nb = r.b[i + 1] ?? runs[k + 1]?.b[0];
      const pause = (na && na.start - wa.end > PAUSE) || (nb && nb.start - wb.end > PAUSE);
      if (ends(wa) || ends(wb) || pause || Math.max(a.length, b.length) >= MAX_WORDS) cut();
    });
  });
  cut();
  return out;
}
