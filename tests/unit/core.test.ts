import { describe, expect, it } from 'vitest';
import { compareDocs, inlineDiff } from '../../src/core/compare';
import { applySelection, selectAll, selectHunk, selectInline, selectTableRow } from '../../src/core/merge';
import type { Block, Doc, Fmt, ParaBlock, Span } from '../../src/core/model';
import { blockText, newId, para } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS, propsSig, tokenizeSpans } from '../../src/core/tokens';

const O = DEFAULT_OPTIONS;

function doc(blocks: Block[]): Doc {
  return { id: newId('d'), name: 'test', kind: 'text', blocks, version: 0 };
}
const P = (text: string, props = {}) => para([{ text, fmt: {} }], props);
const S = (text: string, fmt: Fmt = {}): Span => ({ text, fmt });
const texts = (d: Doc) => d.blocks.map(blockText);

describe('tokenizer', () => {
  it('splits words, whitespace and punctuation', () => {
    const t = tokenizeSpans([S("Don't stop—now, please.")], O);
    expect(t.tokens.map((x) => x.text)).toEqual(["Don't", ' ', 'stop', '—', 'now', ',', ' ', 'please', '.']);
  });

  it('keeps words that cross span boundaries together', () => {
    const t = tokenizeSpans([S('Hel', { b: true }), S('lo world')], O);
    expect(t.tokens.map((x) => x.text)).toEqual(['Hello', ' ', 'world']);
    expect(t.tokens[0]!.pieces).toEqual([
      { span: 0, start: 0, end: 3 },
      { span: 1, start: 0, end: 2 },
    ]);
  });

  it('treats CJK characters as separate tokens', () => {
    const t = tokenizeSpans([S('合同条款abc')], O);
    expect(t.tokens.map((x) => x.text)).toEqual(['合', '同', '条', '款', 'abc']);
  });

  it('honours ignore options in keys', () => {
    const a = tokenizeSpans([S('Hello  World')], { ...O, ignoreCase: true, ignoreWhitespace: true });
    const b = tokenizeSpans([S('hello world ')], { ...O, ignoreCase: true, ignoreWhitespace: true });
    expect(a.comp.map((k) => a.tokens[k]!.key)).toEqual(b.comp.map((k) => b.tokens[k]!.key));
  });

  it('merges pieces with equal formatting in the key', () => {
    const a = tokenizeSpans([S('He', { b: true }), S('l', { b: true }), S('lo')], O);
    const b = tokenizeSpans([S('Hel', { b: true }), S('lo')], O);
    expect(a.tokens[0]!.key).toBe(b.tokens[0]!.key);
  });
});

describe('inline diff', () => {
  it('groups a rewritten phrase into one change', () => {
    const d = inlineDiff(P('The quick brown fox jumps.'), P('The slow red fox jumps.'), O);
    expect(d.changes).toHaveLength(1);
  });

  it('keeps separate edits apart', () => {
    const d = inlineDiff(P('The cat sat on the mat today.'), P('The dog sat on the mat today!'), O);
    expect(d.changes).toHaveLength(2);
  });

  it('flags formatting-only changes', () => {
    const a = para([S('Pay within '), S('30 days', { b: true })]);
    const b = para([S('Pay within 30 days')]);
    const d = inlineDiff(a, b, O);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]!.fmtOnly).toBe(true);
    expect(inlineDiff(a, b, { ...O, ignoreFormatting: true }).changes).toHaveLength(0);
  });
});

describe('compareDocs', () => {
  it('aligns edited, added and removed paragraphs', () => {
    const left = doc([P('Intro', { role: 'h', level: 1 }), P('Alpha beta gamma delta.'), P('Removed paragraph here.'), P('Same.')]);
    const right = doc([P('Intro', { role: 'h', level: 1 }), P('Alpha beta gamma epsilon.'), P('Same.'), P('Brand new text.')]);
    const cmp = compareDocs(left, right, O);
    expect(cmp.rows.map((r) => r.kind)).toEqual(['eq', 'mod', 'del', 'eq', 'ins']);
    expect(cmp.stats).toEqual({ changed: 1, added: 1, removed: 1 });
    expect(cmp.hunks).toHaveLength(2);
  });

  it('ignores empty paragraphs by default', () => {
    const cmp = compareDocs(doc([P('A'), P(''), P('B')]), doc([P('A'), P('B'), P('  ')]), O);
    expect(cmp.hunks).toHaveLength(0);
    const strict = compareDocs(doc([P('A'), P(''), P('B')]), doc([P('A'), P('B')]), { ...O, ignoreEmpty: false });
    expect(strict.hunks).toHaveLength(1);
  });

  it('detects style changes on otherwise identical text', () => {
    const cmp = compareDocs(doc([P('Scope')]), doc([P('Scope', { role: 'h', level: 2 })]), O);
    expect(cmp.rows.map((r) => r.kind)).toEqual(['mod']);
  });
});

