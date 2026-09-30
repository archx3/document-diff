/**
 * Checks for the mistakes that creep into contracts between drafts, found
 * from the text alone:
 *
 * - a cross-reference to a clause, section or schedule the document doesn't have;
 * - a defined term that is never used, or used after its definition was removed;
 * - an amount in words and in figures that disagree ("nine thousand ($9,500)");
 * - a party spelled two ways, or renamed in some places and not others.
 *
 * Findings are issues like spelling and grammar ones, on the words they are
 * about, in each block's text as review marks count it (anchor.ts).
 */
import type { Comparison } from '../core/compare';
import { computeListLabels } from '../core/lists';
import type { Block, Doc } from '../core/model';
import { blockStream } from '../review/anchor';
import type { Issue } from './check';

export type ContractRule = 'xref' | 'term-unused' | 'term-undefined' | 'figures' | 'party';

type Found = { block: Block; issue: Issue };

const issue = (rule: ContractRule, text: string, start: number, message: string, suggestions: string[] = []): Issue => ({
  kind: 'contract',
  rule,
  start,
  end: start + text.length,
  text,
  message,
  suggestions,
  source: 'local',
});

/** The blocks of a document with text, and their text. */
function texts(doc: Doc): Array<{ block: Block; text: string }> {
  return doc.blocks.filter((b) => b.type !== 'marker').map((block) => ({ block, text: blockStream(block) }));
}

/* ------------------------------------------------------ cross-references */

const REF = /\b(clause|section|paragraph|article|schedule|annex|appendix|exhibit)s?\s+(\d+(?:\.\d+)*)(?:\s*\(([a-z]{1,3}|[ivx]{1,5})\))?/giu;
const HEADING_NUMBER = /^\s*(?:(clause|section|article|schedule|annex|appendix|exhibit)\s+)?(\d+(?:\.\d+)*)[.)]?\s+\S/iu;

/** The numbers of a document's clauses: list labels and numbered headings ("7.2 Payment", "Schedule 2"). */
function clauseNumbers(doc: Doc): { plain: Set<string>; named: Set<string> } {
  const plain = new Set<string>();
  const named = new Set<string>();
  for (const label of computeListLabels(doc.blocks).values()) {
    const n = label.replace(/[.)\s]+$/, '').replace(/^\(/, '');
    if (/^\d+(?:\.\d+)*$/.test(n)) plain.add(n);
  }
  for (const { text } of texts(doc)) {
    const m = text.match(HEADING_NUMBER);
    if (!m) continue;
    if (m[1]) named.add(`${m[1].toLowerCase()} ${m[2]}`);
    else plain.add(m[2]!);
  }
  return { plain, named };
}

function xrefs(doc: Doc): Found[] {
  const nums = clauseNumbers(doc);
  // Only a document numbered throughout can be checked.
  if (nums.plain.size < 3) return [];
  const out: Found[] = [];
  for (const { block, text } of texts(doc)) {
    for (const m of text.matchAll(REF)) {
      const kind = m[1]!.toLowerCase();
      const n = m[2]!;
      const named = ['schedule', 'annex', 'appendix', 'exhibit'].includes(kind);
      const there = named ? nums.named.has(`${kind} ${n}`) || nums.plain.has(n) : nums.plain.has(n) || nums.named.has(`${kind} ${n}`);
      // A schedule the document doesn't include at all (attached separately) is left alone.
      if (there || (named && ![...nums.named].some((x) => x.startsWith(kind)))) continue;
      const words = m[0].replace(/\s*\([^)]*\)$/, '');
      out.push({ block, issue: issue('xref', words, m.index!, `There is no ${kind} ${n} in this document`) });
    }
  }
  return out;
}

/* --------------------------------------------------------- defined terms */

const DEFINED = /[“"]([\p{Lu}][\p{L}\p{N}’' &-]{0,48}[\p{L}\p{N}])[”"]/gu;

interface Definition {
  term: string;
  block: Block;
  at: number;
}

