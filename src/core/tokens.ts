import type { Block, Fmt, ParaBlock, ParaProps, Span } from './model';
import { OBJ_CHAR, isBlank } from './model';

export interface CompareOptions {
  /** 'word' compares word by word, 'char' character by character. */
  granularity: 'word' | 'char';
  ignoreCase: boolean;
  /** Treat runs of whitespace as equal and ignore leading/trailing whitespace. */
  ignoreWhitespace: boolean;
  /** Ignore bold, italic, underline, strike, super/subscript and link targets. */
  ignoreFormatting: boolean;
  /** Leave empty paragraphs out of the comparison. */
  ignoreEmpty: boolean;
  /** Treat curly quotes, dashes and ellipses like their plain ASCII forms. */
  normalizePunctuation: boolean;
}

export const DEFAULT_OPTIONS: CompareOptions = {
  granularity: 'word',
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreFormatting: false,
  ignoreEmpty: true,
  normalizePunctuation: false,
};

export function optionsKey(o: CompareOptions): string {
  return [
    o.granularity,
    o.ignoreCase ? 1 : 0,
    o.ignoreWhitespace ? 1 : 0,
    o.ignoreFormatting ? 1 : 0,
    o.ignoreEmpty ? 1 : 0,
    o.normalizePunctuation ? 1 : 0,
  ].join('');
}

/** Part of a token: characters [start, end) of span `span`. */
export interface Piece {
  span: number;
  start: number;
  end: number;
}

export interface Token {
  /** Comparison key (normalized text + formatting signature). */
  key: string;
  /** Original text. */
  text: string;
  pieces: Piece[];
  /** Whitespace only. */
  ws: boolean;
  /** Word characters (used for similarity scoring). */
  word: boolean;
}

export interface Tokenized {
  tokens: Token[];
  /** Indices of tokens that take part in the comparison (leading/trailing whitespace may be excluded). */
  comp: number[];
}

// Characters that are invisible in a document and should never split words.
const INVISIBLE = '\u00ad\u200b\u200c\u200d\u2060\ufeff';
const WORD_RE = new RegExp(
  `[\\p{L}\\p{M}\\p{N}_${INVISIBLE}]+(?:['’\\-‐‑][\\p{L}\\p{M}\\p{N}_${INVISIBLE}]+)*|[\\s\u00a0]+|[^]`,
  'gu',
);
const SCRIPT_NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORDISH = /[\p{L}\p{N}]/u;
const WS_ONLY = /^[\s\u00a0]+$/;
const INVISIBLE_RE = new RegExp(`[${INVISIBLE}]`, 'g');

export function fmtSig(f: Fmt): string {
  let s = '';
  if (f.b) s += 'b';
  if (f.i) s += 'i';
  // Links are underlined by convention; only compare underline on plain text.
  if (f.u && !f.href) s += 'u';
  if (f.s) s += 's';
  if (f.sup) s += '^';
  if (f.sub) s += '_';
  if (f.href) s += '@' + f.href;
  return s;
}

const PLAIN_ASCII = /^[\x20-\x7e]*$/;

export function normalizeText(text: string, o: CompareOptions): string {
  let t = text;
  // Most tokens are plain ASCII words; skip Unicode work for them.
  if (!PLAIN_ASCII.test(t)) {
    t = t.normalize('NFC').replace(INVISIBLE_RE, '').replace(/[\u00a0\u2007\u202f\u2000-\u200a]/g, ' ');
  }
  if (o.normalizePunctuation) {
    t = t
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐‑‒–—―−]/g, '-')
      .replace(/…/g, '...');
  }
  if (o.ignoreCase) t = t.toLowerCase();
  if (o.ignoreWhitespace && /^\s+$/.test(t)) t = ' ';
  return t;
}

function splitWords(text: string, granularity: 'word' | 'char'): string[] {
  if (granularity === 'char') return Array.from(text);
  const out: string[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const w = m[0];
    if (w.length > 1 && SCRIPT_NO_SPACES.test(w) && !WS_ONLY.test(w)) {
      // Scripts written without spaces: compare character by character.
      let buf = '';
      for (const ch of w) {
        if (SCRIPT_NO_SPACES.test(ch)) {
          if (buf) out.push(buf);
          buf = '';
          out.push(ch);
        } else {
          buf += ch;
        }
      }
      if (buf) out.push(buf);
    } else {
      out.push(w);
    }
  }
  return out;
}

/**
 * Splits a paragraph's spans into comparison tokens. Objects are always their
 * own token; markers produce no tokens.
 */
