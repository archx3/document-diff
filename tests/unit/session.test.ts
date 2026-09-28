import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { applySelection, selectAll } from '../../src/core/merge';
import { blockText } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { docxBackend } from '../../src/formats/docx/backend';
import { readDocx } from '../../src/formats/docx/read';
import { readHtml } from '../../src/formats/html/read';
import { noteSource } from '../../src/lib/sources';
import { plainDoc, restoreDoc, snapshotDoc } from '../../src/ui/session';

const O = DEFAULT_OPTIONS;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC';

describe('sessions', () => {
  it('saves an edited document without a file as its model, and reads it back the same', async () => {
    const a = readHtml(`<h1>Plan</h1><p>One <b>two</b> <a href="https://example.org/">three</a>.</p><p><img src="data:image/png;base64,${PNG}" alt="Logo"></p><table><tr><td>x</td><td>y</td></tr></table>`, 'a.html');
    const b = readHtml('<h1>Plan</h1><p>One two.</p>', 'b.html');
    const edited = applySelection(compareDocs(a, b, O), 'l2r', selectAll(compareDocs(a, b, O)), modelBackend).doc;
    const saved = snapshotDoc(edited);
    expect(saved.how).toBe('model');
    // What is stored is plain data: it survives a structured clone (as IndexedDB makes).
    const back = await restoreDoc(structuredClone(saved));
    expect(compareDocs(edited, back, O).hunks).toHaveLength(0);
    expect(back.blocks.map(blockText)).toEqual(edited.blocks.map(blockText));
    // New ids, as a newly read file's.
    expect(back.blocks[0]!.id).not.toBe(edited.blocks[0]!.id);
  });

  it('drops format data and page-bound picture URLs', () => {
    const d = readHtml(`<p>Hi <img src="data:image/png;base64,${PNG}" alt="Logo"></p>`, 'a.html');
    const withBlob = { ...d, blocks: d.blocks.map((blk) => (blk.type === 'p' ? { ...blk, x: { el: {} }, spans: blk.spans.map((s) => (s.obj ? { ...s, obj: { ...s.obj, src: 'blob:x' } } : s)) } : blk)) };
    const plain = plainDoc(withBlob);
    const p = plain.blocks[0]!;
    expect(p.x).toBeUndefined();
    expect(p.type === 'p' && p.spans.find((s) => s.obj)?.obj?.src).toBeUndefined();
    expect(p.type === 'p' && p.spans.find((s) => s.obj)?.obj?.data?.length).toBeGreaterThan(0);
  });

  it('saves an unedited file as that file, and an edited Word file with the copied changes written in', async () => {
    const bytesA = readFileSync('tests/fixtures/contract-v1.docx');
    const a = readDocx(bytesA, 'contract-v1.docx');
    const b = readDocx(readFileSync('tests/fixtures/contract-v2.docx'), 'contract-v2.docx');
    const file = new File([bytesA], 'contract-v1.docx');
    noteSource(a, file);
    const unedited = snapshotDoc(a);
    expect(unedited.how === 'file' && unedited.file).toBe(file);

    const cmp = compareDocs(a, b, O);
    const merged = applySelection(cmp, 'r2l', selectAll(cmp), docxBackend).doc;
    const saved = snapshotDoc(merged);
    expect(saved.how).toBe('file');
    const back = await restoreDoc(saved);
    expect(back.kind).toBe('docx');
    expect(compareDocs(back, b, O).hunks).toHaveLength(0);
  });
});
