import type { Block, Doc, TableCell, TableRow } from '../../core/model';
import { blockText, newId } from '../../core/model';

/**
 * Plain-text formats: prose (.txt), data and markup (.json, .yaml, .tex …),
 * source code, and delimited tables (.csv, .tsv).
 */

interface TextFormat {
  label: string;
  mono: boolean;
}

const MONO = (label: string): TextFormat => ({ label, mono: true });

const FORMATS: Record<string, TextFormat> = {
  txt: { label: 'Text', mono: false },
  text: { label: 'Text', mono: false },
  json: MONO('JSON'),
  jsonc: MONO('JSON'),
  json5: MONO('JSON'),
  geojson: MONO('JSON'),
  ndjson: MONO('JSON'),
  xml: MONO('XML'),
  xsd: MONO('XML'),
  xsl: MONO('XML'),
  xslt: MONO('XML'),
  svg: MONO('SVG'),
  plist: MONO('XML'),
  yaml: MONO('YAML'),
  yml: MONO('YAML'),
  toml: MONO('TOML'),
  ini: MONO('Config'),
  cfg: MONO('Config'),
  conf: MONO('Config'),
  config: MONO('Config'),
  properties: MONO('Config'),
  env: MONO('Config'),
  log: MONO('Log'),
  tex: MONO('LaTeX'),
  latex: MONO('LaTeX'),
  sty: MONO('LaTeX'),
  cls: MONO('LaTeX'),
  bib: MONO('BibTeX'),
  rst: MONO('reStructuredText'),
  adoc: MONO('AsciiDoc'),
  asciidoc: MONO('AsciiDoc'),
  org: MONO('Org'),
  textile: MONO('Textile'),
  wiki: MONO('Wiki'),
  srt: MONO('Subtitles'),
  vtt: MONO('Subtitles'),
  sql: MONO('SQL'),
  diff: MONO('Diff'),
  patch: MONO('Diff'),
  sh: MONO('Shell'),
  bash: MONO('Shell'),
  zsh: MONO('Shell'),
  fish: MONO('Shell'),
  ps1: MONO('PowerShell'),
  bat: MONO('Batch'),
  cmd: MONO('Batch'),
  css: MONO('CSS'),
  scss: MONO('CSS'),
  sass: MONO('CSS'),
  less: MONO('CSS'),
};

const CODE_EXTENSIONS =
  'js mjs cjs jsx ts mts cts tsx vue svelte astro py pyi rb go rs java kt kts scala groovy gradle c h cc cpp cxx hh hpp hxx cs fs fsx vb swift m mm php pl pm r lua dart ex exs erl hrl clj cljs elm hs ml mli nim zig jl sol graphql gql proto tf hcl cmake mk makefile dockerfile gitignore gitattributes editorconfig';
for (const ext of CODE_EXTENSIONS.split(' ')) FORMATS[ext] ??= MONO('Code');

/** Plain-text format for a file extension, or undefined if it is not one. */
export function textFormat(ext: string): TextFormat | undefined {
  return FORMATS[ext.toLowerCase()];
}

export function isDelimited(ext: string): boolean {
  return ext === 'csv' || ext === 'tsv' || ext === 'tab';
}

function decodeText(text: string): { text: string; eol: '\n' | '\r\n' } {
  const t = text.replace(/^\ufeff/, '');
  const crlf = (t.match(/\r\n/g) ?? []).length;
  const lf = (t.match(/(?<!\r)\n/g) ?? []).length;
  return { text: t.replace(/\r\n?/g, '\n'), eol: crlf > lf ? '\r\n' : '\n' };
}

