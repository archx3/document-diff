import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ParaBlock } from '../../src/core/model';
import { blockText } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { replaceInParagraph } from '../../src/check/edit';
import { docxBackend } from '../../src/formats/docx/backend';
import { readDocx } from '../../src/formats/docx/read';
import { exportDocx } from '../../src/formats/docx/writer';
import { readHtml } from '../../src/formats/html/read';
import { odtBackend } from '../../src/formats/odt/backend';
import { readOdt } from '../../src/formats/odt/read';
import { exportOdt } from '../../src/formats/odt/writer';
import { blockStream } from '../../src/review/anchor';

const para = (blocks: readonly unknown[], start: string) => blocks.find((b) => (b as ParaBlock).type === 'p' && blockText(b as ParaBlock).startsWith(start)) as ParaBlock;

describe('fixing words', () => {
  it('replaces words in a pasted paragraph, keeping their formatting', () => {
    const d = readHtml('<p>We will <b>recieve</b> teh files.</p>', 'a.html');
    const p = d.blocks[0] as ParaBlock;
    const text = blockStream(p);
    const once = replaceInParagraph(d, p, text.indexOf('recieve'), text.indexOf('recieve') + 7, 'receive', modelBackend)!;
    const p2 = once.blocks[0] as ParaBlock;
    expect(blockText(p2)).toBe('We will receive teh files.');
    expect(p2.spans.find((s) => s.text.includes('receive'))?.fmt.b).toBe(true);
    const at = blockStream(p2).indexOf('teh');
    const twice = replaceInParagraph(once, p2, at, at + 3, 'the', modelBackend)!;
    expect(blockText(twice.blocks[0]!)).toBe('We will receive the files.');
    expect(twice.version).toBe(d.version + 2);
  });

  it('writes the fix into a Word file', () => {
    const d = readDocx(readFileSync('tests/fixtures/contract-v1.docx'), 'contract-v1.docx');
    const p = para(d.blocks, 'The Contractor will design');
    const at = blockStream(p).indexOf('design');
    const fixed = replaceInParagraph(d, p, at, at + 6, 'plan', docxBackend)!;
    const back = readDocx(exportDocx(fixed), 'fixed.docx');
    expect(blockText(para(back.blocks, 'The Contractor will'))).toContain('The Contractor will plan and build');
  });

  it('writes the fix into an OpenDocument file', () => {
    const d = readOdt(readFileSync('tests/fixtures/contract-v1.odt'), 'contract-v1.odt');
    const p = para(d.blocks, 'The Contractor will design');
    const at = blockStream(p).indexOf('design');
    const fixed = replaceInParagraph(d, p, at, at + 6, 'plan', odtBackend)!;
    const back = readOdt(exportOdt(fixed), 'fixed.odt');
    expect(blockText(para(back.blocks, 'The Contractor will'))).toContain('The Contractor will plan and build');
  });

  it('removes words, and leaves paragraphs inside tables alone', () => {
    const d = readHtml('<p>the the end</p><table><tr><td><p>cell</p></td></tr></table>', 'a.html');
    const p = d.blocks[0] as ParaBlock;
    expect(blockText(replaceInParagraph(d, p, 3, 7, '', modelBackend)!.blocks[0]!)).toBe('the end');
    const cell = (d.blocks[1] as { rows: Array<{ cells: Array<{ blocks: ParaBlock[] }> }> }).rows[0]!.cells[0]!.blocks[0]!;
    expect(replaceInParagraph(d, cell, 0, 4, 'Cell', modelBackend)).toBeNull();
  });
});
