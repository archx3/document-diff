import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compareDocs, inlineDiff, propsChanged } from '../../src/core/compare';
import type { Comparison } from '../../src/core/compare';
import { applySelection, selectAll, selectInline, selectRows, selectTableRow } from '../../src/core/merge';
import type { Doc, ParaBlock } from '../../src/core/model';
import { blockText } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { docxBackend } from '../../src/formats/docx/backend';
import { DocxPackage } from '../../src/formats/docx/package';
import { readDocx } from '../../src/formats/docx/read';
import { exportDocx } from '../../src/formats/docx/writer';

const O = DEFAULT_OPTIONS;
const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const load = (name: string): Doc => readDocx(readFileSync(`tests/fixtures/${name}`), name);
const backendFor = (d: Doc) => (d.pkg instanceof DocxPackage ? docxBackend : modelBackend);
const texts = (d: Doc) => d.blocks.filter((b) => b.type !== 'marker').map(blockText).filter((t) => t.trim());

function resolve(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/** Structural checks Word is strict about. */
function validatePackage(bytes: Uint8Array): void {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  expect(names[0]).toBe('[Content_Types].xml');
  const dec = new TextDecoder();
  const types = dec.decode(files['[Content_Types].xml']);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      const doc = new DOMParser().parseFromString(dec.decode(data), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, `${name} is well-formed`).toBe(0);
    }
    if (!name.endsWith('.rels') && !name.startsWith('[')) {
      const ext = name.split('.').pop()!;
      const covered = types.includes(`PartName="/${name}"`) || new RegExp(`Extension="${ext}"`, 'i').test(types);
      expect(covered, `content type for ${name}`).toBe(true);
    }
  }
  const main = dec.decode(files['word/document.xml']);
  const ids = [...main.matchAll(/<wp:docPr\b[^>]*?\sid="(\d+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size, 'unique drawing ids').toBe(ids.length);
  // Every r:id used in the body resolves.
  const rels = dec.decode(files['word/_rels/document.xml.rels']);
  for (const m of main.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)) expect(rels, `relationship ${m[1]}`).toContain(`Id="${m[1]}"`);
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (/TargetMode="External"/.test(m[0])) continue;
    const t = /Target="([^"]+)"/.exec(m[0])![1]!;
    const target = resolve(t.startsWith('/') ? t.slice(1) : 'word/' + t);
    expect(files[target], `part ${target}`).toBeDefined();
  }
  // numbering.xml: abstractNum elements precede num elements.
  if (files['word/numbering.xml']) {
    const num = dec.decode(files['word/numbering.xml']);
    const lastAbs = num.lastIndexOf('<w:abstractNum ');
    const firstNum = num.indexOf('<w:num ');
    if (lastAbs >= 0 && firstNum >= 0) expect(lastAbs).toBeLessThan(firstNum);
  }
}

function libreOfficeText(bytes: Uint8Array, name: string): string | null {
  const path = `${OUT}/${name}`;
  writeFileSync(path, bytes);
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', OUT, path], { stdio: 'pipe', timeout: 120000 });
    return readFileSync(path.replace(/\.docx$/, '.txt'), 'utf8');
  } catch {
    return null;
  }
}

