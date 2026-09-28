/**
 * Spelling and grammar checking of a paragraph's text, in the browser.
 *
 * Spelling goes through the dictionary (spell.ts), leaving out what is not
 * meant to be a word: acronyms, words with capitals inside (product and code
 * names), web and email addresses. Grammar is a set of rules for mistakes that
 * can be told for certain from the words alone: a repeated word, "a" or "an"
 * before the wrong sound, a sentence that starts in lower case, spacing around
 * punctuation, and a few phrases that are always wrong ("could of", "more
 * then"). Claude (claude.ts) can be asked about the rest.
 */
import type { Speller } from './spell';

export type IssueKind = 'spelling' | 'grammar';

export interface Issue {
  kind: IssueKind;
  /** Which rule found it ('spelling', 'repeat', 'article' …; 'claude' for Claude's). */
  rule: string;
  /** Where it is in the text checked. */
  start: number;
  end: number;
  /** The words it is about. */
  text: string;
  message: string;
  /** Replacements for the words (spelling suggestions are looked up when asked for). */
  suggestions: string[];
  source: 'local' | 'claude';
}

/** What the reader chose not to hear about. */
export interface Ignores {
  /** Words (in lower case) that are spelled right: the personal dictionary and "Ignore all". */
  words: ReadonlySet<string>;
  /** Grammar findings dismissed, as "rule:text". */
  rules: ReadonlySet<string>;
}

export const NO_IGNORES: Ignores = { words: new Set(), rules: new Set() };

export const ignoreKey = (i: Pick<Issue, 'rule' | 'text'>) => `${i.rule}:${i.text.toLowerCase()}`;

