import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compareDocs, inlineDiff } from '../../src/core/compare';
import type { Comparison } from '../../src/core/compare';
import { applySelection, selectAll, selectInline, selectTableRow } from '../../src/core/merge';
import type { MergeBackend } from '../../src/core/merge';
import type { Doc, ParaBlock } from '../../src/core/model';
import { blockText, para, textSpan } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { docxBackend } from '../../src/formats/docx/backend';
import { DocxPackage } from '../../src/formats/docx/package';
import { readDocx } from '../../src/formats/docx/read';
import { exportDocx } from '../../src/formats/docx/writer';
import { readHtml } from '../../src/formats/html/read';
import { odtBackend } from '../../src/formats/odt/backend';
import { OdtPackage } from '../../src/formats/odt/package';
import { readOdt } from '../../src/formats/odt/read';
import { exportOdt } from '../../src/formats/odt/writer';

const O = DEFAULT_OPTIONS;
const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const load = (name: string): Doc =>
  name.endsWith('.docx') ? readDocx(readFileSync(`tests/fixtures/${name}`), name) : readOdt(readFileSync(`tests/fixtures/${name}`), name);
const backendFor = (d: Doc): MergeBackend => (d.pkg instanceof OdtPackage ? odtBackend : d.pkg instanceof DocxPackage ? docxBackend : modelBackend);
const exportFor = (d: Doc) => (d.pkg instanceof DocxPackage ? exportDocx(d) : exportOdt(d));
const reread = (d: Doc, bytes: Uint8Array) => (d.pkg instanceof DocxPackage ? readDocx(bytes, 'x.docx') : readOdt(bytes, 'x.odt'));
const diffs = (cmp: Comparison) =>
  cmp.hunks.map((h) => cmp.rows.slice(h.start, h.end).map((r) => `${r.kind}: ${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`));

let soffice: boolean | undefined;
function hasSoffice(): boolean {
  if (soffice === undefined) {
    try {
      execFileSync('soffice', ['--version'], { stdio: 'pipe', timeout: 60000 });
      soffice = true;
    } catch {
      soffice = false;
    }
  }
  return soffice;
}

/** Text of a file as LibreOffice reads it, or null when LibreOffice is not installed. */
function libreOfficeText(bytes: Uint8Array, name: string): string | null {
  if (!hasSoffice()) return null;
  const path = `${OUT}/${name}`;
  writeFileSync(path, bytes);
  execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', OUT, path], { stdio: 'pipe', timeout: 120000 });
  return readFileSync(path.replace(/\.[^.]+$/, '.txt'), 'utf8');
}

/** Structural checks LibreOffice is strict about. */
function validateOdt(bytes: Uint8Array): void {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  expect(names[0]).toBe('mimetype');
  const dec = new TextDecoder();
  expect(dec.decode(files.mimetype)).toBe('application/vnd.oasis.opendocument.text');
  // The mimetype entry is stored, not compressed: its bytes appear right after the local header.
  expect(dec.decode(bytes.subarray(30, 38))).toBe('mimetype');
  expect(dec.decode(bytes.subarray(38, 38 + 39))).toBe('application/vnd.oasis.opendocument.text');
  const manifest = dec.decode(files['META-INF/manifest.xml']);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('.xml') || name.endsWith('.rdf')) {
      const doc = new DOMParser().parseFromString(dec.decode(data), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, `${name} is well-formed`).toBe(0);
    }
    if (name !== 'mimetype' && name !== 'META-INF/manifest.xml' && !name.endsWith('/')) expect(manifest, `manifest lists ${name}`).toContain(`"${name}"`);
  }
  const content = dec.decode(files['content.xml']);
  const styles = dec.decode(files['styles.xml']);
  // Every picture referenced exists.
  for (const m of content.matchAll(/xlink:href="(Pictures\/[^"]+)"/g)) expect(files[m[1]!], m[1]).toBeDefined();
  // Style references resolve.
  const defined = new Set([...`${content}${styles}`.matchAll(/style:name="([^"]+)"/g)].map((m) => m[1]));
  for (const m of content.matchAll(/<(?:text:(?:p|h|span|a|list)|table:table(?:-cell|-row|-column)?|draw:frame)\b[^>]*?\s(?:text|table|draw):style-name="([^"]+)"/g))
    expect(defined.has(m[1]), `style ${m[1]}`).toBe(true);
  // Unique names and ids.
  for (const re of [/table:table table:name="([^"]+)"/g, /text:note text:id="([^"]+)"/g, /xml:id="([^"]+)"/g, /<text:section [^>]*text:name="([^"]+)"/g]) {
    const all = [...content.matchAll(re)].map((m) => m[1]);
    expect(new Set(all).size, `unique ${re.source}`).toBe(all.length);
  }
  // Lists that continue another refer to an existing list.
  for (const m of content.matchAll(/text:continue-list="([^"]+)"/g)) expect(content).toContain(`xml:id="${m[1]}"`);
}

