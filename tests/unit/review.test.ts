import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { applySelection, selectAll } from '../../src/core/merge';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readHtml } from '../../src/formats/html/read';
import { blockStream, changeTarget, docStream, findChange, findText, textTarget } from '../../src/review/anchor';
import type { Mark } from '../../src/review/marks';
import { margins, marginKey, placeMarks, readMarks, swapMarks, toggleReaction } from '../../src/review/marks';

const O = DEFAULT_OPTIONS;
const A = '<h1>Plan</h1><p>We will build the site.</p><p>The site has a blog.</p><table><tr><td>Fee</td><td>$100</td></tr><tr><td>Hosting</td><td>$20</td></tr></table>';
const B = '<h1>Plan</h1><p>We will build the new site.</p><p>The site has a blog.</p><table><tr><td>Fee</td><td>$120</td></tr><tr><td>Hosting</td><td>$20</td></tr></table>';

describe('anchoring text', () => {
  it('reads blocks as text, tables with tabs and line breaks', () => {
    const d = readHtml(A, 'a.html');
    expect(blockStream(d.blocks[3]!)).toBe('Fee\t$100\nHosting\t$20');
    expect(docStream(d).text).toBe('Plan\nWe will build the site.\nThe site has a blog.\nFee\t$100\nHosting\t$20');
  });

  it('finds repeated words by what surrounds them', () => {
    const d = readHtml(A, 'a.html');
    const s = docStream(d);
    // The second "site".
    const at = s.text.indexOf('site', s.text.indexOf('site') + 1);
    const t = textTarget(s, 'a', at, at + 4);
    expect(findText(s, t)).toEqual({ start: at, end: at + 4 });
    // After an edit before it, and with new block ids (a reload), it is the same words.
    const edited = readHtml(A.replace('We will build', 'Soon we will build'), 'a.html');
    const s2 = docStream(edited);
    const again = findText(s2, t)!;
    expect(s2.text.slice(again.start - 4, again.end + 4)).toBe('The site has');
  });

  it('places marks beside rows and loses them with their words', () => {
    const a = readHtml(A, 'a.html');
    const b = readHtml(B, 'b.html');
    const cmp = compareDocs(a, b, O);
    const s = docStream(b);
    const at = s.text.indexOf('new site');
    const marks: Mark[] = [
      { id: 'h', kind: 'highlight', target: textTarget(s, 'b', at, at + 8), color: 'green', created: 1 },
      { id: 'r', kind: 'reaction', target: changeTarget(cmp, 0), reaction: 'idea', created: 1 },
    ];
    const placed = placeMarks(marks, cmp);
    expect(placed.every((p) => p.found)).toBe(true);
    const row = cmp.rows[cmp.hunks[0]!.start]!;
    expect(placed[0]!.rowKey).toBe(row.key);
    const m = margins(placed);
    expect(m.get(marginKey(row.key, 'b'))).toEqual({ notes: 0, highlights: ['green'], reactions: ['idea'] });
    // A's side has the change's reaction but not B's highlight.
    expect(m.get(marginKey(row.key, 'a'))).toEqual({ notes: 0, highlights: [], reactions: ['idea'] });

    // Making B match A takes "new site" away and resolves the change.
    const merged = applySelection(cmp, 'r2l', selectAll(cmp), modelBackend).doc;
    const after = placeMarks(marks, compareDocs(merged, b, O));
    expect(after.map((p) => p.found)).toEqual([true, false]);
    const same = compareDocs(a, applySelection(cmp, 'l2r', selectAll(cmp), modelBackend).doc, O);
    expect(placeMarks(marks, same).map((p) => p.found)).toEqual([false, false]);
  });

  it('keeps thumbs up and down apart, and swaps marks with the documents', () => {
    const cmp = compareDocs(readHtml(A, 'a.html'), readHtml(B, 'b.html'), O);
    const t = changeTarget(cmp, 0);
    let marks = toggleReaction([], t, 0, cmp, 'up');
    marks = toggleReaction(marks, t, 0, cmp, 'idea');
    marks = toggleReaction(marks, t, 0, cmp, 'down');
    expect(marks.map((m) => (m.kind === 'reaction' ? m.reaction : '')).sort()).toEqual(['down', 'idea']);
    marks = toggleReaction(marks, t, 0, cmp, 'down');
    expect(marks.map((m) => (m.kind === 'reaction' ? m.reaction : ''))).toEqual(['idea']);

    const swapped = compareDocs(cmp.right, cmp.left, O);
    expect(findChange(swapped, swapMarks(marks)[0]!.target as typeof t)).toBe(0);
  });

  it('reads back only well-formed marks', () => {
    const good = { id: 'n', kind: 'note', text: 'Hi', created: 1, target: { type: 'text', side: 'a', quote: 'x', prefix: '', suffix: '', pos: 0 } };
    expect(readMarks([good, { id: 'bad', kind: 'note' }, { ...good, kind: 'highlight', color: 'purple' }, null])).toHaveLength(1);
    expect(readMarks('nonsense')).toEqual([]);
  });
});
