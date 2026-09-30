import { describe, expect, it } from 'vitest';
import { contractFindings, wordsToNumber } from '../../src/check/contract';
import { compareDocs } from '../../src/core/compare';
import type { Doc } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readPlainText } from '../../src/formats/text/plain';
import { blockStream } from '../../src/review/anchor';

/** Each finding as "rule: words — message", for one document of the comparison. */
function findings(a: Doc, b: Doc, side: 'a' | 'b' = 'b'): string[] {
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
  const doc = side === 'a' ? cmp.left : cmp.right;
  const out: string[] = [];
  for (const block of doc.blocks) {
    for (const i of contractFindings(cmp).get(block) ?? []) {
      expect(blockStream(block).slice(i.start, i.end)).toBe(i.text);
      out.push(`${i.rule}: ${i.text} — ${i.message}`);
    }
  }
  return out;
}

const doc = (text: string, name = 'b.txt') => readPlainText(text, name);
const numbered = (body: string) =>
  doc(`1. Definitions\n\n1.1 Scope of the terms.\n\n2. Services\n\n2.1 The work.\n\n2.2 Changes, as set out in clause 2.1.\n\n3. Payment\n\n${body}\n`);

describe('contract checks', () => {
  it('reads numbers written in words', () => {
    expect(wordsToNumber('nine thousand five hundred')).toBe(9500);
    expect(wordsToNumber('twenty-one')).toBe(21);
    expect(wordsToNumber('one million two hundred and fifty thousand')).toBe(1_250_000);
    expect(wordsToNumber('several')).toBeNull();
  });

  it('finds cross-references to clauses that are not there', () => {
    const b = numbered('3.1 Payment is due as described in clause 4.2 and section 2.2.');
    expect(findings(b, b)).toEqual(['xref: clause 4.2 — There is no clause 4.2 in this document']);
  });

  it('leaves documents without numbered clauses alone', () => {
    const b = doc('See clause 9 for details.\n');
    expect(findings(b, b)).toEqual([]);
  });

  it('finds defined terms never used, and terms used after their definition went', () => {
    const a = doc('“Services” means the work.\n\n“Fees” means the price.\n\nThe Services are paid by Fees.\n', 'a.txt');
    const b = doc('“Services” means the work.\n\n“Deliverables” means the files.\n\nThe Services are paid by Fees.\n');
    expect(findings(a, b)).toEqual([
      'term-unused: Deliverables — “Deliverables” is defined but never used',
      'term-undefined: Fees — “Fees” is used here, but its definition was removed',
    ]);
  });

  it('finds amounts in words and figures that disagree', () => {
    const b = doc('The fee is nine thousand dollars ($9,500).\n\nThe deposit is $1,000 (one thousand dollars).\n\nLate fees are 2,000 (three thousand) dollars.\n');
    expect(findings(b, b)).toEqual([
      'figures: $9,500 — The words say 9,000, the figures 9,500',
      'figures: 2,000 — The figures say 2,000, the words 3,000',
    ]);
  });

  it('finds a party spelled two ways, and one renamed in only some places', () => {
    const b = doc('This agreement is between Harbor & Pine LLC and Northwind Ltd.\n\nHarbor & Pine LLC pays.\n\nHarbour & Pine LLC signs.\n');
    expect(findings(b, b)).toEqual(['party: Harbour & Pine LLC — Elsewhere the party is “Harbor & Pine LLC”']);
    const a = doc('Between Harbor & Pine LLC and Northwind Ltd.\n\nHarbor & Pine LLC pays.\n\nHarbor & Pine LLC signs.\n', 'a.txt');
    const renamed = doc('Between Seaside Holdings LLC and Northwind Ltd.\n\nSeaside Holdings LLC pays.\n\nHarbor & Pine LLC signs.\n');
    expect(findings(a, renamed)).toEqual(['party: Harbor & Pine LLC — Elsewhere in this version the party is now “Seaside Holdings LLC”']);
  });
});