describe('OpenDocument reading', () => {
  it('reads the same content as the Word original', () => {
    for (const f of ['contract-v1', 'contract-v2']) {
      const cmp = compareDocs(load(`${f}.docx`), load(`${f}.odt`), O);
      expect(diffs(cmp)).toEqual([]);
    }
    const flat = compareDocs(load('contract-v1.docx'), load('contract-v1.fodt'), O);
    expect(diffs(flat)).toEqual([]);
  });

  it('reads notes, tracked changes, the table of contents and nested tables', () => {
    const d = load('complex-v1.odt');
    expect(d.notes?.join(' ')).toMatch(/Tracked changes/);
    expect(d.notes?.join(' ')).toMatch(/Comments/);
    const toc = d.blocks.find((b) => b.type === 'opaque');
    expect(toc && toc.type === 'opaque' && toc.label).toBe('Table of contents');
    const para = d.blocks.find((b) => blockText(b).startsWith('Work is billed')) as ParaBlock;
    expect(para.spans.some((s) => s.obj?.kind === 'footnote' && s.obj.note === 'Rates are reviewed each January.')).toBe(true);
    const tracked = d.blocks.find((b) => blockText(b).startsWith('Expenses')) as ParaBlock;
    expect(blockText(tracked)).toBe('Expenses are reimbursed monthly ');
    const table = d.blocks.find((b) => b.type === 'table');
    expect(table && table.type === 'table' && table.rows[0]!.cells[1]!.blocks.some((b) => b.type === 'table')).toBe(true);
    // Everything but the table of contents matches the Word original.
    const cmp = compareDocs(load('complex-v1.docx'), d, O);
    expect(cmp.rows.filter((r) => r.kind !== 'eq').map((r) => r.l?.type)).toEqual(['opaque']);
  });

  it('writes and reads repeated spaces, tabs and line breaks', () => {
    const lines = ['a  b\tc', '   leading and trailing  ', 'x\ny', ' ', 'tab\t \t end'];
    const doc: Doc = { id: 'ws', name: 'ws.txt', kind: 'text', version: 0, blocks: lines.map((t) => para([textSpan(t)])) };
    const d = readOdt(exportOdt(doc), 'ws.odt');
    expect(d.blocks.filter((b) => b.type === 'p').map(blockText)).toEqual(lines);
  });
});

describe('OpenDocument round trip', () => {
  it('re-exports unchanged documents that compare equal', () => {
    for (const f of ['contract-v1.odt', 'contract-v2.odt', 'complex-v1.odt', 'contract-v1.fodt']) {
      const d = load(f);
      const bytes = exportOdt(d);
      if (!f.endsWith('.fodt')) validateOdt(bytes);
      expect(diffs(compareDocs(d, readOdt(bytes, f), O))).toEqual([]);
    }
  });
});

