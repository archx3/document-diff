import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readMarkdown, readText } from '../../src/formats/text/read';
import { changeListHtml, summarizeChange } from '../../src/ui/changes';

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
    expect(edit!.a).toBe('We launch on <del>12</del> May.');
    expect(edit!.b).toBe('We launch on <ins>19</ins> May.');
    expect(summarizeChange(cmp, 1).edits[0]!.a).toBe('<del>Late payments accrue interest.</del>');
    expect(summarizeChange(cmp, 2).edits[0]).toEqual({ b: '<ins>A new paragraph appears here.</ins>' });
    const fmt = summarizeChange(cmp, 3).edits[0]!;
    expect(fmt.a).toContain('<mark class="fmt">fee</mark>');
    expect(fmt.note).toBe('Same words, different formatting');
  });

  it('builds a card for every change, marking the current one', () => {
    const html = changeListHtml(cmp, 2);
    expect(html.match(/class="chg-card/g)).toHaveLength(4);
    expect(html).toContain('data-hunk="2"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/class="chg-card k-ins cur" aria-current="true" data-hunk="2"/);
    expect(html).toContain('Only in A');
    expect(html).toContain('−4');
  });

  it('escapes document text and shortens long stretches', () => {
    const long = 'word '.repeat(200).trim();
    const c = compareDocs(readText('alpha\n<b>bold</b> & more\nomega\n', 'a.txt'), readText(`alpha\nomega\n${long}\n`, 'b.txt'), DEFAULT_OPTIONS);
    const html = changeListHtml(c, 0);
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; more');
    expect(html).not.toContain('<b>bold');
    const added = summarizeChange(c, 1).edits[0]!.b!;
    expect(added.length).toBeLessThan(260);
    expect(added).toMatch(/…<\/ins>$/);
  });
});
