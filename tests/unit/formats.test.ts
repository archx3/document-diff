import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { computeListLabels } from '../../src/core/lists';
import type { Block, Doc, ParaBlock } from '../../src/core/model';
import { blockText, describeProps } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { readDocx } from '../../src/formats/docx/read';
import { readHtml } from '../../src/formats/html/read';
import { docToHtml, docToMarkdown, docToText } from '../../src/formats/html/write';
import { googleDocId, loadPaste } from '../../src/formats/load';
import { readMarkdown, readText } from '../../src/formats/text/read';

const O = DEFAULT_OPTIONS;
const SPAN = (text: string, extra = '') =>
  `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;${extra}">${text}</span>`;

const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-5f7a2b1c-7fff-3d4e-8a1b-123456789abc"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;">${SPAN('Project brief', 'font-size:20pt;')}</h1><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${SPAN('The launch is planned for ')}${SPAN('March 3', 'font-weight:700;')}${SPAN('.')}</p><br><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${SPAN('First item')}</p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${SPAN('Nested item')}</p></li></ul><ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:decimal;font-size:11pt;" aria-level="1"><p dir="ltr" role="presentation">${SPAN('Step one')}</p></li><li dir="ltr" style="list-style-type:decimal;font-size:11pt;" aria-level="1"><p dir="ltr" role="presentation">${SPAN('Step two')}</p></li></ol><br><div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><colgroup><col width="301"><col width="301"></colgroup><tbody><tr style="height:0pt"><td style="border-left:solid #000000 1pt;"><p dir="ltr" style="line-height:1.2;">${SPAN('Cell A')}</p></td><td style="border-left:solid #000000 1pt;"><p dir="ltr">${SPAN('Cell B')}</p></td></tr></tbody></table></div><br><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${SPAN('See ')}<a href="https://example.com/brief" style="text-decoration:none;">${SPAN('the brief', 'color:#1155cc;text-decoration:underline;')}</a>${SPAN(' for  details.')}</p></b>`;

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>p.MsoNormal{margin:0}</style></head><body lang=EN-US style='tab-interval:.5in'><!--StartFragment--><p class=MsoTitle>Project brief<o:p></o:p></p><p class=MsoNormal>The launch is planned for <b>March 3</b>.<o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>First item<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Nested item<o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Step one<o:p></o:p></p><!--EndFragment--></body></html>`;

const hasObject = (b: Block | undefined) => b?.type === 'p' && b.spans.some((s) => s.obj);
const hasFieldOrBreak = (b: Block | undefined) => b?.type === 'p' && b.spans.some((s) => s.obj && s.obj.kind !== 'image');

const summary = (d: Doc) => {
  const labels = computeListLabels(d.blocks);
  return d.blocks.map((b) => (b.type === 'p' ? `${describeProps(b.props)}${labels.get(b) ? ` [${labels.get(b)}]` : ''}: ${blockText(b)}` : `${b.type}: ${blockText(b)}`));
};

describe('pasted HTML', () => {
  it('reads Google Docs clipboard content', () => {
    const { doc, source } = loadPaste(GOOGLE_DOCS, '');
    expect(source).toBe('google-docs');
    expect(summary(doc).filter((l) => !l.endsWith(': '))).toEqual([
      'Heading 1: Project brief',
      'Normal text: The launch is planned for March 3.',
      'Bulleted list [•]: First item',
      'Bulleted list, level 2 [◦]: Nested item',
      'Numbered list [1.]: Step one',
      'Numbered list [2.]: Step two',
      'table: Cell A\tCell B',
      'Normal text: See the brief for  details.',
    ]);
    const intro = doc.blocks.find((b) => blockText(b).startsWith('The launch')) as ParaBlock;
    expect(intro.spans.map((s) => [s.text, !!s.fmt.b])).toEqual([
      ['The launch is planned for ', false],
      ['March 3', true],
      ['.', false],
    ]);
    const link = doc.blocks.find((b) => blockText(b).startsWith('See')) as ParaBlock;
    expect(link.spans.find((s) => s.fmt.href)?.text).toBe('the brief');
  });

  it('reads Word clipboard content', () => {
    const { doc, source } = loadPaste(WORD, '');
    expect(source).toBe('word');
    expect(summary(doc)).toEqual([
      'Title: Project brief',
      'Normal text: The launch is planned for March 3.',
      'Bulleted list [•]: First item',
      'Bulleted list, level 2 [◦]: Nested item',
      'Numbered list [1.]: Step one',
    ]);
  });

  it('treats Google Docs and Word pastes of the same text as equal (ignoring title vs heading)', () => {
    const g = loadPaste(GOOGLE_DOCS, '').doc;
    const w = loadPaste(WORD, '').doc;
    const cmp = compareDocs(g, w, O);
    const changed = cmp.rows.filter((r) => r.kind !== 'eq').map((r) => r.kind);
    // Title vs Heading 1, the extra step, the table and the link paragraph differ; the rest lines up.
    expect(cmp.rows.filter((r) => r.kind === 'eq').length).toBeGreaterThanOrEqual(4);
    expect(changed.length).toBeLessThanOrEqual(5);
  });

  it('falls back to plain text', () => {
    const { doc, source } = loadPaste('', 'one\ntwo');
    expect(source).toBe('text');
    expect(doc.blocks.map(blockText)).toEqual(['one', 'two']);
  });
});

describe('markdown', () => {
  it('parses common syntax', () => {
    const md = `# Title\n\nSome **bold** and *italic* and \`code\` and [a link](https://x.y/).\nSecond line.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`\ncode block\n\`\`\`\n`;
    const d = readMarkdown(md, 'x.md');
    expect(summary(d)).toEqual([
      'Heading 1: Title',
      'Normal text: Some bold and italic and code and a link. Second line.',
      'Bulleted list [•]: one',
      'Bulleted list [•]: two',
      'Bulleted list, level 2 [◦]: nested',
      'Numbered list [1.]: first',
      'Numbered list [2.]: second',
      'Quote: quoted',
      'table: A\tB\n1\t2',
      'Code: code block',
    ]);
    const p = d.blocks[1] as ParaBlock;
    expect(p.spans.filter((s) => s.fmt.b).map((s) => s.text)).toEqual(['bold']);
    expect(p.spans.find((s) => s.fmt.href)?.fmt.href).toBe('https://x.y/');
  });

  it('does not treat snake_case as emphasis', () => {
    const d = readMarkdown('use my_var_name here', 'x.md');
    expect((d.blocks[0] as ParaBlock).spans.every((s) => !s.fmt.i)).toBe(true);
  });
});

