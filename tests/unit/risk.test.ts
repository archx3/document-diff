import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { changeTexts, readPoints, summarizeWithClaude, summaryPrompt } from '../../src/check/summary';
import { readPlainText } from '../../src/formats/text/plain';
import { changeRisks, risksOf } from '../../src/review/risk';

const words = (removed: string, added: string, dropped = 0) => ({ removed, added, dropped });

describe('risk flags', () => {
  it('tells amounts, dates, obligations, parties and defined terms from the changed words', () => {
    expect(risksOf(words('$9,000', '$12,500'))).toEqual(['amount']);
    expect(risksOf(words('30 days', '45 days'))).toEqual(['date']);
    expect(risksOf(words('12 May 2026', '19 May 2026'))).toEqual(['date']);
    expect(risksOf(words('may', 'shall'))).toEqual(['obligation']);
    expect(risksOf(words('', 'the Client'))).toEqual(['party']);
    expect(risksOf(words('', '“Deliverables” means the work'))).toEqual(['definition']);
    expect(risksOf(words('a blog', 'a blog, a newsletter'))).toEqual([]);
    expect(risksOf(words('Old clause.', '', 1))).toEqual(['removed']);
    expect(risksOf(words('15%', '1.5% per month'))).toEqual(['amount']);
  });

  it('flags each change of a comparison', () => {
    const a = readPlainText('Payment is due in 30 days.\n\nOne.\n\nThe fee is $100.\n\nTwo.\n\nWe like blue.\n\nThree.\n\nThe Contractor shall indemnify.\n', 'a.txt');
    const b = readPlainText('Payment is due in 45 days.\n\nOne.\n\nThe fee is $150.\n\nTwo.\n\nWe like green.\n\nThree.\n', 'b.txt');
    const r = changeRisks(compareDocs(a, b, DEFAULT_OPTIONS));
    // A number is a period or an amount by the words around it.
    expect(r).toEqual([['date'], ['amount'], [], ['obligation', 'party', 'removed']]);
  });
});

describe('Claude summary', () => {
  const a = readPlainText('Payment is due in 30 days.\n\nSame.\n\nThe fee is $100.\n', 'a.txt');
  const b = readPlainText('Payment is due in 45 days.\n\nSame.\n\nThe fee is $150.\n', 'b.txt');
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);

  it('sends only the changed words, numbered as the changes are', () => {
    const list = changeTexts(cmp);
    expect(list).toEqual([
      { n: 1, removed: '30', added: '45' },
      { n: 2, removed: '100', added: '150' },
    ]);
    const p = summaryPrompt('a.txt', 'b.txt', list);
    expect(p).toContain('Change 1:\n  removed: 30\n  added: 45');
    expect(p).not.toContain('Same.');
  });

  it('keeps well-formed points and changes that exist', () => {
    expect(readPoints([{ text: ' Payment moved to 45 days. ', changes: [1, '2', 9, 1] }, { text: '' }, { nope: 1 }], 2)).toEqual([{ text: 'Payment moved to 45 days.', changes: [0, 1] }]);
    expect(readPoints('not json', 2)).toEqual([]);
  });

  it('asks Claude and reads its answer', async () => {
    const asked: string[] = [];
    const sample = { json: async (input: string) => (asked.push(input), [{ text: 'Payment is later and the fee is higher.', changes: [1, 2] }]) };
    const points = await summarizeWithClaude(sample as never, cmp);
    expect(asked).toHaveLength(1);
    expect(points).toEqual([{ text: 'Payment is later and the fee is higher.', changes: [0, 1] }]);
  });
});