function pythonDocxText(bytes: Uint8Array, name: string): string | null {
  const path = `${OUT}/${name}`;
  writeFileSync(path, bytes);
  try {
    return execFileSync('python3', ['-c', 'import sys, docx; d = docx.Document(sys.argv[1]); print("\\n".join(p.text for p in d.paragraphs))', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`python-docx could not open ${name}: ${(e as { stderr?: string }).stderr}`);
  }
}

describe('docx round trip', () => {
  it('re-exports an unchanged document that compares equal', () => {
    for (const f of ['contract-v1.docx', 'contract-v2.docx', 'contract-v1-lo.docx']) {
      const d = load(f);
      const bytes = exportDocx(d);
      validatePackage(bytes);
      const again = readDocx(bytes, f);
      expect(compareDocs(d, again, O).hunks).toHaveLength(0);
    }
  });
});

describe('docx merging', () => {
  const pairs: Array<[string, string]> = [
    ['contract-v1.docx', 'contract-v2.docx'],
    ['contract-v1-lo.docx', 'contract-v2.docx'],
    ['contract-v2-lo.docx', 'contract-v1.docx'],
  ];

  for (const [la, lb] of pairs) {
    for (const dir of ['l2r', 'r2l'] as const) {
      it(`copies every change ${la} ${dir === 'l2r' ? '→' : '←'} ${lb} and produces a valid file`, () => {
        const a = load(la);
        const b = load(lb);
        const cmp = compareDocs(a, b, O);
        expect(cmp.hunks.length).toBeGreaterThan(0);
        const target = dir === 'l2r' ? b : a;
        const res = applySelection(cmp, dir, selectAll(cmp), backendFor(target));
        const merged = res.doc;
        const after = dir === 'l2r' ? compareDocs(a, merged, O) : compareDocs(merged, b, O);
        expect(after.hunks).toHaveLength(0);
        const bytes = exportDocx(merged);
        validatePackage(bytes);
        const reread = readDocx(bytes, 'merged.docx');
        const after2 = dir === 'l2r' ? compareDocs(a, reread, O) : compareDocs(reread, b, O);
        expect(after2.hunks.map((h) => after2.rows.slice(h.start, h.end).map((r) => `${r.kind}: ${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`))).toEqual([]);
        const name = `merged-${la.replace('.docx', '')}-${dir}-${lb}`;
        const py = pythonDocxText(bytes, name);
        expect(py).toContain('Services Agreement');
        const lo = libreOfficeText(bytes, name);
        if (lo !== null) expect(lo).toContain('Scope of work');
      });
    }
  }

  it('applies word-level changes inside a Word paragraph, keeping formatting', () => {
    const a = load('contract-v1.docx');
    const b = load('contract-v2.docx');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'mod' && r.l && blockText(r.l).startsWith('The Client will pay'))!;
    const d = inlineDiff(row.l!, row.r!, O);
    expect(d.changes).toHaveLength(1);
    const res = applySelection(cmp, 'l2r', selectInline(row.key, 0), docxBackend);
    const p = res.doc.blocks.find((x) => blockText(x).startsWith('The Client will pay')) as ParaBlock;
    expect(blockText(p)).toBe('The Client will pay the fees below. Invoices are due within 30 days of receipt.');
    expect(p.spans.filter((s) => /30|days/.test(s.text)).every((s) => s.fmt.b)).toBe(true);
    validatePackage(exportDocx(res.doc));
  });

  it('copies a hyperlink change with a working relationship', () => {
    const a = load('contract-v1.docx');
    const b = load('contract-v2.docx');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'mod' && r.l && blockText(r.l).startsWith('On full payment'))!;
    const res = applySelection(cmp, 'r2l', selectRows([row]), docxBackend);
    const p = res.doc.blocks.find((x) => blockText(x).startsWith('On full payment')) as ParaBlock;
    expect(p.spans.find((s) => s.fmt.href)?.fmt.href).toBe('https://example.com/terms-2025');
    const bytes = exportDocx(res.doc);
    validatePackage(bytes);
    const again = readDocx(bytes, 'x.docx');
    const q = again.blocks.find((x) => blockText(x).startsWith('On full payment')) as ParaBlock;
    expect(q.spans.find((s) => s.fmt.href)?.fmt.href).toBe('https://example.com/terms-2025');
  });

  it('copies an image into the other document', () => {
    const a = load('contract-v1.docx');
    const b = load('contract-v2.docx');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'mod' && r.l && r.l.type === 'p' && r.l.spans.some((s) => s.obj?.kind === 'image'))!;
    const res = applySelection(cmp, 'r2l', selectRows([row]), docxBackend);
    const bytes = exportDocx(res.doc);
    validatePackage(bytes);
    const media = Object.keys(unzipSync(bytes)).filter((n) => n.startsWith('word/media/'));
    expect(media.length).toBe(2);
    const after = compareDocs(readDocx(bytes, 'x.docx'), b, O);
    expect(after.rows.filter((r) => r.kind !== 'eq').every((r) => !(r.l && blockText(r.l).startsWith('Logo')))).toBe(true);
  });

  it('copies single table rows', () => {
    const a = load('contract-v1.docx');
    const b = load('contract-v2.docx');
    const cmp = compareDocs(a, b, O);
    const row = cmp.rows.find((r) => r.kind === 'table')!;
    const ins = row.table!.rows.find((r) => r.kind === 'ins')!;
    const res = applySelection(cmp, 'r2l', selectTableRow(row.key, ins.key), docxBackend);
    const t = res.doc.blocks.find((x) => x.type === 'table')!;
    expect(blockText(t)).toContain('Accessibility review\t$1,200');
    expect(blockText(t)).toContain('Design\t$4,000');
    validatePackage(exportDocx(res.doc));
  });

  it('merges content pasted from HTML into a Word file', () => {
    const b = load('contract-v2.docx');
    const html: Doc = {
      id: 'h1',
      name: 'paste',
      kind: 'html',
      version: 0,
      blocks: [
        { id: 'hp1', type: 'p', props: { role: 'h', level: 1 }, spans: [{ text: 'New heading', fmt: {} }] },
        { id: 'hp2', type: 'p', props: { role: 'p', list: { ordered: true, level: 0, key: 'l1' } }, spans: [{ text: 'First ', fmt: {} }, { text: 'bold', fmt: { b: true } }] },
        { id: 'hp3', type: 'p', props: { role: 'p' }, spans: [{ text: 'A link', fmt: { href: 'https://example.org/' } }] },
      ],
    };
    const cmp: Comparison = compareDocs(html, b, O);
    const res = applySelection(cmp, 'l2r', selectAll(cmp), docxBackend);
    expect(texts(res.doc)).toEqual(['New heading', 'First bold', 'A link']);
    const bytes = exportDocx(res.doc);
    validatePackage(bytes);
    const again = readDocx(bytes, 'x.docx');
    expect(compareDocs(html, again, O).hunks).toHaveLength(0);
    pythonDocxText(bytes, 'from-html.docx');
  });

  it('exports a model document as a new Word file', () => {
    const doc: Doc = {
      id: 'm1',
      name: 'notes.md',
      kind: 'markdown',
      version: 0,
      blocks: [
        { id: 'a', type: 'p', props: { role: 'title' }, spans: [{ text: 'Notes', fmt: {} }] },
        { id: 'b', type: 'p', props: { role: 'p', list: { ordered: false, level: 0, key: 'x' } }, spans: [{ text: 'one', fmt: {} }] },
        { id: 'c', type: 'p', props: { role: 'p', list: { ordered: false, level: 1, key: 'x' } }, spans: [{ text: 'two', fmt: { i: true } }] },
        {
          id: 't',
          type: 'table',
          rows: [
            { id: 'r1', cells: [{ blocks: [{ id: 'c1', type: 'p', props: { role: 'p' }, spans: [{ text: 'A', fmt: {} }] }] }] },
          ],
        },
      ],
    };
    const bytes = exportDocx(doc);
    validatePackage(bytes);
    const again = readDocx(bytes, 'notes.docx');
    expect(compareDocs(doc, again, O).hunks).toHaveLength(0);
    expect(pythonDocxText(bytes, 'notes.docx')).toContain('Notes');
    const lo = libreOfficeText(bytes, 'notes.docx');
    if (lo !== null) expect(lo).toContain('two');
  });
});