describe('OpenDocument merging', () => {
  const pairs: Array<[string, string]> = [
    ['contract-v1.odt', 'contract-v2.odt'],
    ['complex-v1.odt', 'complex-v2.odt'],
    ['contract-v1.docx', 'contract-v2.odt'],
    ['contract-v1.odt', 'contract-v2.docx'],
    ['complex-v1.docx', 'complex-v2.odt'],
    ['contract-v1.fodt', 'contract-v2.odt'],
  ];
  for (const [la, lb] of pairs) {
    for (const dir of ['l2r', 'r2l'] as const) {
      it(`copies every change ${la} ${dir === 'l2r' ? '→' : '←'} ${lb} and produces a valid file`, () => {
        const a = load(la);
        const b = load(lb);
        const cmp = compareDocs(a, b, O);
        expect(cmp.hunks.length).toBeGreaterThan(0);
        const target = dir === 'l2r' ? b : a;
        const merged = applySelection(cmp, dir, selectAll(cmp), backendFor(target)).doc;
        const after = dir === 'l2r' ? compareDocs(a, merged, O) : compareDocs(merged, b, O);
        // Word writes page numbers in a table of contents as fields, OpenDocument as text.
        const crossFormat = la.endsWith('.docx') !== lb.endsWith('.docx');
        const relevant = (c: Comparison) => (crossFormat ? diffs(c).filter((h) => !h.every((r) => r.startsWith('mod: Contents'))) : diffs(c));
        expect(relevant(after)).toEqual([]);
        const bytes = exportFor(merged);
        if (target.pkg instanceof OdtPackage && !target.pkg.flat) validateOdt(bytes);
        const again = reread(target, bytes);
        const after2 = dir === 'l2r' ? compareDocs(a, again, O) : compareDocs(again, b, O);
        expect(relevant(after2)).toEqual([]);
        const ext = target.pkg instanceof DocxPackage ? 'docx' : target.pkg instanceof OdtPackage && target.pkg.flat ? 'fodt' : 'odt';
        const lo = libreOfficeText(bytes, `merged-${la.replace(/\.\w+$/, '')}-${dir}-${lb.replace(/\.\w+$/, '')}.${ext}`);
        if (lo !== null) expect(lo).toMatch(/Agreement/);
      });
    }
  }

  it('applies a word-level change inside an OpenDocument paragraph, keeping formatting', () => {
    const a = load('contract-v1.odt');
    const b = load('contract-v2.odt');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'mod' && r.l && blockText(r.l).startsWith('The Client will pay'))!;
    expect(inlineDiff(row.l!, row.r!, O).changes).toHaveLength(1);
    const res = applySelection(cmp, 'l2r', selectInline(row.key, 0), odtBackend);
    const p = res.doc.blocks.find((x) => blockText(x).startsWith('The Client will pay')) as ParaBlock;
    expect(blockText(p)).toBe('The Client will pay the fees below. Invoices are due within 30 days of receipt.');
    expect(p.spans.filter((s) => /30|days/.test(s.text)).every((s) => s.fmt.b)).toBe(true);
    const bytes = exportOdt(res.doc);
    validateOdt(bytes);
    const again = readOdt(bytes, 'x.odt');
    expect(blockText(again.blocks.find((x) => blockText(x).startsWith('The Client will pay'))!)).toBe(blockText(p));
  });

  it('applies every word-level change on its own', () => {
    const a = load('contract-v1.odt');
    const b = load('contract-v2.odt');
    const cmp = compareDocs(a, b, O);
    let n = 0;
    for (const row of cmp.rows) {
      if (row.kind !== 'mod' || row.l?.type !== 'p' || row.r?.type !== 'p') continue;
      const d = inlineDiff(row.l, row.r, O);
      for (let c = 0; c < d.changes.length; c++) {
        for (const dir of ['l2r', 'r2l'] as const) {
          const res = applySelection(cmp, dir, selectInline(row.key, c), odtBackend);
          const bytes = exportOdt(res.doc);
          const again = readOdt(bytes, 'x.odt');
          expect(diffs(compareDocs(res.doc, again, O))).toEqual([]);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(4);
  });

  it('copies an image and a hyperlink into the other document', () => {
    const a = load('contract-v1.odt');
    const b = load('contract-v2.odt');
    const cmp = compareDocs(a, b, O);
    const res = applySelection(cmp, 'r2l', selectAll(cmp), odtBackend);
    const img = res.doc.blocks.flatMap((x) => (x.type === 'p' ? x.spans : [])).find((s) => s.obj?.kind === 'image');
    expect(img?.obj?.data?.length).toBeGreaterThan(0);
    const files = unzipSync(exportOdt(res.doc));
    const content = new TextDecoder().decode(files['content.xml']);
    for (const m of content.matchAll(/xlink:href="(Pictures\/[^"]+)"/g)) expect(files[m[1]!]).toBeDefined();
    expect(content).toMatch(/xlink:href="https:\/\/example\.com/);
  });

  it('copies single table rows', () => {
    const a = load('contract-v1.odt');
    const b = load('contract-v2.odt');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'table')!;
    const sub = row.table!.rows.find((r) => r.kind !== 'eq')!;
    const res = applySelection(cmp, 'l2r', selectTableRow(row.key, sub.key), odtBackend);
    const t = res.doc.blocks.find((x) => x.type === 'table')!;
    expect(blockText(t)).toContain(blockText({ id: 'x', type: 'table', rows: [sub.l!] }));
    validateOdt(exportOdt(res.doc));
  });

  it('merges pasted HTML into an OpenDocument file', () => {
    const html = readHtml(
      '<h1>Services Agreement</h1><p>Intro with <b>bold</b>, <i>italic</i> and <a href="https://example.org">a link</a>.</p><ol><li>One</li><li>Two<ol><li>Two A</li></ol></li></ol><ul><li>Bullet</li></ul><table><tr><th>H1</th><th>H2</th></tr><tr><td colspan="2">Wide</td></tr></table>',
      'paste.html',
    );
    const b = load('contract-v1.odt');
    const cmp = compareDocs(html, b, O);
    const merged = applySelection(cmp, 'l2r', selectAll(cmp), odtBackend).doc;
    expect(diffs(compareDocs(html, merged, O))).toEqual([]);
    const bytes = exportOdt(merged);
    validateOdt(bytes);
    expect(diffs(compareDocs(html, readOdt(bytes, 'x.odt'), O))).toEqual([]);
    const lo = libreOfficeText(bytes, 'from-html.odt');
    if (lo !== null) expect(lo).toContain('Two A');
  });

  it('exports any document as a new OpenDocument file', () => {
    for (const d of [load('contract-v1.docx'), load('complex-v1.docx'), readHtml('<p>Just <b>one</b> line</p>', 'one.html')]) {
      const bytes = exportOdt(d);
      validateOdt(bytes);
      const again = readOdt(bytes, 'new.odt');
      const cmp = compareDocs(d, again, O);
      expect(cmp.rows.filter((r) => r.kind !== 'eq' && r.l?.type !== 'opaque').map((r) => `${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`)).toEqual([]);
      const lo = libreOfficeText(bytes, `new-${d.name.replace(/\.\w+$/, '')}.odt`);
      if (lo !== null) expect(lo.length).toBeGreaterThan(5);
    }
  });
});
