import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import pdfmake from 'pdfmake';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import type { Block, ParaBlock } from '../../src/core/model';
import { blockText } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { exportDocx } from '../../src/formats/docx/writer';
import { renderPdf } from '../../src/formats/pdf/write';
import { readPlainText } from '../../src/formats/text/plain';
import { changeTarget } from '../../src/review/anchor';
import type { Mark } from '../../src/review/marks';
import { placeMarks } from '../../src/review/marks';
import { buildReport } from '../../src/ui/report';

const names = {
  reaction: { up: 'Looks right', down: 'Needs work', idea: 'Idea' },
  decision: { accepted: 'Accepted', rejected: 'Rejected' },
} as const;

const a = readPlainText('Payment is due in 30 days.\n\nThe term is one year.\n\nOld clause.\n\nSigned.\n', 'a.txt');
const b = readPlainText('Payment is due in 45 days.\n\nThe term is one year.\n\nNew clause here.\n\nSigned.\n', 'b.txt');
const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
const marks: Mark[] = [
  { id: 's1', kind: 'status', target: changeTarget(cmp, 0), status: 'accepted', created: 1 },
  { id: 'r1', kind: 'reaction', target: changeTarget(cmp, 1), reaction: 'down', created: 1 },
  { id: 'n1', kind: 'note', target: changeTarget(cmp, 1), text: 'Ask legal.', created: Date.UTC(2026, 8, 2) },
];
const texts = (blocks: Block[]) => blocks.map(blockText);

beforeAll(() => {
  const dir = 'node_modules/pdfmake/build/fonts/Roboto/';
  for (const f of ['Roboto-Regular.ttf', 'Roboto-Medium.ttf', 'Roboto-Italic.ttf', 'Roboto-MediumItalic.ttf']) pdfmake.virtualfs.writeFileSync(f, new Uint8Array(readFileSync(dir + f)));
  pdfmake.addFonts({ Roboto: { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' } });
});

describe('change report', () => {
  it('lists every change with its decision, reactions, notes and marked words', () => {
    const doc = buildReport(cmp, placeMarks(marks, cmp), names, { reviewer: 'Sam', date: new Date(Date.UTC(2026, 8, 3)) });
    const t = texts(doc.blocks);
    expect(t[0]).toBe('Comparison report');
    expect(t).toContain('a.txt  →  b.txt');
    expect(t.some((x) => x.includes('reviewed by Sam'))).toBe(true);
    expect(t).toContain('2 changes: 2 changed, 0 added and 0 removed paragraphs. 1 accepted, 0 rejected, 1 open.');
    expect(t).toContain('Change 1: Changed');
    expect(t).toContain('Accepted · Date or period');
    expect(t).toContain('Open · Needs work');
    expect(t).toContain('Ask legal.');
    // The words that changed, marked in each version.
    const a1 = doc.blocks.find((x): x is ParaBlock => x.type === 'p' && blockText(x).startsWith('A  Payment'))!;
    expect(a1.spans.filter((s) => s.fmt.rev === 'del').map((s) => s.text)).toEqual(['30']);
    const b1 = doc.blocks.find((x): x is ParaBlock => x.type === 'p' && blockText(x).startsWith('B  Payment'))!;
    expect(b1.spans.filter((s) => s.fmt.rev === 'ins').map((s) => s.text)).toEqual(['45']);
    // The table: a header and a row per change.
    const table = doc.blocks.find((x) => x.type === 'table');
    expect(table?.type === 'table' && table.rows.length).toBe(3);
  });

  it('can list only the open changes, or only those with notes, with the paragraphs around them', () => {
    const open = texts(buildReport(cmp, placeMarks(marks, cmp), names, { openOnly: true }).blocks);
    expect(open).not.toContain('Change 1: Changed');
    expect(open).toContain('Change 2: Changed');
    const noted = texts(buildReport(cmp, placeMarks(marks, cmp), names, { notedOnly: true, context: true }).blocks);
    expect(noted).toContain('Change 2: Changed');
    expect(noted).not.toContain('Change 1: Changed');
    expect(noted).toContain('…The term is one year.');
    expect(noted).toContain('Signed.…');
  });

  it('includes a summary of what matters, when there is one', () => {
    const t = texts(buildReport(cmp, [], names, { summary: ['Payment terms moved from 30 to 45 days.'] }).blocks);
    expect(t).toContain('What matters');
    expect(t).toContain('Payment terms moved from 30 to 45 days.');
  });

  it('saves as PDF and as Word', async () => {
    const doc = buildReport(cmp, placeMarks(marks, cmp), names);
    const pdf = await renderPdf(pdfmake, doc);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    const xml = new TextDecoder().decode(unzipSync(exportDocx(doc))['word/document.xml']!);
    expect(xml).toContain('Comparison report');
    expect(xml).toMatch(/<w:strike\/><w:color w:val="B3261E"\/>/);
    expect(xml).toContain('<w:tbl>');
  });
});