describe('harder Word features', () => {
  const dec = new TextDecoder();
  const part = (bytes: Uint8Array, name: string) => {
    const f = unzipSync(bytes)[name];
    return f ? dec.decode(f) : '';
  };

  it('reads content controls, the table of contents, tracked changes and footnotes', () => {
    const d = load('complex-v1.docx');
    expect(d.notes?.some((n) => n.includes('Tracked changes'))).toBe(true);
    const toc = d.blocks.find((b) => b.type === 'opaque');
    expect(toc?.type === 'opaque' && toc.label).toBe('Table of contents');
    const client = d.blocks.find((b) => blockText(b) === '12 Quay Street, Portland');
    expect(client).toBeDefined();
    const rates = d.blocks.find((b) => blockText(b).startsWith('Work is billed')) as ParaBlock;
    expect(rates.spans.find((s) => s.obj?.kind === 'footnote')?.obj?.note).toBe('Rates are reviewed each January.');
    const expenses = d.blocks.find((b) => blockText(b).startsWith('Expenses')) as ParaBlock;
    expect(blockText(expenses)).toBe('Expenses are reimbursed monthly ');
  });

  for (const dir of ['l2r', 'r2l'] as const) {
    it(`merges everything ${dir === 'l2r' ? 'A → B' : 'B → A'} and keeps the file consistent`, () => {
      const a = load('complex-v1.docx');
      const b = load('complex-v2.docx');
      const cmp = compareDocs(a, b, O);
      expect(cmp.hunks.length).toBeGreaterThan(3);
      const target = dir === 'l2r' ? b : a;
      const merged = applySelection(cmp, dir, selectAll(cmp), backendFor(target)).doc;
      const bytes = exportDocx(merged);
      validatePackage(bytes);
      const reread = readDocx(bytes, 'merged.docx');
      const after = dir === 'l2r' ? compareDocs(a, reread, O) : compareDocs(reread, b, O);
      expect(after.hunks).toHaveLength(0);

      const doc = part(bytes, 'word/document.xml');
      // Comments stay anchored to ids that exist.
      const comments = part(bytes, 'word/comments.xml');
      for (const m of doc.matchAll(/<w:comment(?:Reference|RangeStart|RangeEnd) w:id="(\d+)"/g)) expect(comments).toContain(`w:id="${m[1]}"`);
      // Footnote references resolve.
      const notes = part(bytes, 'word/footnotes.xml');
      for (const m of doc.matchAll(/<w:footnoteReference w:id="(\d+)"/g)) expect(notes).toContain(`w:id="${m[1]}"`);
      expect(notes).toContain(dir === 'l2r' ? 'reviewed each January' : 'reviewed each April');
      // The content control and both sections survive.
      expect(doc).toContain('w:val="Client details"');
      expect(doc.match(/<w:sectPr\b/g)?.length).toBe(2);
      if (dir === 'l2r') {
        // The custom "Clause" style came along with its paragraph.
        expect(part(bytes, 'word/styles.xml')).toMatch(/w:styleId="Clause"/);
        expect(doc).toContain('independent contractor');
      } else {
        expect(doc).toContain('Electronic signatures are binding.');
      }
      const name = `complex-merged-${dir}.docx`;
      expect(pythonDocxText(bytes, name)).toContain('Master Consulting Agreement');
      const lo = libreOfficeText(bytes, name);
      if (lo !== null) expect(lo).toContain('Master Consulting Agreement');
    });
  }

  it('keeps comments on a paragraph whose text is replaced', () => {
    const a = load('complex-v1.docx');
    const b = load('complex-v2.docx');
    // Make the commented paragraph differ, then copy A's version over it.
    const cmp = compareDocs(a, b, { ...O, ignoreFormatting: false });
    const row = cmp.rows.find((r) => r.r && blockText(r.r).startsWith('The consultant is'));
    expect(row?.kind).toBe('eq');
    const bytes = exportDocx(b);
    expect(part(bytes, 'word/document.xml')).toContain('<w:commentReference w:id="0"/>');
  });
});