describe('merging (model documents)', () => {
  it('copies one hunk left to right', () => {
    const left = doc([P('One.'), P('Two changed.'), P('Three.')]);
    const right = doc([P('One.'), P('Two.'), P('Three.')]);
    const cmp = compareDocs(left, right, O);
    const res = applySelection(cmp, 'l2r', selectHunk(cmp, 0), modelBackend);
    expect(res.applied).toBe(1);
    expect(texts(res.doc)).toEqual(['One.', 'Two changed.', 'Three.']);
  });

  it('inserts and removes blocks in the right places, keeping hidden blocks', () => {
    const left = doc([P('A'), P('B'), P('C'), P('D')]);
    const right = doc([P('A'), P(''), P('C'), P('X'), P('D')]);
    const cmp = compareDocs(left, right, O);
    const res = applySelection(cmp, 'l2r', selectAll(cmp), modelBackend);
    expect(texts(res.doc)).toEqual(['A', '', 'B', 'C', 'D']);
    const back = applySelection(cmp, 'r2l', selectAll(cmp), modelBackend);
    expect(texts(back.doc).filter(Boolean)).toEqual(['A', 'C', 'X', 'D']);
  });

  it('applies a single word-level change and leaves the rest', () => {
    const left = doc([P('The cat sat on the mat today.')]);
    const right = doc([P('The dog sat on the rug today.')]);
    const cmp = compareDocs(left, right, O);
    const row = cmp.rows[0]!;
    const d = inlineDiff(row.l!, row.r!, O);
    expect(d.changes).toHaveLength(2);
    const res = applySelection(cmp, 'l2r', selectInline(row.key, 1), modelBackend);
    expect(texts(res.doc)).toEqual(['The dog sat on the mat today.']);
    const res2 = applySelection(cmp, 'r2l', selectInline(row.key, 0), modelBackend);
    expect(texts(res2.doc)).toEqual(['The dog sat on the mat today.']);
  });

  it('keeps formatting of copied words', () => {
    const left = doc([para([S('Pay '), S('promptly', { b: true }), S(' please.')])]);
    const right = doc([para([S('Pay later please.')])]);
    const cmp = compareDocs(left, right, O);
    const res = applySelection(cmp, 'l2r', selectAll(cmp), modelBackend);
    const p = res.doc.blocks[0] as ParaBlock;
    expect(p.spans.find((s) => s.text.includes('promptly'))?.fmt.b).toBe(true);
  });

  it('copies individual table rows', () => {
    const cell = (t: string) => ({ blocks: [P(t)] });
    const row = (...c: string[]) => ({ id: newId('r'), cells: c.map(cell) });
    const lt: Block = { id: newId('t'), type: 'table', rows: [row('Item', 'Price'), row('Design', '$4,000'), row('Build', '$9,000')] };
    const rt: Block = { id: newId('t'), type: 'table', rows: [row('Item', 'Price'), row('Design', '$4,500'), row('Support', '$1,000')] };
    const cmp = compareDocs(doc([lt]), doc([rt]), O);
    expect(cmp.rows[0]!.kind).toBe('table');
    const sub = cmp.rows[0]!.table!.rows;
    expect(sub.map((r) => r.kind)).toEqual(['eq', 'mod', 'mod']);
    const res = applySelection(cmp, 'l2r', selectTableRow(cmp.rows[0]!.key, sub[1]!.key), modelBackend);
    expect(blockText(res.doc.blocks[0]!)).toBe('Item\tPrice\nDesign\t$4,000\nSupport\t$1,000');
  });

  it('always converges after copying everything (fuzz)', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const words = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'eta', 'theta'];
    const sentence = () =>
      Array.from({ length: 1 + Math.floor(rand() * 6) }, () => words[Math.floor(rand() * words.length)]).join(' ') + '.';
    const randomDoc = () =>
      doc(
        Array.from({ length: Math.floor(rand() * 12) }, () => {
          const r = rand();
          if (r < 0.1) return P('');
          if (r < 0.2) return P(sentence(), { role: 'h', level: 1 + Math.floor(rand() * 3) });
          if (r < 0.3) return para([S(words[0]!, { b: true }), S(' ' + sentence())]);
          return P(sentence());
        }),
      );
    for (let t = 0; t < 150; t++) {
      const a = randomDoc();
      const b = randomDoc();
      for (const dir of ['l2r', 'r2l'] as const) {
        const cmp = compareDocs(a, b, O);
        const res = applySelection(cmp, dir, selectAll(cmp), modelBackend);
        const after = dir === 'l2r' ? compareDocs(a, res.doc, O) : compareDocs(res.doc, b, O);
        expect(after.hunks).toHaveLength(0);
        // Word-level route converges too.
        const inl = new Map<string, Set<number>>();
        const rows = new Set<string>();
        for (const row of cmp.rows) {
          if (row.kind === 'mod' && row.l?.type === 'p' && row.r?.type === 'p' && propsSig(row.l.props, O) === propsSig(row.r.props, O)) {
            inl.set(row.key, new Set(inlineDiff(row.l, row.r, O).changes.map((_, i) => i)));
          } else if (row.kind !== 'eq') rows.add(row.key);
        }
        const res2 = applySelection(cmp, dir, { rows, inline: inl }, modelBackend);
        const after2 = dir === 'l2r' ? compareDocs(a, res2.doc, O) : compareDocs(res2.doc, b, O);
        expect(after2.hunks).toHaveLength(0);
      }
    }
  });
});
