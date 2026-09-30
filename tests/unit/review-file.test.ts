import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockText } from '../../src/core/model';
import { readDocx } from '../../src/formats/docx/read';
import { readPlainText } from '../../src/formats/text/plain';
import { WrongPassword, isLocked, packReview, unpackReview } from '../../src/ui/review-file';

const texts = (d: { blocks: Parameters<typeof blockText>[0][] } | null) => (d ? d.blocks.map(blockText).filter((t) => t.trim()) : []);

describe('review files', () => {
  const a = readPlainText('One.\n\nTwo old.\n', 'a.txt');
  const b = readPlainText('One.\n\nTwo new.\n', 'b.txt');
  const extra = { review: [{ id: 'm1', kind: 'note', text: 'Why?', created: 1, author: 'Sam', target: { type: 'change', ha: 'x', hb: 'y', a: '', b: '', index: 0 } }], ignored: { words: ['colour'], rules: [] } };

  it('keeps both documents, the other versions and the review', async () => {
    const v3 = readPlainText('One.\n\nTwo newer.\n', 'c.txt');
    const bytes = await packReview({ docs: { a, b, edits: { a: 0, b: 1 }, sample: false }, extra, versions: [a, b, v3] }, { reviewer: 'Sam' });
    expect(isLocked(bytes)).toBe(false);
    const out = await unpackReview(bytes);
    expect(out.reviewer).toBe('Sam');
    expect(texts(out.docs.a)).toEqual(['One.', 'Two old.']);
    expect(texts(out.docs.b)).toEqual(['One.', 'Two new.']);
    expect(out.docs.edits).toEqual({ a: 0, b: 1 });
    expect(out.extra).toEqual(extra);
    expect(out.versions.map((v) => v.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    // A version that is A is the same document as A.
    expect(out.versions[0]).toBe(out.docs.a);
  });

  it('keeps Word files as Word files, pictures and all', async () => {
    const wa = readDocx(readFileSync('tests/fixtures/complex-v1.docx'), 'complex-v1.docx');
    const wb = readDocx(readFileSync('tests/fixtures/complex-v2.docx'), 'complex-v2.docx');
    const out = await unpackReview(await packReview({ docs: { a: wa, b: wb, edits: { a: 0, b: 0 }, sample: false }, extra: {}, versions: [] }));
    expect(texts(out.docs.a)).toEqual(texts(wa));
    expect(texts(out.docs.b)).toEqual(texts(wb));
    expect(out.docs.b?.kind).toBe('docx');
  });

  it('can be locked with a password, and opens only with it', async () => {
    const bytes = await packReview({ docs: { a, b, edits: { a: 0, b: 0 }, sample: false }, extra, versions: [] }, { password: 'correct horse' });
    expect(isLocked(bytes)).toBe(true);
    // The text is not readable in the file.
    expect(new TextDecoder().decode(bytes)).not.toContain('Two old');
    await expect(unpackReview(bytes)).rejects.toBeInstanceOf(WrongPassword);
    await expect(unpackReview(bytes, 'wrong')).rejects.toBeInstanceOf(WrongPassword);
    const out = await unpackReview(bytes, 'correct horse');
    expect(texts(out.docs.b)).toEqual(['One.', 'Two new.']);
  });

  it('says so when a file is not a review file', async () => {
    await expect(unpackReview(new TextEncoder().encode('hello'))).rejects.toThrow('not a Collate review file');
  });
});