function definitions(doc: Doc): Definition[] {
  const out: Definition[] = [];
  for (const { block, text } of texts(doc)) {
    for (const m of text.matchAll(DEFINED)) {
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 30);
      const before = text.slice(Math.max(0, m.index! - 12), m.index!);
      // "Term" means …, (the "Term"), (together, the "Parties") …
      if (/^\s*(?:\)|,|means\b|shall mean\b|has the meaning\b|includes\b|refers to\b)/iu.test(after) || /\(\s*(?:the|each|together|collectively|a|an)?[,\s]*$/iu.test(before))
        out.push({ term: m[1]!, block, at: m.index! + 1 });
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a term is used (not where it is defined, in quotes). */
function uses(doc: Doc, term: string): Array<{ block: Block; at: number }> {
  const re = new RegExp(`(?<![\\p{L}\\p{N}“"])${escape(term)}(?![\\p{L}\\p{N}”"])`, 'gu');
  const out: Array<{ block: Block; at: number }> = [];
  for (const { block, text } of texts(doc)) for (const m of text.matchAll(re)) out.push({ block, at: m.index! });
  return out;
}

function terms(doc: Doc, other?: Doc): Found[] {
  const out: Found[] = [];
  const defs = definitions(doc);
  const here = new Set(defs.map((d) => d.term));
  for (const d of defs) {
    if (uses(doc, d.term).length) continue;
    out.push({ block: d.block, issue: issue('term-unused', d.term, d.at, `“${d.term}” is defined but never used`) });
  }
  // Defined in the other version, not here, but still used here.
  if (other) {
    for (const d of definitions(other)) {
      if (here.has(d.term)) continue;
      const used = uses(doc, d.term);
      if (!used.length) continue;
      const first = used[0]!;
      out.push({ block: first.block, issue: issue('term-undefined', d.term, first.at, `“${d.term}” is used here, but its definition was removed`) });
    }
  }
  return out;
}

/* ---------------------------------------------------- words and figures */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };

/** A number written in (English) words, or null. */
export function wordsToNumber(words: string): number | null {
  const parts = words.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  if (!parts.length) return null;
  let total = 0;
  let group = 0;
  let any = false;
  for (const w of parts) {
    if (w in UNITS) {
      group += UNITS[w]!;
      any = true;
    } else if (w === 'hundred') {
      group = (group || 1) * 100;
    } else if (w in SCALES) {
      total += (group || 1) * SCALES[w]!;
      group = 0;
      any = true;
    } else return null;
  }
  return any ? total + group : null;
}

const NUMBER_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(SCALES), 'and'].join('|')})`;
const WORDS_THEN_FIGURES = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)(\\s+(?:[a-z]+\\s+){0,2})?\\(\\s*([$€£]?\\s*[\\d,]+(?:\\.\\d+)?)\\s*\\)`, 'giu');
const FIGURES_THEN_WORDS = new RegExp(`((?:[$€£]\\s*)?\\d[\\d,]*(?:\\.\\d+)?)\\s*\\(\\s*(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)(?:\\s+[a-z]+){0,2}\\s*\\)`, 'giu');
const figure = (s: string) => Number(s.replace(/[^\d.]/g, ''));