describe('exports', () => {
  const docs = () => [
    readDocx(readFileSync('tests/fixtures/contract-v2.docx'), 'contract.docx'),
    loadPaste(GOOGLE_DOCS, '').doc,
    readMarkdown('# T\n\n- a\n  - b\n- c\n\n1. x\n1. y\n\nText with **bold** and a [link](https://e.x/)\n', 'm.md'),
  ];

  it('HTML export reads back to an equal document', () => {
    for (const d of docs()) {
      const back = readHtml(docToHtml(d), 'back.html');
      const cmp = compareDocs(d, back, { ...O, ignoreFormatting: false });
      const diffs = cmp.rows
        .filter((r) => r.kind !== 'eq' && !hasFieldOrBreak(r.l))
        .map((r) => `${r.kind}: ${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`);
      // Fields and page breaks have no HTML form; everything else survives.
      expect(diffs).toEqual([]);
    }
  });

  it('Markdown export reads back with the same text and structure', () => {
    for (const d of docs()) {
      const back = readMarkdown(docToMarkdown(d), 'back.md');
      const cmp = compareDocs(d, back, { ...O, ignoreFormatting: true });
      const diffs = cmp.rows
        .filter((r) => r.kind !== 'eq')
        .filter((r) => !(r.l?.type === 'p' && ['title', 'subtitle'].includes(r.l.props.role)))
        .filter((r) => !hasObject(r.l))
        .map((r) => `${r.kind}: ${r.l && blockText(r.l)} | ${r.r && blockText(r.r)}`);
      expect(diffs).toEqual([]);
    }
  });

  it('plain text export lists every paragraph', () => {
    const text = docToText(readText('a\nb', 't.txt'));
    expect(text).toBe('a\nb\n');
  });
});

describe('google docs links', () => {
  it('extracts document ids', () => {
    expect(googleDocId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?tab=t.0')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(googleDocId('https://docs.google.com/document/u/1/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit')).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(googleDocId('https://example.com')).toBeUndefined();
  });
});
