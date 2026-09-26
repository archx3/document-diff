import { mkdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import type { Comparison } from '../../src/core/compare';
import { computeListLabels } from '../../src/core/lists';
import { applySelection, selectAll } from '../../src/core/merge';
import type { Doc, ParaBlock } from '../../src/core/model';
import { blockText } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDocx } from '../../src/formats/docx/read';
import { readHtml } from '../../src/formats/html/read';
import { readRtf, tokenize } from '../../src/formats/rtf/read';
import { docToRtf, rtfEscape } from '../../src/formats/rtf/write';
import { libreOfficeText as convert } from '../soffice';

const O = DEFAULT_OPTIONS;
const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const enc = new TextEncoder();
const rtf = (s: string, name = 'test.rtf') => readRtf(enc.encode(s), name);
const docx = (name: string) => readDocx(readFileSync(`tests/fixtures/${name}`), name);
const diffs = (cmp: Comparison) =>
  cmp.hunks.map((h) => cmp.rows.slice(h.start, h.end).map((r) => `${r.kind}: ${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`));
const texts = (d: Doc) => d.blocks.filter((b) => b.type !== 'marker').map(blockText);

function libreOfficeText(bytes: Uint8Array, name: string): string | null {
  return convert(bytes, OUT, name);
}

describe('RTF reading', () => {
  it('tokenizes control words, symbols, hex escapes and binary data', () => {
    const kinds = [...tokenize(enc.encode("{\\rtf1\\b1 x\\'e9\\~\\bin3 abc}"))].map((t) => t.t);
    expect(kinds).toEqual(['open', 'word', 'word', 'text', 'hex', 'sym', 'bin', 'close']);
  });

  it('reads formatting, code pages, Unicode and special characters', () => {
    const d = rtf(
      "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times;}{\\f1 Courier New;}}\\pard Plain \\b bold\\b0  \\i it\\i0  \\ul u\\ulnone  \\strike s\\strike0  \\super 2\\nosupersub  \\f1 mono\\f0  caf\\'e9 \\u8364? \\emdash \\tab x\\line y\\par}",
    );
    const p = d.blocks[0] as ParaBlock;
    expect(blockText(p)).toBe('Plain bold it u s 2 mono café € —\tx\ny');
    const fmt = (t: string) => p.spans.find((s) => s.text.includes(t))!.fmt;
    expect(fmt('bold').b).toBe(true);
    expect(fmt('it').i).toBe(true);
    expect(fmt('u').u).toBe(true);
    expect(fmt('s').s).toBe(true);
    expect(fmt('2').sup).toBe(true);
    expect(fmt('mono').code).toBe(true);
    expect(fmt('Plain').b).toBeFalsy();
  });

  it('reads styles, lists, links, footnotes and tables', () => {
    const d = rtf(
      '{\\rtf1{\\stylesheet{\\s0 Normal;}{\\s1\\b heading 1;}}' +
        '{\\*\\listtable{\\list\\listtemplateid1{\\listlevel\\levelnfc0\\levelstartat1{\\leveltext\\\'02\\\'00.;}{\\levelnumbers\\\'01;}}\\listid10}}' +
        '{\\*\\listoverridetable{\\listoverride\\listid10\\ls1}}' +
        '\\pard\\s1\\b Title\\b0\\par' +
        '\\pard\\ls1\\ilvl0 {\\listtext 1.\\tab}First\\par' +
        '\\pard\\ls1\\ilvl0 {\\listtext 2.\\tab}Second\\par' +
        '\\pard See {\\field{\\*\\fldinst HYPERLINK "https://example.com"}{\\fldrslt link}}.{\\super\\chftn{\\footnote\\pard\\plain\\chftn  A note.}}\\par' +
        '\\trowd\\cellx2000\\cellx4000\\pard\\intbl A\\cell B\\cell\\row' +
        '}',
    );
    const [h, l1, l2, link, table] = d.blocks.filter((b) => b.type !== 'marker');
    expect(h!.type === 'p' && h.props.role).toBe('h');
    expect(h!.type === 'p' && h.spans.every((s) => !s.fmt.b)).toBe(true);
    const labels = computeListLabels(d.blocks);
    expect([labels.get(l1 as ParaBlock), labels.get(l2 as ParaBlock)]).toEqual(['1.', '2.']);
    expect(blockText(l1!)).toBe('First');
    const lp = link as ParaBlock;
    expect(lp.spans.find((s) => s.text === 'link')?.fmt.href).toBe('https://example.com');
    expect(lp.spans.find((s) => s.obj?.kind === 'footnote')?.obj?.note).toBe('A note.');
    expect(table!.type).toBe('table');
    expect(blockText(table!)).toBe('A\tB');
  });

  it('reads nested tables and merged cells', () => {
    const d = rtf(
      '{\\rtf1\\trowd\\clmgf\\cellx2000\\clmrg\\cellx4000\\cellx6000\\pard\\intbl Wide\\cell\\cell' +
        '\\pard\\intbl\\itap2 In\\nestcell{\\*\\nesttableprops\\trowd\\cellx1000\\nestrow}{\\nonesttables\\par}\\cell\\row}',
    );
    const t = d.blocks.find((b) => b.type === 'table')!;
    expect(t.type === 'table' && t.rows[0]!.cells[0]!.colspan).toBe(2);
    expect(t.type === 'table' && t.rows[0]!.cells[1]!.blocks.some((b) => b.type === 'table')).toBe(true);
  });

  it('skips tracked deletions and hidden destinations', () => {
    const d = rtf('{\\rtf1{\\*\\generator Test;}{\\info{\\title T}}\\pard Keep {\\deleted gone }this\\par}');
    expect(texts(d)).toEqual(['Keep this']);
  });

  it('reads LibreOffice RTF like the Word original', () => {
    for (const f of ['contract-v1', 'contract-v2']) {
      const cmp = compareDocs(docx(`${f}.docx`), readRtf(readFileSync(`tests/fixtures/${f}.rtf`), `${f}.rtf`), O);
      expect(diffs(cmp)).toEqual([]);
    }
    // Word's table of contents is a content control; LibreOffice writes plain paragraphs.
    const cmp = compareDocs(docx('complex-v1.docx'), readRtf(readFileSync('tests/fixtures/complex-v1.rtf'), 'complex-v1.rtf'), O);
    expect(cmp.rows.filter((r) => r.kind !== 'eq').every((r) => r.l?.type === 'opaque' || /Contents|Parties\t|Rates\t|Signatures\t/.test(r.r ? blockText(r.r) : ''))).toBe(true);
  });
});

