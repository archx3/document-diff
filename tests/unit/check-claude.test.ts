import { describe, expect, it } from 'vitest';
import type { Sampler } from '../../src/check/claude';
import { batches, claudeCheck, prompt, toIssues } from '../../src/check/claude';

const paras = [
  { key: 'p1', text: 'Their going to the office tomorow.' },
  { key: 'p2', text: 'Everything here is fine.' },
];

describe('Claude suggestions', () => {
  it('asks about numbered paragraphs, in batches of a sensible size', () => {
    const text = prompt(paras, 'en-GB');
    expect(text).toContain('English (UK)');
    expect(text).toContain('[1] Their going to the office tomorow.');
    expect(text).toContain('[2] Everything here is fine.');
    const many = Array.from({ length: 100 }, (_, i) => ({ key: `k${i}`, text: 'x'.repeat(200) }));
    const b = batches(many);
    expect(b.length).toBeGreaterThan(1);
    expect(b.flat()).toHaveLength(100);
  });

  it('turns findings into issues where their words are, and drops the rest', () => {
    const found = toIssues(paras, [
      { p: 1, text: 'Their', fix: 'They’re', why: 'Contraction of “they are”' },
      { p: '1', text: 'tomorow', fix: 'tomorrow', why: 'Spelling' },
      { p: 2, text: 'not there', fix: 'x' },
      { p: 7, text: 'Everything', fix: 'All' },
      { p: 2, text: 'fine', fix: 'fine' },
      'nonsense',
    ]);
    expect(found.get('p1')!.map((i) => [i.start, i.text, i.suggestions[0], i.source])).toEqual([
      [0, 'Their', 'They’re', 'claude'],
      [26, 'tomorow', 'tomorrow', 'claude'],
    ]);
    expect(found.get('p2')).toEqual([]);
    expect(toIssues(paras, { not: 'an array' }).get('p1')).toEqual([]);
  });

  it('reports each batch as it comes, and stops when aborted', async () => {
    const asked: string[] = [];
    const sample: Sampler = {
      json: async (input) => {
        asked.push(input);
        return [{ p: 1, text: 'tomorow', fix: 'tomorrow' }] as never;
      },
    };
    const seen: Array<[number, number]> = [];
    await claudeCheck(sample, paras, 'en-US', (found, done, total) => {
      seen.push([done, total]);
      expect(found.get('p1')![0]!.text).toBe('tomorow');
    });
    expect(asked).toHaveLength(1);
    expect(seen).toEqual([[1, 1]]);
    const ctl = new AbortController();
    ctl.abort();
    await claudeCheck(sample, paras, 'en-US', () => {}, ctl.signal);
    expect(asked).toHaveLength(1);
  });
});