const WORD = /[\p{L}\p{M}](?:[\p{L}\p{M}'’-]*[\p{L}\p{M}])?/gu;
const ADDRESS = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+/giu;

/** Stretches of the text that are web or email addresses. */
function addresses(text: string): Array<[number, number]> {
  return Array.from(text.matchAll(ADDRESS), (m) => [m.index, m.index + m[0].length] as [number, number]);
}

/** Whether a word is left to the reader: acronyms, names with capitals inside, single letters. */
function notAWord(w: string): boolean {
  if (w.length < 2) return true;
  if (w === w.toUpperCase()) return true;
  return /\p{Lu}/u.test(w.slice(1)) && w.slice(1) !== w.slice(1).toUpperCase();
}

function spelledRight(w: string, sp: Speller, ignores: Ignores): boolean {
  const plain = w.replace(/’/g, "'");
  if (ignores.words.has(plain.toLowerCase())) return true;
  if (sp.correct(plain)) return true;
  // A possessive of a known word or name.
  const base = plain.replace(/'s$/i, '');
  if (base !== plain && (sp.correct(base) || ignores.words.has(base.toLowerCase()))) return true;
  // Each part of a hyphenated word.
  if (plain.includes('-')) return plain.split('-').every((p) => !p || notAWord(p) || sp.correct(p) || ignores.words.has(p.toLowerCase()));
  return false;
}

/** Misspelled words. */
export function spellingIssues(text: string, sp: Speller, ignores: Ignores = NO_IGNORES): Issue[] {
  const skip = addresses(text);
  const out: Issue[] = [];
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    const at = m.index;
    if (notAWord(w) || skip.some(([s, e]) => at >= s && at < e)) continue;
    // Next to digits, it is part of a code or a quantity ("3rd", "A4b").
    if (/\d/.test(text[at - 1] ?? '') || /\d/.test(text[at + w.length] ?? '')) continue;
    if (spelledRight(w, sp, ignores)) continue;
    out.push({ kind: 'spelling', rule: 'spelling', start: at, end: at + w.length, text: w, message: 'Not in the dictionary', suggestions: [], source: 'local' });
  }
  return out;
}

/* -------------------------------------------------------------- grammar */

/** Words after "a" that start with a vowel letter but a consonant sound. */
const A_BEFORE = /^(?:uni(?!mp|nf|nh|ns|nt|nv)|use|usu|uti|ubiq|uk|ura|ure|uro|eu|ewe|one\b|once\b|o'|oui)/i;
/** Words after "an" that start with a consonant letter but a vowel sound. */
const AN_BEFORE = /^(?:hour|honest|honou?r|heir|herb)/i;

interface Rule {
  rule: string;
  re: RegExp;
  /** The finding for a match, or null to let it pass. */
  find(m: RegExpMatchArray, text: string): { start: number; end: number; message: string; suggestions: string[] } | null;
}

const COMPARATIVES = 'more|less|better|worse|rather|other|fewer|greater|larger|smaller|higher|lower|faster|slower|earlier|later|longer|shorter|bigger';
const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|vs|approx|cf|al|no|nos|mr|mrs|ms|dr|st|fig|p|pp|vol|ch|sec|ed|eds|inc|ltd|co|dept|est|jr|sr)|\b\p{L})\.$/iu;

const RULES: Rule[] = [
  {
    rule: 'repeat',
    re: /\b([\p{L}]+)(\s+)\1\b/giu,
    find(m) {
      const w = m[1]!.toLowerCase();
      // "had had" and "that that" can be right.
      if (w === 'had' || w === 'that') return null;
      return { start: m.index!, end: m.index! + m[0].length, message: `“${m[1]}” twice in a row`, suggestions: [m[1]!] };
    },
  },
  {
    rule: 'article',
    re: /\b(a|an|A|An)(\s+)([\p{L}][\p{L}'’-]*)/gu,
    find(m) {
      const [, article, , word] = m as unknown as [string, string, string, string];
      if (word === word.toUpperCase() && word.length > 1) return null; // an acronym: said letter by letter, or not
      const vowel = /^[aeiou]/i.test(word);
      const an = article.toLowerCase() === 'an';
      const wantAn = (vowel && !A_BEFORE.test(word)) || AN_BEFORE.test(word);
      if (an === wantAn) return null;
      const fix = (wantAn ? 'an' : 'a').replace(/^a/, article[0] === 'A' ? 'A' : 'a');
      return { start: m.index!, end: m.index! + article.length, message: wantAn ? `“an” before “${word}”` : `“a” before “${word}”`, suggestions: [fix] };
    },
  },
  {
    rule: 'capital',
    re: /([.!?])(\s+)(\p{Ll}[\p{L}'’-]*)/gu,
    find(m, text) {
      const before = text.slice(0, m.index! + 1);
      // "e.g. the", "etc. and", initials, and an ellipsis are not the end of a sentence.
      if (m[1] === '.' && (ABBREVIATIONS.test(before) || /\.\.$/.test(before))) return null;
      const word = m[3]!;
      const start = m.index! + m[1]!.length + m[2]!.length;
      return { start, end: start + word.length, message: 'A sentence starts with a capital letter', suggestions: [word[0]!.toUpperCase() + word.slice(1)] };
    },
  },
  {
    rule: 'pronoun',
    // Not "i.e.", nor a numeral such as "(i)".
    re: /(?<![\p{L}.'’(-])i(?![\p{L}.'’)-])/gu,
    find(m) {
      return { start: m.index!, end: m.index! + 1, message: '“I” is written as a capital', suggestions: ['I'] };
    },
  },
  {
    rule: 'spaces',
    re: /(?<=\S)( {2,})(?=\S)/g,
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: 'More than one space', suggestions: [' '] };
    },
  },
  {
    rule: 'space-before',
    re: /(?<=[\p{L}\p{N})’”"])( +)([,;:!?]|\.(?!\.))(?=\s|$)/gu,
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: `No space before “${m[2]}”`, suggestions: [m[2]!] };
    },
  },
  {
    rule: 'space-after',
    re: /(?<=\p{L})([,;])(?=\p{L})/gu,
    find(m) {
      return { start: m.index!, end: m.index! + 1, message: `A space after “${m[1]}”`, suggestions: [`${m[1]} `] };
    },
  },
  {
    rule: 'doubled',
    re: /([,;:])\1+|(?<!\.)\.\.(?!\.)/g,
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: 'Doubled punctuation', suggestions: [m[0][0]!] };
    },
  },
  {
    rule: 'could-of',
    re: /\b(could|should|would|must|might)(\s+)of\b/giu,
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: `“${m[1]} have”, not “${m[1]} of”`, suggestions: [`${m[1]}${m[2]}have`] };
    },
  },
  {
    rule: 'than',
    re: new RegExp(`\\b(${COMPARATIVES})(\\s+)then\\b`, 'giu'),
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: '“than” in a comparison', suggestions: [`${m[1]}${m[2]}than`] };
    },
  },
  {
    rule: 'your-welcome',
    re: /\b([Yy])our(\s+)welcome\b/gu,
    find(m) {
      return { start: m.index!, end: m.index! + m[0].length, message: '“You’re welcome”', suggestions: [`${m[1]}ou’re${m[2]}welcome`] };
    },
  },
];

/** Grammar findings. */
export function grammarIssues(text: string, ignores: Ignores = NO_IGNORES): Issue[] {
  const skip = addresses(text);
  const out: Issue[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      if (skip.some(([s, e]) => m.index! < e && m.index! + m[0].length > s)) continue;
      const f = r.find(m, text);
      if (!f) continue;
      const issue: Issue = { kind: 'grammar', rule: r.rule, start: f.start, end: f.end, text: text.slice(f.start, f.end), message: f.message, suggestions: f.suggestions, source: 'local' };
      if (!ignores.rules.has(ignoreKey(issue))) out.push(issue);
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Everything found in a text, in order. */
export function checkText(text: string, sp: Speller, ignores: Ignores = NO_IGNORES): Issue[] {
  return [...spellingIssues(text, sp, ignores), ...grammarIssues(text, ignores)].sort((x, y) => x.start - y.start || x.end - y.end);
}
