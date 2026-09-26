import type { Block, ListInfo, ParaBlock } from './model';

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function letters(n: number): string {
  if (n <= 0) return String(n);
  // Word repeats the letter: a … z, aa … zz, aaa …
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

export function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'none':
      return '';
    case 'bullet':
      return '•';
    default:
      return String(n);
  }
}

const BULLETS = ['•', '◦', '▪'];

/** Map Symbol / Wingdings private-use glyphs used by Word bullets to Unicode. */
const PUA_BULLETS = new Map<string, string>([
  [String.fromCharCode(0xf0b7), '\u2022'],
  [String.fromCharCode(0xf0a7), '\u25aa'],
  [String.fromCharCode(0xf0a8), '\u25c6'],
  [String.fromCharCode(0xf0d8), '\u27a2'],
  [String.fromCharCode(0xf0fc), '\u2713'],
  [String.fromCharCode(0xf076), '\u2756'],
  [String.fromCharCode(0xf0e0), '\u2794'],
  [String.fromCharCode(0xf06f), '\u25cb'],
  [String.fromCharCode(0xf0a1), '\u25cb'],
  [String.fromCharCode(0xf02d), '\u2013'],
  ['o', '\u25e6'],
  ['\u00a7', '\u25aa'],
]);

/** Visible bullet for a list level whose label template is `template` (Symbol-font glyphs become Unicode). */
export function bulletChar(template: string | undefined, level: number): string {
  const t = template;
  if (t !== undefined && t !== '' && !/%\d/.test(t)) {
    const mapped = PUA_BULLETS.get(t);
    if (mapped) return mapped;
    const cp = t.codePointAt(0)!;
    if (cp >= 0xe000 && cp <= 0xf8ff) return BULLETS[level % 3]!;
    return t;
  }
  return BULLETS[level % 3]!;
}

function bulletGlyph(list: ListInfo): string {
  return bulletChar(list.template, list.level);
}

/**
 * Computes the visible label ("1.", "b)", "•") of every list paragraph, in
 * document order, following Word's counter rules closely enough for display.
 */
export function computeListLabels(blocks: readonly Block[]): Map<ParaBlock, string> {
  const labels = new Map<ParaBlock, string>();
  const counters = new Map<string, number[]>();
  const seenOverride = new Set<string>();
  const visit = (b: Block) => {
    if (b.type === 'table') {
      for (const r of b.rows) for (const c of r.cells) c.blocks.forEach(visit);
      return;
    }
    if (b.type === 'opaque') {
      b.blocks.forEach(visit);
      return;
    }
    if (b.type !== 'p' || !b.props.list) return;
    const list = b.props.list;
    if (!list.ordered) {
      labels.set(b, bulletGlyph(list));
      return;
    }
    const key = list.key ?? `anon-${list.level}`;
    let c = counters.get(key);
    if (!c || (list.overrideKey && !seenOverride.has(list.overrideKey))) {
      if (list.overrideKey) seenOverride.add(list.overrideKey);
      c = [];
      counters.set(key, c);
    }
    const lvl = list.level;
    const startAt = (l: number) => list.starts?.[l] ?? 1;
    c[lvl] = c[lvl] === undefined ? startAt(lvl) : c[lvl]! + 1;
    c.length = lvl + 1;
    const fmtAt = (l: number) => list.formats?.[l] ?? (l % 3 === 0 ? 'decimal' : l % 3 === 1 ? 'lowerLetter' : 'lowerRoman');
    let label: string;
    if (list.template !== undefined && /%\d/.test(list.template)) {
      label = list.template.replace(/%(\d)/g, (_, d: string) => {
        const l = parseInt(d, 10) - 1;
        return formatNumber(c[l] ?? startAt(l), fmtAt(l));
      });
    } else if (list.template !== undefined && list.template !== '') {
      label = list.template;
    } else {
      label = `${formatNumber(c[lvl]!, fmtAt(lvl))}.`;
    }
    labels.set(b, label);
  };
  blocks.forEach(visit);
  return labels;
}
