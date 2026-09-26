import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import type { Comparison } from '../../src/core/compare';
import { computeListLabels } from '../../src/core/lists';
import { applySelection, selectAll } from '../../src/core/merge';
import type { Doc, ParaBlock } from '../../src/core/model';
import { blockText } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDoc } from '../../src/formats/doc/read';
import { docxBackend } from '../../src/formats/docx/backend';
import { readDocx } from '../../src/formats/docx/read';
import { exportDocx } from '../../src/formats/docx/writer';
import { readEpub } from '../../src/formats/epub/read';
import { readPdf } from '../../src/formats/pdf/read';

const O = DEFAULT_OPTIONS;
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const docx = (name: string) => readDocx(fixture(name), name);
const changed = (cmp: Comparison) => cmp.rows.filter((r) => r.kind !== 'eq').map((r) => `${r.kind}: ${r.l ? blockText(r.l) : ''} | ${r.r ? blockText(r.r) : ''}`);
const para = (d: Doc, start: string) => d.blocks.find((b) => b.type === 'p' && blockText(b).startsWith(start)) as ParaBlock | undefined;

describe('Word 97–2003 (.doc)', () => {
  it('reads the same content as the .docx original', () => {
    for (const f of ['contract-v1', 'contract-v2']) expect(changed(compareDocs(docx(`${f}.docx`), readDoc(fixture(`${f}.doc`), `${f}.doc`), O))).toEqual([]);
  });

  it('reads lists, tables, links, pictures, fields and notes', () => {
    const d = readDoc(fixture('contract-v1.doc'), 'contract-v1.doc');
    const labels = computeListLabels(d.blocks);
    expect(d.blocks.filter((b) => b.type === 'p' && b.props.list).map((b) => labels.get(b as ParaBlock))).toEqual(['•', '•', '•', '1.', '2.', '3.']);
    expect(para(d, 'On full payment')!.spans.find((s) => s.text === 'our standard terms')?.fmt.href).toBe('https://example.com/terms');
    expect(para(d, 'Logo')!.spans.some((s) => s.obj?.kind === 'image' && s.obj.data?.length)).toBe(true);
    expect(para(d, 'Printed on page')!.spans.some((s) => s.obj?.kind === 'field' && s.obj.key === 'PAGE')).toBe(true);
    const complex = readDoc(fixture('complex-v1.doc'), 'complex-v1.doc');
    expect(para(complex, 'Work is billed')!.spans.some((s) => s.obj?.kind === 'footnote' && s.obj.note === 'Rates are reviewed each January.')).toBe(true);
    expect(blockText(para(complex, 'Expenses')!)).toBe('Expenses are reimbursed monthly ');
    const table = complex.blocks.find((b) => b.type === 'table');
    expect(table?.type === 'table' && table.rows[0]!.cells[1]!.blocks.some((b) => b.type === 'table')).toBe(true);
    // Only the table of contents differs from the Word original (Word stores its page numbers as fields).
    expect(compareDocs(docx('complex-v1.docx'), complex, O).rows.filter((r) => r.kind !== 'eq').map((r) => r.l?.type)).toEqual(['opaque']);
  });

  it('rejects files that are not Word documents', () => {
    expect(() => readDoc(new TextEncoder().encode('hello'), 'x.doc')).toThrow(/not a Word 97/);
  });
});

