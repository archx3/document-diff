import { describe, expect, it } from 'vitest';
import { compareDocs } from '../../src/core/compare';
import { applySelection, selectAll, selectRows } from '../../src/core/merge';
import { blockText } from '../../src/core/model';
import { modelBackend } from '../../src/core/model-backend';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { docToDelimited, docToPlainLines, parseDelimited, readDelimited, readPlainText, sniffDelimiter, textFormat } from '../../src/formats/text/plain';

const O = DEFAULT_OPTIONS;

describe('delimited text', () => {
  it('parses quoted fields, doubled quotes and line breaks inside fields', () => {
    expect(parseDelimited('a,"b,c","say ""hi""","two\nlines"\r\n1,2,3,4\n', ',')).toEqual([
      ['a', 'b,c', 'say "hi"', 'two\nlines'],
      ['1', '2', '3', '4'],
    ]);
    expect(parseDelimited('x;y\n;', ';')).toEqual([
      ['x', 'y'],
      ['', ''],
    ]);
  });

  it('detects the separator', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(sniffDelimiter('name;price;note\nTea;1,50;hot\nCake;2,00;sweet')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2')).toBe('\t');
  });

  it('reads one row per block and aligns changed rows', () => {
    const a = readDelimited('id,name,qty\n1,Apple,3\n2,Pear,5\n3,Plum,1\n', 'a.csv', 'csv');
    const b = readDelimited('id,name,qty\n1,Apple,3\n2,Pear,6\n4,Fig,2\n3,Plum,1\n', 'b.csv', 'csv');
    expect(a.blocks).toHaveLength(4);
    expect(a.blocks.every((x) => x.type === 'table' && x.fragment)).toBe(true);
    const cmp = compareDocs(a, b, O);
    const changed = cmp.rows.filter((r) => r.kind !== 'eq').map((r) => `${r.kind}:${r.l ? blockText(r.l) : ''}|${r.r ? blockText(r.r) : ''}`);
    expect(changed).toEqual(['table:2\tPear\t5|2\tPear\t6', 'ins:|4\tFig\t2']);
  });

  it('merges rows and writes the file back with its own separator and quoting', () => {
    const a = readDelimited('name;note\r\nTea;"hot; sweet"\r\n', 'a.csv', 'csv');
    const b = readDelimited('name;note\r\nTea;"hot; sweet"\r\nCake;"say ""yum"""\r\n', 'b.csv', 'csv');
    const cmp = compareDocs(a, b, O);
    const merged = applySelection(cmp, 'r2l', selectAll(cmp), modelBackend).doc;
    expect(docToDelimited(merged)).toBe('name;note\r\nTea;"hot; sweet"\r\nCake;"say ""yum"""\r\n');
  });

  it('reads tab-separated files', () => {
    const d = readDelimited('a\tb\n1\t2\n', 'x.tsv', 'tsv');
    expect(d.delimiter).toBe('\t');
    expect(d.formatLabel).toBe('TSV');
  });
});

describe('plain text family', () => {
  it('knows code, data and prose formats', () => {
    expect(textFormat('json')).toEqual({ label: 'JSON', mono: true });
    expect(textFormat('py')?.mono).toBe(true);
    expect(textFormat('txt')?.mono).toBe(false);
    expect(textFormat('docx')).toBeUndefined();
  });

  it('keeps line endings, strips the byte order mark and compares line by line', () => {
    const a = readPlainText('\ufeffline one\r\nline two\r\n', 'a.yaml', 'yaml');
    expect(a.eol).toBe('\r\n');
    expect(a.mono).toBe(true);
    expect(a.formatLabel).toBe('YAML');
    expect(a.blocks.map(blockText)).toEqual(['line one', 'line two']);
    const b = readPlainText('line one\nline 2\n', 'b.yaml', 'yaml');
    const cmp = compareDocs(a, b, O);
    const merged = applySelection(cmp, 'r2l', selectRows(cmp.rows), modelBackend).doc;
    expect(docToPlainLines(merged)).toBe('line one\r\nline 2\r\n');
  });

  it('spreads out minified JSON so changes line up', () => {
    const big = JSON.stringify({ items: Array.from({ length: 30 }, (_, i) => ({ id: i, name: `item ${i}` })) });
    const d = readPlainText(big, 'x.json', 'json');
    expect(d.blocks.length).toBeGreaterThan(30);
    expect(d.notes?.[0]).toMatch(/formatted/);
  });

  it('keeps indentation and blank lines', () => {
    const d = readPlainText('def f():\n    return 1\n\n\nx = f()\n', 'x.py', 'py');
    expect(d.blocks.map(blockText)).toEqual(['def f():', '    return 1', '', '', 'x = f()']);
    expect(docToPlainLines(d)).toBe('def f():\n    return 1\n\n\nx = f()\n');
  });
});