/** A text file as one paragraph per line. */
export function readPlainText(raw: string, name: string, ext = 'txt'): Doc {
  const { text, eol } = decodeText(raw);
  const fmt = textFormat(ext) ?? { label: 'Text', mono: false };
  let body = text;
  const notes: string[] = [];
  // Minified JSON is one enormous line; spread it out so changes line up.
  if ((ext === 'json' || ext === 'geojson') && !body.trim().includes('\n') && body.length > 400) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2) + '\n';
      notes.push('This JSON file was on a single line, so it is shown formatted. Exports use the formatted version.');
    } catch {
      /* not valid JSON: compare as is */
    }
  }
  const lines = body.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const blocks: Block[] = lines.map((line) => ({
    id: newId('p'),
    type: 'p',
    props: { role: 'p' },
    spans: line ? [{ text: line, fmt: {} }] : [],
  }));
  return {
    id: newId('d'),
    name,
    kind: 'text',
    blocks,
    version: 0,
    ext,
    formatLabel: fmt.label,
    mono: fmt.mono,
    eol,
    notes: notes.length ? notes : undefined,
  };
}

/* ------------------------------------------------------------------- CSV */

/** Parses delimited text (RFC 4180 quoting, quotes doubled inside quoted fields). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Guesses the separator of a .csv file: comma, semicolon (European spreadsheets) or tab. */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 20).filter(Boolean);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => parseDelimited(l, d)[0]?.length ?? 1);
    if (!counts.length) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (counts[0]! - 1) * (consistent ? 2 : 1);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function cell(text: string, header: boolean): TableCell {
  const lines = text.split(/\r?\n/);
  return {
    header: header || undefined,
    blocks: lines.map((l) => ({ id: newId('p'), type: 'p', props: { role: 'p' }, spans: l ? [{ text: l, fmt: {} }] : [] })),
  };
}

/** A CSV/TSV file: each row becomes its own block so rows line up and merge one by one. */
export function readDelimited(raw: string, name: string, ext: string): Doc {
  const { text, eol } = decodeText(raw);
  const delimiter = ext === 'tsv' || ext === 'tab' ? '\t' : sniffDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  const blocks: Block[] = rows.map((cells, i) => {
    const row: TableRow = { id: newId('r'), cells: cells.map((c) => cell(c, i === 0)), header: i === 0 || undefined };
    return { id: newId('t'), type: 'table', rows: [row], fragment: true };
  });
  const label = delimiter === '\t' ? 'TSV' : 'CSV';
  return { id: newId('d'), name, kind: 'csv', blocks, version: 0, ext, formatLabel: label, mono: true, eol, delimiter };
}

function quoteField(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) || value.includes(delimiter) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cellText(c: TableCell): string {
  return c.blocks.map(blockText).join('\n');
}

/** Delimited text for a document: table rows become records, other paragraphs single-field records. */
export function docToDelimited(doc: Doc, delimiter = doc.delimiter ?? ','): string {
  const eol = doc.eol ?? '\n';
  const lines: string[] = [];
  for (const b of doc.blocks) {
    if (b.type === 'table') {
      for (const r of b.rows) lines.push(r.cells.map((c) => (c.vmerge === 'continue' ? '' : quoteField(cellText(c), delimiter))).join(delimiter));
    } else if (b.type === 'p') {
      lines.push(quoteField(blockText(b), delimiter));
    } else if (b.type === 'opaque') {
      for (const x of b.blocks) lines.push(quoteField(blockText(x), delimiter));
    }
  }
  return lines.join(eol) + eol;
}

/** The exact lines of a line-based text document. */
export function docToPlainLines(doc: Doc): string {
  const eol = doc.eol ?? '\n';
  const lines: string[] = [];
  const walk = (blocks: readonly Block[]) => {
    for (const b of blocks) {
      if (b.type === 'p') lines.push(blockText(b));
      else if (b.type === 'table') for (const r of b.rows) lines.push(r.cells.map(cellText).join('\t'));
      else if (b.type === 'opaque') walk(b.blocks);
    }
  };
  walk(doc.blocks);
  return lines.join(eol) + (lines.length ? eol : '');
}
