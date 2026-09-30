import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import type { Doc } from '../../src/core/model';
import { isBlank } from '../../src/core/model';
import type { RedNote } from '../../src/core/redline';
import { redlinePlan } from '../../src/core/redline';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDocx } from '../../src/formats/docx/read';
import { redlineDocx } from '../../src/formats/docx/redline';
import { exportDocx } from '../../src/formats/docx/writer';
import { readPlainText } from '../../src/formats/text/plain';
import { readMarkdown } from '../../src/formats/text/read';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const load = (name: string): Doc => readDocx(readFileSync(`tests/fixtures/${name}`), name);

function documentXml(bytes: Uint8Array): Document {
  const files = unzipSync(bytes);
  expect(Object.keys(files)[0]).toBe('[Content_Types].xml');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(files['word/document.xml']!), 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

const all = (el: Element | Document, local: string) => Array.from(el.getElementsByTagNameNS(W, local));
/** A change around runs (not the mark on a paragraph's end or a table row). */
const around = (el: Element) => !['rPr', 'trPr'].includes((el.parentNode as Element).localName);

/**
 * The paragraphs' text after Word's "Accept all changes" or "Reject all
 * changes": what the redline stands for in each direction.
 */
function resolved(bytes: Uint8Array, mode: 'accept' | 'reject'): string[] {
  const doc = documentXml(bytes);
  // A move is removed text where it was, and added text where it went.
  const drop = mode === 'accept' ? ['del', 'moveFrom'] : ['ins', 'moveTo'];
  const keep = mode === 'accept' ? ['ins', 'moveTo'] : ['del', 'moveFrom'];
  const every = (names: string[]) => names.flatMap((n) => all(doc, n));
  const has = (el: Element, names: string[]) => names.some((n) => all(el, n).length > 0);
  for (const el of every(drop).filter(around)) el.parentNode?.removeChild(el);
  for (const el of every(keep).filter(around)) {
    while (el.firstChild) el.parentNode!.insertBefore(el.firstChild, el);
    el.parentNode!.removeChild(el);
  }
  for (const tr of all(doc, 'tr')) if (all(tr, 'trPr').some((p) => has(p, drop))) tr.parentNode!.removeChild(tr);
  const out: string[] = [];
  for (const p of all(doc, 'p')) {
    // Pictures' own text boxes are counted with their paragraph.
    if ((p.parentNode as Element).localName === 'txbxContent') continue;
    const text = all(p, '*')
      .filter((n) => n.localName === 't' || n.localName === 'delText' || n.localName === 'tab')
      .map((n) => (n.localName === 'tab' ? '\t' : n.textContent))
      .join('');
    // A paragraph removed as a whole leaves nothing behind.
    const gone = all(p, 'pPr').some((pPr) => has(pPr, drop));
    if (text.trim() && !gone) out.push(text);
  }
  return out;
}

/** The paragraphs' text of a document on its own. */
const plain = (d: Doc) => resolved(exportDocx(d), 'accept');
/** Page numbers are fields Word works out again: the comparison leaves them out, and so does this. */
const pages = (ps: string[]) => ps.map((p) => p.replace(/\bpage \d+/g, 'page #'));

function checkRedline(a: Doc, b: Doc, file: string) {
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
  const bytes = redlineDocx(cmp, { author: 'Collate test', date: new Date('2026-09-29T09:00:00Z') });
  writeFileSync(`${OUT}/${file}`, bytes);
  const doc = documentXml(bytes);
  const changes = [...all(doc, 'ins'), ...all(doc, 'del'), ...all(doc, 'rPrChange')];
  // The files' own tracked changes are accepted: every change is the redline's.
  const ours = changes.filter((c) => c.getAttributeNS(W, 'author') === 'Collate test');
  expect(ours.length).toBeGreaterThan(0);
  expect(ours).toHaveLength(changes.length);
  for (const c of ours) expect(c.getAttributeNS(W, 'date')).toBe('2026-09-29T09:00:00Z');
  const ids = ours.map((c) => c.getAttributeNS(W, 'id'));
  expect(new Set(ids).size).toBe(ids.length);
  // Deleted words are kept as deleted text, never as text.
  for (const d of all(doc, 'del').filter(around)) expect(all(d, 't')).toHaveLength(0);
  expect(pages(resolved(bytes, 'accept'))).toEqual(pages(plain(b)));
  expect(pages(resolved(bytes, 'reject'))).toEqual(pages(plain(a)));
}

describe('redline', () => {
  it('plans B in order, with A’s removed paragraphs in place and changed words marked', () => {
    const a = readPlainText('One.\n\nTwo old words.\n\nThree.\n', 'a.txt');
    const b = readPlainText('One.\n\nTwo new words.\n\nFour.\n\nThree.\n', 'b.txt');
    const plan = redlinePlan(compareDocs(a, b, DEFAULT_OPTIONS));
    // (Leaving out the blank lines between paragraphs.)
    const shown = plan.filter((i) => !(i.kind === 'same' && isBlank(i.block)));
    expect(shown.map((i) => i.kind)).toEqual(['same', 'para', 'ins', 'same']);
    const para = shown[1]!;
    if (para.kind !== 'para') throw new Error('expected a changed paragraph');
    const text = (side: 'a' | 'b', span: number, s: number, e: number) => (side === 'a' ? para.a : para.b).spans[span]!.text.slice(s, e);
    expect(para.pieces.map((p) => [p.mark ?? '', text(p.side, p.span, p.start, p.end)])).toEqual([
      ['', 'Two '],
      ['del', 'old'],
      ['ins', 'new'],
      ['', ' words.'],
    ]);
  });

  it('writes Word tracked changes that accept to B and reject to A', () => {
    checkRedline(load('contract-v1.docx'), load('contract-v2.docx'), 'redline-contract.docx');
  });

  it('works the other way round, and on harder Word features (tables, lists, pictures, notes)', () => {
    checkRedline(load('contract-v2.docx'), load('contract-v1.docx'), 'redline-contract-reverse.docx');
    checkRedline(load('complex-v1.docx'), load('complex-v2.docx'), 'redline-complex.docx');
  });

  it('works between files saved by different word processors', () => {
    checkRedline(load('contract-v1-lo.docx'), load('contract-v2.docx'), 'redline-lo.docx');
  });

  it('builds a new Word file when neither document is one', () => {
    const a = readPlainText('Payment is due in 30 days.\n\nThe term is one year.\n', 'a.txt');
    const b = readPlainText('Payment is due in 45 days.\n\nLate payments carry interest.\n\nThe term is one year.\n', 'b.txt');
    checkRedline(a, b, 'redline-text.docx');
  });

  it('marks formatting-only changes as formatting, not as removed and added words', () => {
    const a = readMarkdown('Keep this word plain.\n', 'a.md');
    const b = readMarkdown('Keep this **word** plain.\n', 'b.md');
    const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
    const para = redlinePlan(cmp).find((i) => i.kind === 'para');
    if (para?.kind !== 'para') throw new Error('expected a changed paragraph');
    expect(para.pieces.map((p) => p.mark ?? '')).toEqual(['', 'fmt', '']);
    const doc = documentXml(redlineDocx(cmp));
    expect(all(doc, 'rPrChange')).toHaveLength(1);
    expect(all(doc, 'del').filter(around)).toHaveLength(0);
    expect(resolved(redlineDocx(cmp), 'reject')).toEqual(['Keep this word plain.']);
  });
});

describe('redline comments', () => {
  const a = readPlainText('One.\n\nTwo old words.\n\nGone paragraph.\n\nThree.\n', 'a.txt');
  const b = readPlainText('One.\n\nTwo new words.\n\nThree.\n', 'b.txt');
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
  const block = (d: Doc, text: string) => d.blocks.find((x) => x.type === 'p' && x.spans.map((s) => s.text).join('') === text)!;
  const on = (side: 'a' | 'b', d: Doc, text: string, words: string): RedNote['on'] => {
    const bl = block(d, text);
    const start = text.indexOf(words);
    return { kind: 'text', side, parts: [{ block: bl, start, end: start + words.length }] };
  };
  const notes: RedNote[] = [
    { text: 'Why new?', date: Date.UTC(2026, 8, 1), on: on('b', b, 'Two new words.', 'new words') },
    { text: 'Keep this one.\nIt matters.', date: Date.UTC(2026, 8, 1), author: 'Sam Lee', on: on('a', a, 'Gone paragraph.', 'Gone') },
    { text: 'Fine as is', date: Date.UTC(2026, 8, 1), on: on('b', b, 'Three.', 'Three') },
    { text: 'Looks right', date: Date.UTC(2026, 8, 1), on: { kind: 'change', hunk: 0 } },
  ];
  const bytes = redlineDocx(cmp, { author: 'Collate test', notes });
  writeFileSync(`${OUT}/redline-comments.docx`, bytes);
  const files = unzipSync(bytes);
  const comments = new DOMParser().parseFromString(new TextDecoder().decode(files['word/comments.xml']!), 'application/xml');

  /** The text inside each comment's range, by comment id. */
  function ranges(): Map<string, string> {
    const doc = documentXml(bytes);
    const open = new Map<string, string>();
    const done = new Map<string, string>();
    for (const el of all(doc, '*')) {
      const id = el.getAttributeNS(W, 'id') ?? '';
      if (el.localName === 'commentRangeStart') open.set(id, '');
      else if (el.localName === 'commentRangeEnd') {
        done.set(id, open.get(id) ?? '');
        open.delete(id);
      } else if (el.localName === 't' || el.localName === 'delText') for (const k of open.keys()) open.set(k, open.get(k)! + el.textContent);
    }
    return done;
  }

  it('puts each note in as a comment, with its author, date and lines', () => {
    const list = all(comments, 'comment');
    expect(list.map((c) => c.getAttributeNS(W, 'author'))).toEqual(['Collate test', 'Sam Lee', 'Collate test', 'Collate test']);
    expect(list[1]!.getAttributeNS(W, 'initials')).toBe('SL');
    expect(all(list[1]!, 'p').map((p) => p.textContent)).toEqual(['Keep this one.', 'It matters.']);
    expect(list[0]!.getAttributeNS(W, 'date')).toBe('2026-09-01T00:00:00Z');
    const types = new TextDecoder().decode(files['[Content_Types].xml']!);
    expect(types).toContain('comments+xml');
    expect(new TextDecoder().decode(files['word/_rels/document.xml.rels']!)).toContain('comments.xml');
  });

  it('covers exactly the noted words, in B’s text, in A’s removed text, and a whole change', () => {
    const [newWords, gone, three, change] = all(comments, 'comment').map((c) => c.getAttributeNS(W, 'id')!);
    const r = ranges();
    expect(r.get(newWords!)).toBe('new words');
    expect(r.get(gone!)).toBe('Gone');
    expect(r.get(three!)).toBe('Three');
    // The first change: A's "old" struck out and B's "new" in its place, and the paragraph removed after it.
    expect(r.get(change!)).toBe('Two oldnew words.Gone paragraph.');
    const doc = documentXml(bytes);
    expect(all(doc, 'commentReference')).toHaveLength(4);
  });

  it('leaves the text as it was: accepting gives B, rejecting gives A', () => {
    expect(resolved(bytes, 'accept')).toEqual(plain(b));
    expect(resolved(bytes, 'reject')).toEqual(plain(a));
  });
});

it('adds its comments after a Word file’s own, with every range matched to a comment', () => {
  const a = load('complex-v1.docx');
  const b = load('complex-v2.docx');
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
  const first = b.blocks.find((x) => x.type === 'p' && x.spans.some((s) => s.text.trim()))!;
  const notes: RedNote[] = [{ text: 'Check this', date: 0, on: { kind: 'text', side: 'b', parts: [{ block: first, start: 0, end: 3 }] } }];
  for (let h = 0; h < cmp.hunks.length; h++) notes.push({ text: `Change ${h + 1}`, date: 0, on: { kind: 'change', hunk: h } });
  const bytes = redlineDocx(cmp, { notes });
  const files = unzipSync(bytes);
  const comments = new DOMParser().parseFromString(new TextDecoder().decode(files['word/comments.xml']!), 'application/xml');
  const ids = all(comments, 'comment').map((c) => c.getAttributeNS(W, 'id'));
  expect(new Set(ids).size).toBe(ids.length);
  const doc = documentXml(bytes);
  for (const local of ['commentRangeStart', 'commentRangeEnd', 'commentReference']) for (const el of all(doc, local)) expect(ids).toContain(el.getAttributeNS(W, 'id'));
  expect(all(doc, 'commentReference').length).toBeGreaterThanOrEqual(notes.length);
  expect(resolved(bytes, 'accept')).toEqual(plain(b));
});

describe('moves', () => {
  const a = readPlainText('Intro.\n\nThe Contractor keeps the source files for five years.\n\nMiddle one.\n\nMiddle two.\n\nThe fee is due on signing, in full.\n\nEnd.\n', 'a.txt');
  const b = readPlainText('Intro.\n\nMiddle one.\n\nMiddle two.\n\nThe Contractor keeps the source files for five years.\n\nThe fee is due on signing, in two parts.\n\nEnd.\n', 'b.txt');
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);

  it('finds a paragraph moved elsewhere', async () => {
    const { findMoves } = await import('../../src/core/moves');
    const moves = findMoves(cmp);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.exact).toBe(true);
    expect(moves[0]!.fromHunk).not.toBe(moves[0]!.toHunk);
  });

  it('writes it to a redline as a Word move, that accepts to B and rejects to A', () => {
    const bytes = redlineDocx(cmp, { author: 'Collate test' });
    writeFileSync(`${OUT}/redline-moves.docx`, bytes);
    const doc = documentXml(bytes);
    const from = all(doc, 'moveFrom').filter(around);
    const to = all(doc, 'moveTo').filter(around);
    expect(from.map((m) => m.textContent)).toEqual(['The Contractor keeps the source files for five years.']);
    expect(to.map((m) => m.textContent)).toEqual(['The Contractor keeps the source files for five years.']);
    // Moved text stays text (not deleted text), inside named ranges that pair up.
    expect(all(from[0]!, 'delText')).toHaveLength(0);
    const name = (local: string) => all(doc, local)[0]!.getAttributeNS(W, 'name');
    expect(name('moveFromRangeStart')).toBe(name('moveToRangeStart'));
    expect(all(doc, 'moveFromRangeEnd')).toHaveLength(1);
    expect(resolved(bytes, 'accept')).toEqual(plain(b));
    expect(resolved(bytes, 'reject')).toEqual(plain(a));
  });
});