function figures(doc: Doc): Found[] {
  const out: Found[] = [];
  for (const { block, text } of texts(doc)) {
    for (const m of text.matchAll(WORDS_THEN_FIGURES)) {
      const said = wordsToNumber(m[1]!);
      const fig = figure(m[3]!);
      if (said === null || said === fig) continue;
      const start = m.index! + m[0].lastIndexOf(m[3]!);
      out.push({ block, issue: issue('figures', m[3]!, start, `The words say ${said.toLocaleString('en')}, the figures ${fig.toLocaleString('en')}`, [m[3]!.replace(/[\d,.]+/, said.toLocaleString('en'))]) });
    }
    for (const m of text.matchAll(FIGURES_THEN_WORDS)) {
      const said = wordsToNumber(m[2]!);
      const fig = figure(m[1]!);
      if (said === null || said === fig) continue;
      out.push({ block, issue: issue('figures', m[1]!, m.index!, `The figures say ${fig.toLocaleString('en')}, the words ${said.toLocaleString('en')}`, [m[1]!.replace(/[\d,.]+/, said.toLocaleString('en'))]) });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- parties */

const SUFFIX = String.raw`(?:LLC|L\.L\.C\.|Ltd\.?|Limited|Inc\.?|Incorporated|GmbH|LLP|PLC|plc|Corp\.?|Corporation|S\.A\.|B\.V\.|AG)`;
/** A word of a company's name: capitalised, or "&", "of", "and" (but not a suffix, which ends the name). */
const NAME_WORD = String.raw`(?:(?!${SUFFIX}(?![\p{L}]))[\p{Lu}][\p{L}’'.-]*|&)`;
const ENTITY = new RegExp(String.raw`\b${NAME_WORD}(?:\s+(?:${NAME_WORD}|of|and)){0,5}\s+${SUFFIX}(?![\p{L}])`, 'gu');

/** Edit distance, stopping early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const LEADING = /^(?:(?:The|And|Of|Between|By|With|From|For|To|Whereas|This|That|Both|Each|Either|Neither|If|When|Where|Unless|Under|Upon|On|In|At|As|All|Any|Signed|Party|Parties)\s+)+/u;

function entities(doc: Doc): Map<string, Array<{ block: Block; at: number }>> {
  const out = new Map<string, Array<{ block: Block; at: number }>>();
  for (const { block, text } of texts(doc)) {
    for (const m of text.matchAll(ENTITY)) {
      // Capitalised because they start a sentence, not because they are part of the name.
      const name = m[0].replace(LEADING, '');
      const at = m.index! + (m[0].length - name.length);
      out.set(name, [...(out.get(name) ?? []), { block, at }]);
    }
  }
  return out;
}

function parties(doc: Doc, other?: Doc): Found[] {
  const out: Found[] = [];
  const here = entities(doc);
  const names = [...here.keys()];
  // Two spellings of one party: the rarer one is the slip.
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [x, y] = [names[i]!, names[j]!];
      if (distance(x.toLowerCase(), y.toLowerCase(), 2) > 2) continue;
      const [rare, common] = here.get(x)!.length <= here.get(y)!.length ? [x, y] : [y, x];
      for (const u of here.get(rare)!) out.push({ block: u.block, issue: issue('party', rare, u.at, `Elsewhere the party is “${common}”`, [common]) });
    }
  }
  // Renamed in some places only: a name the other version used, still here beside a new one.
  if (other) {
    const before = entities(other);
    const added = names.filter((n) => !before.has(n));
    for (const [old, list] of before) {
      const now = here.get(old);
      if (!now || now.length >= list.length || !added.length) continue;
      const renamed = added.find((n) => distance(n.toLowerCase(), old.toLowerCase(), 2) > 2) ?? added[0]!;
      for (const u of now) out.push({ block: u.block, issue: issue('party', old, u.at, `Elsewhere in this version the party is now “${renamed}”`, [renamed]) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ all */

const cache = new WeakMap<Comparison, Map<Block, Issue[]>>();

/** Contract findings for both documents of a comparison, by block. */
export function contractFindings(cmp: Comparison): Map<Block, Issue[]> {
  let m = cache.get(cmp);
  if (m) return m;
  m = new Map();
  for (const [doc, other] of [
    [cmp.left, cmp.right],
    [cmp.right, cmp.left],
  ] as const) {
    if (doc.mono) continue;
    for (const f of [...xrefs(doc), ...terms(doc, other), ...figures(doc), ...parties(doc, other)]) m.set(f.block, [...(m.get(f.block) ?? []), f.issue]);
  }
  for (const [block, list] of m) {
    // (Comparing a document with itself finds everything twice.)
    const seen = new Set<string>();
    const once = list.filter((i) => {
      const k = `${i.rule}|${i.start}|${i.end}`;
      return !seen.has(k) && !!seen.add(k);
    });
    m.set(block, once.sort((x, y) => x.start - y.start));
  }
  cache.set(cmp, m);
  return m;
}
