import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readMarkdown, readText } from '../../src/formats/text/read';
import { summarizeChange } from '../../src/ui/changes';

const A = `# Plan

We launch on 12 May.

Unchanged one.

Late payments accrue interest.

Unchanged two.

Unchanged three.

The **fee** is fixed.
`;

const B = `# Plan

We launch on 19 May.

Unchanged one.

Unchanged two.

A new paragraph appears here.

Unchanged three.

The fee is fixed.
`;

describe('list of changes', () => {
  const cmp = compareDocs(readMarkdown(A, 'a.md'), readMarkdown(B, 'b.md'), DEFAULT_OPTIONS);

  it('has one entry per change, with its kind and word counts', () => {
    expect(cmp.hunks).toHaveLength(4);
    const s = cmp.hunks.map((_, i) => summarizeChange(cmp, i));
    expect(s.map((x) => x.kind)).toEqual(['mod', 'del', 'ins', 'fmt']);
    expect(s.map((x) => [x.minus, x.plus])).toEqual([
      [1, 1],
      [4, 0],
      [0, 5],
      [0, 0],
    ]);
  });

  it('shows the changed words with a few words around them', () => {
    const [edit] = summarizeChange(cmp, 0).edits;
    expect(edit!.a).toEqual({ mark: 'del', before: 'We launch on ', text: '12', after: ' May.' });
    expect(edit!.b).toEqual({ mark: 'ins', before: 'We launch on ', text: '19', after: ' May.' });
    expect(summarizeChange(cmp, 1).edits[0]!.a).toEqual({ mark: 'del', before: '', text: 'Late payments accrue interest.', after: '', empty: false });
    expect(summarizeChange(cmp, 2).edits[0]).toEqual({ b: { mark: 'ins', before: '', text: 'A new paragraph appears here.', after: '', empty: false } });
    const fmt = summarizeChange(cmp, 3).edits[0]!;
    expect(fmt.a).toMatchObject({ mark: 'fmt', text: 'fee' });
    expect(fmt.note).toBe('Same words, different formatting');
  });

  it('shortens long stretches of text and names empty paragraphs', () => {
    const long = 'word '.repeat(200).trim();
    const opts = { ...DEFAULT_OPTIONS, ignoreEmpty: false };
    const c = compareDocs(readText('alpha\nomega\n', 'a.txt'), readText(`alpha\n\nomega\n${long}\n`, 'b.txt'), opts);
    expect(c.hunks).toHaveLength(2);
    expect(summarizeChange(c, 0).edits[0]!.b).toMatchObject({ mark: 'ins', empty: true });
    const added = summarizeChange(c, 1).edits[0]!.b!;
    expect(added.text.length).toBeLessThan(200);
    expect(added.text).toMatch(/…$/);
  });
});
