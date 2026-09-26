import { readFileSync } from 'node:fs';
import pdfmake from 'pdfmake';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import type { Comparison } from '../../src/core/compare';
import type { Doc, InlineObject, Span } from '../../src/core/model';
import { OBJ_CHAR, blockText, newId, para, textSpan } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDocx } from '../../src/formats/docx/read';
import { readHtml } from '../../src/formats/html/read';
import { loadPdfjs, readPdf } from '../../src/formats/pdf/read';
import { renderPdf } from '../../src/formats/pdf/write';
import { readDelimited, readPlainText } from '../../src/formats/text/plain';

const O = DEFAULT_OPTIONS;
const changed = (cmp: Comparison) => cmp.rows.filter((r) => r.kind !== 'eq').map((r) => `${r.kind}: ${r.l ? blockText(r.l) : ''} | ${r.r ? blockText(r.r) : ''}`);

beforeAll(() => {
  // The browser build gets these fonts from pdfmake's own font bundle.
  const dir = 'node_modules/pdfmake/build/fonts/Roboto/';
  for (const f of ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Italic.ttf', 'Roboto-MediumItalic.ttf']) pdfmake.virtualfs.writeFileSync(f, new Uint8Array(readFileSync(dir + f)));
  pdfmake.addFonts({
    Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' },
    Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
  });
});

async function roundTrip(doc: Doc): Promise<Doc> {
  const bytes = await renderPdf(pdfmake, doc);
  expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  return readPdf(bytes, 'export.pdf');
}

const obj = (o: InlineObject): Span => ({ text: OBJ_CHAR, fmt: {}, obj: o });

describe('PDF export', () => {
  it('writes a Word document that reads back the same', async () => {
    const d = readDocx(readFileSync('tests/fixtures/contract-v2.docx'), 'contract-v2.docx');
    const back = await roundTrip(d);
    // A PDF cannot keep the picture's original file or the page-number field.
    expect(changed(compareDocs(d, back, O)).filter((r) => !/^mod: (Logo|Printed on page)/.test(r))).toEqual([]);
  });

  it('keeps footnotes (as notes at the end) and the table of contents', async () => {
    const d = readDocx(readFileSync('tests/fixtures/complex-v1.docx'), 'complex-v1.docx');
    const back = await roundTrip(d);
    const para = back.blocks.find((b) => blockText(b).startsWith('Work is billed'));
    expect(para?.type === 'p' && para.spans.some((s) => s.obj?.kind === 'footnote' && s.obj.note === 'Rates are reviewed each January.')).toBe(true);
    expect(back.blocks.some((b) => b.type === 'opaque' && b.label === 'Table of contents')).toBe(true);
  });

  it('writes lists, tables, links and formatting from HTML', async () => {
    const d = readHtml(
      '<h1>Plan</h1><p>Some <b>bold</b>, <i>italic</i> and <a href="https://example.org/x">linked</a> words.</p><ol><li>First</li><li>Second<ol><li>Inner</li></ol></li></ol><ul><li>Point</li></ul><table><tr><td>Cell A</td><td>Cell B</td></tr><tr><td>Cell C</td><td>Cell D</td></tr></table><p>After.</p>',
      'plan.html',
    );
    const back = await roundTrip(d);
    expect(changed(compareDocs(d, back, O))).toEqual([]);
  });

  it('numbers pages as they fall in the PDF', async () => {
    const pageBreak = () => para([obj({ kind: 'pagebreak', key: 'page', label: 'Page break' })]);
    const field = (code: string) => obj({ kind: 'field', key: code, label: `Field: ${code}`, text: '9' });
    const d: Doc = {
      id: newId('d'),
      name: 'report.docx',
      kind: 'docx',
      version: 0,
      blocks: [
        // Page numbers from the original file's layout.
        para([textSpan('Alpha\t7')], { role: 'toc', level: 1 }),
        para([textSpan('Beta\t7')], { role: 'toc', level: 1 }),
        pageBreak(),
        para([textSpan('Alpha')], { role: 'h', level: 1 }),
        pageBreak(),
        para([textSpan('Beta')], { role: 'h', level: 1 }),
        para([textSpan('This is page '), field('PAGE'), textSpan(' of '), field('NUMPAGES'), textSpan('.')]),
      ],
    };
    const bytes = await renderPdf(pdfmake, d);
    const pdf = await (await loadPdfjs()).getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
    const text = async (n: number) => (await (await pdf.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(pdf.numPages).toBe(3);
    expect((await text(1)).replace(/\s+/g, ' ')).toBe('Alpha 2 Beta 3');
    expect(await text(3)).toContain('Beta');
    // Entries link to their headings.
    const links = (await (await pdf.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Link');
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) expect(await pdf.getDestination(a.dest as string)).not.toBeNull();
    const back = await readPdf(bytes, 'report.pdf');
    expect(back.blocks.map(blockText)).toContain('This is page 3 of 3.');
  });

  it('writes code and tables of data', async () => {
    const code = readPlainText('def total(items):\n    return sum(items)\n', 'x.py', 'py');
    const back = await roundTrip(code);
    expect(back.blocks.map(blockText)).toEqual(['def total(items):', 'return sum(items)']);
    const csv = readDelimited('name,qty\nApple,3\nPear,5\n', 'x.csv', 'csv');
    const table = (await roundTrip(csv)).blocks.find((b) => b.type === 'table');
    expect(table && blockText(table)).toBe('name\tqty\nApple\t3\nPear\t5');
  });
});