describe('RTF writing', () => {
  it('escapes special characters', () => {
    expect(rtfEscape('a{b}\\c é €')).toBe('a\\{b\\}\\\\c \\u233? \\u8364?');
  });

  it('writes Word documents that read back the same', () => {
    for (const f of ['contract-v1.docx', 'contract-v2.docx', 'complex-v1.docx']) {
      const d = docx(f);
      const back = rtf(docToRtf(d));
      expect(diffs(compareDocs(d, back, O))).toEqual([]);
    }
  });

  it('writes merged documents LibreOffice can open', () => {
    const a = readRtf(readFileSync('tests/fixtures/contract-v1.rtf'), 'contract-v1.rtf');
    const b = readRtf(readFileSync('tests/fixtures/contract-v2.rtf'), 'contract-v2.rtf');
    const cmp = compareDocs(a, b, O);
    const merged = applySelection(cmp, 'l2r', selectAll(cmp), modelBackend).doc;
    const out = docToRtf(merged);
    expect(diffs(compareDocs(a, rtf(out), O))).toEqual([]);
    const lo = libreOfficeText(enc.encode(out), 'merged-contract.rtf');
    if (lo !== null) {
      expect(lo).toContain('up to six pages');
      expect(lo).toContain('Discovery workshop');
    }
  });

  it('writes pasted HTML with lists, links and tables', () => {
    const d = readHtml('<h2>Plan</h2><ol><li>One</li><li>Two<ul><li>Sub</li></ul></li></ol><p>A <a href="https://example.org">link</a></p><table><tr><td>1</td><td>2</td></tr></table>', 'x.html');
    const back = rtf(docToRtf(d));
    expect(diffs(compareDocs(d, back, O))).toEqual([]);
    const labels = computeListLabels(back.blocks);
    expect(back.blocks.filter((b) => b.type === 'p' && b.props.list).map((b) => labels.get(b as ParaBlock))).toEqual(['1.', '2.', '•']);
  });
});