function epub(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const zip: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) zip[k] = typeof v === 'string' ? enc.encode(v) : v;
  return zipSync(zip);
}

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('EPUB', () => {
  it('reads chapters in reading order with headings, lists, tables, pictures and stylesheet formatting', () => {
    const xhtml = (body: string) =>
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><link rel="stylesheet" href="../css/book.css"/></head><body>${body}</body></html>`;
    const book = epub({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Book</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="css/book.css" media-type="text/css"/><item id="img" href="img/dot.png" media-type="image/png"/></manifest><spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
      'OEBPS/nav.xhtml': xhtml('<nav><ol><li>Chapter one</li></ol></nav>'),
      'OEBPS/css/book.css': '/* book */ @media print { .x { color: red } } .strong { font-weight: bold } p.note { font-style: italic } .code, tt { font-family: monospace }',
      'OEBPS/text/ch1.xhtml': xhtml('<h1>Chapter one</h1><p>It was a <span class="strong">dark</span> night.<a id="page1"/></p><p class="note">A note.</p><ul><li>First</li><li>Second</li></ul><p>Look: <img src="../img/dot.png" alt="A dot"/></p>'),
      'OEBPS/text/ch2.xhtml': xhtml('<h2>Chapter two</h2><ol><li>Step</li></ol><table><tr><td>A</td><td>B</td></tr></table><p>Run <span class="code">npm test</span>.</p>'),
      'OEBPS/img/dot.png': PNG,
    });
    const d = readEpub(book, 'book.epub');
    expect(d.blocks.map(blockText)).toEqual(['Chapter one', 'It was a dark night.', 'A note.', 'First', 'Second', 'Look: ', 'Chapter two', 'Step', 'A\tB', 'Run npm test.']);
    expect(d.blocks[0]!.type === 'p' && d.blocks[0].props.role).toBe('h');
    expect(para(d, 'It was')!.spans.find((s) => s.text === 'dark')?.fmt.b).toBe(true);
    expect(para(d, 'A note')!.spans[0]!.fmt.i).toBe(true);
    expect(para(d, 'Run')!.spans.find((s) => s.text === 'npm test')?.fmt.code).toBe(true);
    const labels = computeListLabels(d.blocks);
    expect(d.blocks.filter((b) => b.type === 'p' && b.props.list).map((b) => labels.get(b as ParaBlock))).toEqual(['•', '•', '1.']);
    const img = para(d, 'Look')!.spans.find((s) => s.obj)!.obj!;
    expect(img.data?.length).toBe(PNG.length);
    expect(img.mime).toBe('image/png');
    expect(img.label).toBe('A dot');
  });

  it('reads the text of an EPUB exported by LibreOffice', () => {
    const d = readEpub(fixture('contract-v1.epub'), 'contract-v1.epub');
    expect(para(d, 'This Services Agreement')!.spans.find((s) => s.text === 'Northwind Studio')?.fmt.b).toBe(true);
    const cmp = compareDocs(docx('contract-v1.docx'), d, { ...O, ignoreFormatting: true });
    // The text is the same; LibreOffice's EPUB export drops heading and list styles.
    expect(cmp.rows.filter((r) => r.kind !== 'eq' && r.l && r.r && blockText(r.l).trim() !== blockText(r.r).trim()).length).toBeLessThanOrEqual(2);
  });

  it('rejects books protected with DRM and files that are not books', () => {
    const drm = epub({
      'META-INF/container.xml': `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>`,
      'a.opf': '<package xmlns="http://www.idpf.org/2007/opf"/>',
      'META-INF/encryption.xml': '<encryption><EncryptedData/></encryption>',
    });
    expect(() => readEpub(drm, 'x.epub')).toThrow(/DRM/);
    expect(() => readEpub(epub({ 'a.txt': 'x' }), 'x.epub')).toThrow(/not an EPUB/);
  });
});

describe('PDF', () => {
  // Differences a PDF cannot avoid: pictures have no original bytes and page numbers are plain text.
  const inherent = (rows: string[]) => rows.filter((r) => !/^mod: (Logo|Printed on page)/.test(r));

  it('rebuilds tagged PDFs like the Word original', async () => {
    for (const f of ['contract-v1', 'contract-v2']) {
      const d = await readPdf(fixture(`${f}.pdf`), `${f}.pdf`);
      expect(inherent(changed(compareDocs(docx(`${f}.docx`), d, O)))).toEqual([]);
    }
  });

  it('rebuilds untagged PDFs from the page layout', async () => {
    for (const f of ['contract-v1', 'contract-v2']) {
      const d = await readPdf(fixture(`${f}-untagged.pdf`), `${f}.pdf`);
      expect(d.notes?.join(' ')).toMatch(/no structure tags/);
      expect(inherent(changed(compareDocs(docx(`${f}.docx`), d, O)))).toEqual([]);
    }
  });

  it('finds titles, headings, lists, tables, links and alignment', async () => {
    const d = await readPdf(fixture('contract-v2-untagged.pdf'), 'contract-v2.pdf');
    const props = (start: string) => para(d, start)!.props;
    expect(props('Services Agreement').role).toBe('title');
    expect(props('1. Scope of work')).toMatchObject({ role: 'h', level: 1 });
    expect(props('Signed for the Client').align).toBe('center');
    const labels = computeListLabels(d.blocks);
    expect(d.blocks.filter((b) => b.type === 'p' && b.props.list).map((b) => labels.get(b as ParaBlock))).toEqual(['•', '•', '•', '•', '1.', '2.', '3.']);
    expect(para(d, 'On full payment')!.spans.find((s) => s.fmt.href)?.text.trim()).toBe('our standard terms');
    expect(d.blocks.find((b) => b.type === 'table')?.type === 'table').toBe(true);
    // A heading's bold comes from its style, as in Word; bold words in body text stay bold.
    expect(para(d, '1. Scope of work')!.spans.every((s) => !s.fmt.b)).toBe(true);
    expect(para(d, 'This Services Agreement')!.spans.find((s) => s.text.includes('Northwind'))?.fmt.b).toBe(true);
  });

  it('turns footnotes and tables of contents back into their own kinds', async () => {
    for (const f of ['complex-v1.pdf', 'complex-v1-untagged.pdf']) {
      const d = await readPdf(fixture(f), f);
      expect(d.blocks.some((b) => b.type === 'opaque' && b.label === 'Table of contents'), f).toBe(true);
      expect(d.blocks.some((b) => blockText(b).startsWith('1 Rates')), f).toBe(false);
      expect(para(d, 'Work is billed')!.spans.some((s) => s.obj?.kind === 'footnote' && s.obj.note === 'Rates are reviewed each January.'), f).toBe(true);
    }
    const tagged = await readPdf(fixture('complex-v1.pdf'), 'complex-v1.pdf');
    const table = tagged.blocks.find((b) => b.type === 'table');
    expect(table?.type === 'table' && table.rows[0]!.cells[1]!.blocks.some((b) => b.type === 'table')).toBe(true);
  });

  it('compares two PDFs and copies a PDF into a Word document', async () => {
    const a = await readPdf(fixture('contract-v1.pdf'), 'a.pdf');
    const b = await readPdf(fixture('contract-v2.pdf'), 'b.pdf');
    const cmp = compareDocs(a, b, O);
    expect(cmp.stats.added).toBeGreaterThan(0);
    expect(changed(cmp).some((r) => r.includes('eight pages'))).toBe(true);
    const target = docx('contract-v1.docx');
    const into = compareDocs(b, target, O);
    const merged = applySelection(into, 'l2r', selectAll(into), docxBackend).doc;
    const again = readDocx(exportDocx(merged), 'merged.docx');
    expect(inherent(changed(compareDocs(b, again, O)))).toEqual([]);
  });

  it('explains password-protected PDFs', async () => {
    await expect(readPdf(fixture('contract-v1-password.pdf'), 'locked.pdf')).rejects.toThrow(/password/);
  });
});
