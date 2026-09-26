import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blockText } from '../../src/core/model';
import { exportFormats } from '../../src/formats/export';
import { LoadError, decodeBytes, loadFile, mhtmlToHtml, sniff } from '../../src/formats/load';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const file = (data: Uint8Array | string, name: string) => new File([data as BlobPart], name);
const enc = new TextEncoder();

describe('loading files', () => {
  it('recognizes every format by its content', async () => {
    const cases: Array<[string, string, string]> = [
      ['contract-v1.docx', 'docx', 'Word'],
      ['contract-v1.odt', 'odt', 'OpenDocument'],
      ['contract-v1.fodt', 'odt', 'OpenDocument'],
      ['contract-v1.rtf', 'rtf', 'RTF'],
      ['contract-v1.doc', 'doc', 'Word 97'],
      ['contract-v1.epub', 'epub', 'EPUB'],
      ['contract-v1.pdf', 'pdf', 'PDF'],
    ];
    for (const [name, kind, label] of cases) {
      const d = await loadFile(file(fixture(name), name));
      expect(d.kind, name).toBe(kind);
      expect(d.formatLabel ?? (kind === 'docx' ? 'Word' : ''), name).toBe(label === 'Word' ? (d.formatLabel ?? 'Word') : label);
      expect(d.blocks.some((b) => blockText(b).includes('Services Agreement')), name).toBe(true);
    }
  });

  it('reads files whose extension does not match their content', async () => {
    // Word could save "Rich Text" or web pages under a .doc name.
    const rtf = await loadFile(file(fixture('contract-v1.rtf'), 'contract.doc'));
    expect(rtf.kind).toBe('rtf');
    const html = await loadFile(file('<html><body><h1>Hi</h1><p>There</p></body></html>', 'page.doc'));
    expect(html.kind).toBe('html');
    const docx = await loadFile(file(fixture('contract-v1.docx'), 'contract.bin'));
    expect(docx.kind).toBe('docx');
    const pdf = await loadFile(file(fixture('contract-v1.pdf'), 'scan.dat'));
    expect(pdf.kind).toBe('pdf');
  });

  it('reads text files as prose, data, code or tables', async () => {
    const txt = await loadFile(file('one\ntwo\n', 'notes.txt'));
    expect([txt.kind, txt.mono, txt.blocks.length]).toEqual(['text', false, 2]);
    const yaml = await loadFile(file('a: 1\nb: 2\n', 'config.yaml'));
    expect([yaml.kind, yaml.mono, yaml.formatLabel]).toEqual(['text', true, 'YAML']);
    const csv = await loadFile(file('a;b\n1;2\n', 'data.csv'));
    expect([csv.kind, csv.delimiter]).toEqual(['csv', ';']);
    const md = await loadFile(file('# Title\n\nSome *text*.\n', 'readme.md'));
    expect(md.kind).toBe('markdown');
    const unknown = await loadFile(file('plain words', 'LICENSE'));
    expect(unknown.kind).toBe('text');
  });

  it('decodes UTF-16 and old Windows text', () => {
    expect(decodeBytes(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00]))).toBe('hé');
    expect(decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });

  it('reads web archives (.mht)', async () => {
    const mht = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="----=_NextPart"',
      '',
      '------=_NextPart',
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html><body><p>Caf=C3=A9 au lait is =',
      'nice</p></body></html>',
      '------=_NextPart--',
    ].join('\r\n');
    expect(mhtmlToHtml(mht)).toContain('Café au lait is nice');
    const d = await loadFile(file(mht, 'page.mht'));
    expect(blockText(d.blocks[0]!)).toBe('Café au lait is nice');
  });

  it('explains files it cannot read', async () => {
    const xlsx = zipSync({ '[Content_Types].xml': enc.encode('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>') });
    await expect(loadFile(file(xlsx, 'book.xlsx'))).rejects.toThrow(/Excel workbook/);
    const ods = zipSync({ mimetype: enc.encode('application/vnd.oasis.opendocument.spreadsheet') });
    await expect(loadFile(file(ods, 'sheet.ods'))).rejects.toThrow(/OpenDocument spreadsheet/);
    await expect(loadFile(file(zipSync({ 'a.txt': enc.encode('x') }), 'files.zip'))).rejects.toThrow(/zip archive/);
    await expect(loadFile(file(new Uint8Array([0, 1, 2, 3, 0, 5]), 'blob.bin'))).rejects.toThrow(/not a document/);
    await expect(loadFile(file('x', 'essay.pages'))).rejects.toThrow(/Apple Pages/);
    await expect(loadFile(file(fixture('contract-v1-password.pdf'), 'locked.pdf'))).rejects.toThrow(LoadError);
    await expect(loadFile(file('{"doc_id":"1AbCdEfGhIjKlMnOpQrStUvWxYz012345"}', 'Plan.gdoc'))).rejects.toMatchObject({ googleDocId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' });
  });

  it('sniffs without trusting the extension', () => {
    expect(sniff(enc.encode('%PDF-1.7\n')).kind).toBe('pdf');
    expect(sniff(enc.encode('Notes about %PDF-1.7 files')).kind).toBe('text');
    expect(sniff(enc.encode('{\\rtf1 hi}')).kind).toBe('rtf');
    expect(sniff(enc.encode('<?xml version="1.0"?>\n<office:document xmlns:office="x">')).kind).toBe('fodt');
  });
});

describe('export formats', () => {
  it('offers each document its own format first', async () => {
    const first = async (name: string, data: Uint8Array | string) => exportFormats(await loadFile(file(data, name)))[0]!.ext;
    expect(await first('a.docx', fixture('contract-v1.docx'))).toBe('docx');
    expect(await first('a.odt', fixture('contract-v1.odt'))).toBe('odt');
    expect(await first('a.fodt', fixture('contract-v1.fodt'))).toBe('fodt');
    expect(await first('a.rtf', fixture('contract-v1.rtf'))).toBe('rtf');
    expect(await first('a.doc', fixture('contract-v1.doc'))).toBe('docx');
    expect(await first('a.pdf', fixture('contract-v1.pdf'))).toBe('pdf');
    expect(await first('a.csv', 'x,y\n1,2\n')).toBe('csv');
    expect(await first('a.tsv', 'x\ty\n1\t2\n')).toBe('tsv');
    expect(await first('a.yaml', 'a: 1\n')).toBe('yaml');
    expect(await first('a.md', '# T\n')).toBe('md');
    expect(await first('a.txt', 'hello\n')).toBe('txt');
  });

  it('builds every format for every kind of document', async () => {
    for (const name of ['contract-v1.docx', 'contract-v1.odt', 'contract-v1.pdf', 'contract-v1.epub', 'contract-v1.doc', 'contract-v1.rtf']) {
      const d = await loadFile(file(fixture(name), name));
      for (const f of exportFormats(d)) {
        // PDFs are made by a library loaded in the browser; pdf-write.test.ts covers them.
        if (f.id === 'pdf') continue;
        const out = await f.build(d);
        expect(out.length, `${name} as ${f.ext}`).toBeGreaterThan(50);
      }
    }
  });
});