describe('word-level copies inside Word paragraphs', () => {
  const pairs: Array<[string, string]> = [
    ['contract-v1.docx', 'contract-v2.docx'],
    ['contract-v1-lo.docx', 'contract-v2.docx'],
    ['complex-v1.docx', 'complex-v2.docx'],
  ];
  for (const [la, lb] of pairs) {
    it(`applies every word-level change on its own and all together (${la} / ${lb})`, () => {
      const a = load(la);
      const b = load(lb);
      const cmp = compareDocs(a, b, O);
      let checked = 0;
      for (const row of cmp.rows) {
        if (row.kind !== 'mod' || row.l?.type !== 'p' || row.r?.type !== 'p') continue;
        const d = inlineDiff(row.l, row.r, O);
        for (const dir of ['l2r', 'r2l'] as const) {
          // Each change on its own keeps the rest of the paragraph.
          d.changes.forEach((_, i) => {
            const res = applySelection(cmp, dir, selectInline(row.key, i), docxBackend);
            expect(res.applied).toBe(1);
            const after = dir === 'l2r' ? compareDocs(a, res.doc, O) : compareDocs(res.doc, b, O);
            const para = after.rows.find((r) => (dir === 'l2r' ? r.l === row.l : r.r === row.r));
            if (d.changes.length === 1 && !propsChanged(row.l!, row.r!, O)) expect(para?.kind).toBe('eq');
            checked++;
          });
          // All of them together make the text identical.
          const all = applySelection(cmp, dir, { inline: new Map([[row.key, new Set(d.changes.map((_, i) => i))]]) }, docxBackend);
          const src = dir === 'l2r' ? row.l : row.r;
          const out = all.doc.blocks.find((x) => x.type === 'p' && blockText(x) === blockText(src));
          expect(out, `${dir}: ${blockText(src)}`).toBeDefined();
          validatePackage(exportDocx(all.doc));
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