export function tokenizeSpans(spans: readonly Span[], o: CompareOptions): Tokenized {
  const tokens: Token[] = [];
  // Concatenate the text of consecutive text spans so words can cross span
  // boundaries (e.g. a word that is half bold).
  let i = 0;
  while (i < spans.length) {
    const s = spans[i]!;
    if (s.marker) {
      i++;
      continue;
    }
    if (s.obj) {
      const obj = s.obj;
      const sig = o.ignoreFormatting ? '' : fmtSig(s.fmt);
      tokens.push({
        key: `${OBJ_CHAR}${obj.kind}:${normalizeText(obj.key, o)}\u0000${sig}`,
        text: s.text,
        pieces: [{ span: i, start: 0, end: s.text.length }],
        ws: false,
        word: true,
      });
      i++;
      continue;
    }
    // Gather a stretch of text spans.
    const group: number[] = [];
    let text = '';
    while (i < spans.length && !spans[i]!.obj) {
      const t = spans[i]!;
      if (!t.marker && t.text) {
        group.push(i);
        text += t.text;
      }
      i++;
    }
    if (!text) continue;
    const words = splitWords(text, o.granularity);
    // Map word ranges back to span pieces.
    let g = 0;
    let gStart = 0; // offset of group[g] in `text`
    let pos = 0;
    for (const w of words) {
      const start = pos;
      const end = pos + w.length;
      pos = end;
      const pieces: Piece[] = [];
      let cursor = start;
      while (cursor < end) {
        let spanIdx = group[g]!;
        let spanLen = spans[spanIdx]!.text.length;
        while (cursor >= gStart + spanLen) {
          gStart += spanLen;
          g++;
          spanIdx = group[g]!;
          spanLen = spans[spanIdx]!.text.length;
        }
        const pStart = cursor - gStart;
        const pEnd = Math.min(end, gStart + spanLen) - gStart;
        pieces.push({ span: spanIdx, start: pStart, end: pEnd });
        cursor = gStart + pEnd;
      }
      const ws = WS_ONLY.test(w);
      let key = normalizeText(w, o);
      if (!o.ignoreFormatting && !ws) key += '\u0000' + piecesSig(spans, pieces);
      tokens.push({ key, text: w, pieces, ws, word: !ws && WORDISH.test(w) });
    }
  }

  const comp: number[] = [];
  let first = 0;
  let last = tokens.length - 1;
  if (o.ignoreWhitespace) {
    while (first <= last && tokens[first]!.ws) first++;
    while (last >= first && tokens[last]!.ws) last--;
  }
  for (let k = first; k <= last; k++) comp.push(k);
  return { tokens, comp };
}

/** Formatting signature of a token, merging neighboring pieces with the same formatting. */
function piecesSig(spans: readonly Span[], pieces: readonly Piece[]): string {
  let out = '';
  let cur = '';
  let len = 0;
  let parts = 0;
  for (const p of pieces) {
    const sig = fmtSig(spans[p.span]!.fmt);
    if (parts > 0 && sig === cur) {
      len += p.end - p.start;
      continue;
    }
    if (parts > 0) out += `${cur}:${len},`;
    cur = sig;
    len = p.end - p.start;
    parts++;
  }
  // A token with uniform formatting gets just the signature.
  return parts <= 1 ? cur : `${out}${cur}:${len}`;
}

const tokenCache = new WeakMap<object, Map<string, Tokenized>>();

/** Tokenizes a paragraph, cached per block and options. */
export function tokenizePara(p: ParaBlock, o: CompareOptions): Tokenized {
  const key = optionsKey(o);
  let byOpts = tokenCache.get(p);
  if (!byOpts) {
    byOpts = new Map();
    tokenCache.set(p, byOpts);
  }
  let value = byOpts.get(key);
  if (!value) {
    value = tokenizeSpans(p.spans, o);
    byOpts.set(key, value);
  }
  return value;
}

export function propsSig(p: ParaProps, o: CompareOptions): string {
  let s = p.role;
  if (p.role === 'h' || p.role === 'toc') s += p.level ?? 1;
  if (p.list) s += `|${p.list.ordered ? 'ol' : 'ul'}${p.list.level}`;
  if (!o.ignoreFormatting && p.align) s += `|${p.align}`;
  return s;
}

const sigCache = new WeakMap<object, { key: string; value: string }>();

/** Signature used for block-level equality. Equal signatures mean "no visible difference". */
export function blockSig(b: Block, o: CompareOptions): string {
  const key = optionsKey(o);
  const hit = sigCache.get(b);
  if (hit && hit.key === key) return hit.value;
  let value: string;
  switch (b.type) {
    case 'p': {
      const t = tokenizePara(b, o);
      value = 'P' + propsSig(b.props, o) + '\u0001' + t.comp.map((k) => t.tokens[k]!.key).join('\u0001');
      break;
    }
    case 'table':
      value =
        'T' +
        b.rows
          .map((r) => r.cells.map((c) => c.blocks.filter((x) => !skipBlock(x, o)).map((x) => blockSig(x, o)).join('\u0003')).join('\u0004'))
          .join('\u0005');
      break;
    case 'opaque':
      value = 'O' + b.label + '\u0002' + b.blocks.filter((x) => !skipBlock(x, o)).map((x) => blockSig(x, o)).join('\u0003');
      break;
    case 'marker':
      value = 'M';
      break;
  }
  sigCache.set(b, { key, value });
  return value;
}

/** Blocks that are left out of the comparison entirely. */
export function skipBlock(b: Block, o: CompareOptions): boolean {
  if (b.type === 'marker') return true;
  if (o.ignoreEmpty && b.type === 'p' && isBlank(b)) return true;
  return false;
}

/** Word-count bag for similarity scoring. */
export function wordBag(b: Block, o: CompareOptions): Map<string, number> {
  const bag = new Map<string, number>();
  const add = (p: ParaBlock) => {
    const t = tokenizePara(p, { ...o, granularity: 'word', ignoreFormatting: true });
    for (const k of t.comp) {
      const tok = t.tokens[k]!;
      if (!tok.word) continue;
      const key = tok.key;
      bag.set(key, (bag.get(key) ?? 0) + 1);
    }
  };
  const walk = (x: Block) => {
    if (x.type === 'p') add(x);
    else if (x.type === 'table') for (const r of x.rows) for (const c of r.cells) c.blocks.forEach(walk);
    else if (x.type === 'opaque') x.blocks.forEach(walk);
  };
  walk(b);
  return bag;
}

/** Dice coefficient of two word bags (1 = same words, 0 = nothing in common). */
export function bagSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  if (na === 0 && nb === 0) return 1;
  if (na === 0 || nb === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w) common += Math.min(v, w);
  }
  return (2 * common) / (na + nb);
}
