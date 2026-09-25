/**
 * Format-neutral document model.
 *
 * Every loader (DOCX, pasted HTML, Markdown, plain text) produces a `Doc`.
 * The diff engine and the UI only look at this model. Format backends attach
 * their own data through the opaque `x` / `pkg` fields so they can write a
 * faithful copy of the original file back out.
 */

/** Inline formatting that the comparison understands. */
export interface Fmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Monospace. Shown, never compared (DOCX has no reliable notion of "code"). */
  code?: boolean;
  /** Hyperlink target. */
  href?: string;
  /** Highlight colour, shown only. */
  hl?: string;
}

export type ObjKind =
  | 'image'
  | 'footnote'
  | 'endnote'
  | 'field'
  | 'math'
  | 'pagebreak'
  | 'symbol'
  | 'textbox'
  | 'object';

export interface InlineObject {
  kind: ObjKind;
  /** Identity used for comparison (image hash, footnote text, field result …). */
  key: string;
  /** Human readable description, used for tooltips and accessibility. */
  label: string;
  /** Visible text rendered in place (field results, symbols, math). */
  text?: string;
  /** Image source (blob: or data: URL) and display size in CSS pixels. */
  src?: string;
  width?: number;
  height?: number;
  /** Raw image bytes and MIME type, when known (used to embed images in new files). */
  data?: Uint8Array;
  mime?: string;
  /** Footnote / endnote text. */
  note?: string;
}

/** A run of text (or a single inline object) with uniform formatting. */
export interface Span {
  /** Text content. Objects use one U+FFFC; markers use ''. */
  text: string;
  fmt: Fmt;
  obj?: InlineObject;
  /** Zero-width, non-content item (bookmark, comment anchor …) kept for round trips. */
  marker?: boolean;
  /** Format backend data. */
  x?: unknown;
}

export type Role = 'p' | 'h' | 'title' | 'subtitle' | 'quote' | 'code' | 'caption' | 'toc';

export interface ListInfo {
  ordered: boolean;
  /** 0-based nesting level. */
  level: number;
  /** Counter group: items with the same key continue one numbering sequence. */
  key?: string;
  /** Items whose overrideKey is seen for the first time restart their counters. */
  overrideKey?: string;
  /** Number format per level (decimal, lowerLetter, upperRoman, bullet …). */
  formats?: string[];
  /** Start value per level. */
  starts?: number[];
  /** Word style label template for this level, e.g. "%1.%2." or a bullet glyph. */
  template?: string;
}

export interface ParaProps {
  role: Role;
  /** Heading / TOC level, 1-based. */
  level?: number;
  list?: ListInfo;
  align?: 'center' | 'right' | 'justify';
  /** Style name as the author sees it, for display. */
  styleName?: string;
}

interface BlockBase {
  id: string;
  /** Format backend data. */
  x?: unknown;
}

export interface ParaBlock extends BlockBase {
  type: 'p';
  props: ParaProps;
  spans: Span[];
}

export interface TableCell {
  blocks: Block[];
  colspan?: number;
  /** DOCX vertical merge: 'continue' cells are covered by the cell above. */
  vmerge?: 'restart' | 'continue';
  rowspan?: number;
  header?: boolean;
  x?: unknown;
}

export interface TableRow {
  id: string;
  cells: TableCell[];
  header?: boolean;
  x?: unknown;
}

export interface TableBlock extends BlockBase {
  type: 'table';
  rows: TableRow[];
}

/** Content compared and copied as a unit (table of contents, embedded content). */
export interface OpaqueBlock extends BlockBase {
  type: 'opaque';
  label: string;
  blocks: Block[];
}

/** Zero-width body-level item (bookmark, comment anchor …). Never compared or shown. */
export interface MarkerBlock extends BlockBase {
  type: 'marker';
}

export type Block = ParaBlock | TableBlock | OpaqueBlock | MarkerBlock;

export type DocKind = 'docx' | 'html' | 'text' | 'markdown' | 'sample';

export interface Doc {
  id: string;
  name: string;
  kind: DocKind;
  blocks: Block[];
  /** Format backend package (the DOCX zip for .docx files). */
  pkg?: unknown;
  /** Things the reader should know about this file (tracked changes, unsupported parts …). */
  notes?: string[];
  /** Bumped on every edit. */
  version: number;
}

let idCounter = 0;
/** Unique, process-wide id. */
export function newId(prefix = 'b'): string {
  idCounter += 1;
  return prefix + idCounter.toString(36);
}

export const OBJ_CHAR = '\ufffc';

/** Fast non-cryptographic hash (FNV-1a) of bytes, used to recognise the same image across files. */
export function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ':' + bytes.length.toString(16);
}

export function isBlank(block: Block): boolean {
  if (block.type !== 'p') return false;
  for (const s of block.spans) {
    if (s.marker) continue;
    if (s.obj) return false;
    if (/[^\s\u00a0\u200b\u200c\u200d\ufeff\u00ad]/.test(s.text)) return false;
  }
  return true;
}

/** Plain text of a block; paragraphs inside tables and containers are joined with newlines. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'p':
      return block.spans
        .map((s) => (s.marker ? '' : s.obj ? (s.obj.text ?? '') : s.text))
        .join('');
    case 'table':
      return block.rows
        .map((r) => r.cells.map((c) => c.blocks.map(blockText).join('\n')).join('\t'))
        .join('\n');
    case 'opaque':
      return block.blocks.map(blockText).join('\n');
    case 'marker':
      return '';
  }
}

export function wordCount(doc: Doc): number {
  let n = 0;
  for (const b of doc.blocks) {
    const m = blockText(b).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
    if (m) n += m.length;
  }
  return n;
}

export function sameFmt(a: Fmt, b: Fmt): boolean {
  return (
    !!a.b === !!b.b &&
    !!a.i === !!b.i &&
    !!a.u === !!b.u &&
    !!a.s === !!b.s &&
    !!a.sup === !!b.sup &&
    !!a.sub === !!b.sub &&
    !!a.code === !!b.code &&
    (a.href ?? '') === (b.href ?? '') &&
    (a.hl ?? '') === (b.hl ?? '')
  );
}

/** Merge adjacent plain-text spans that share formatting (only for model-only spans). */
export function normalizeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (!s.marker && !s.obj && s.text === '') continue;
    const last = out[out.length - 1];
    if (
      last &&
      !last.obj &&
      !s.obj &&
      !last.marker &&
      !s.marker &&
      last.x === undefined &&
      s.x === undefined &&
      sameFmt(last.fmt, s.fmt)
    ) {
      out[out.length - 1] = { text: last.text + s.text, fmt: last.fmt };
    } else {
      out.push(s);
    }
  }
  return out;
}

export function para(spans: Span[], props: Partial<ParaProps> = {}): ParaBlock {
  return { id: newId('p'), type: 'p', props: { role: 'p', ...props }, spans };
}

export function textSpan(text: string, fmt: Fmt = {}): Span {
  return { text, fmt };
}

/** Human readable description of a paragraph style, e.g. "Heading 2" or "Numbered list". */
export function describeProps(p: ParaProps): string {
  let base: string;
  switch (p.role) {
    case 'h':
      base = `Heading ${p.level ?? 1}`;
      break;
    case 'title':
      base = 'Title';
      break;
    case 'subtitle':
      base = 'Subtitle';
      break;
    case 'quote':
      base = 'Quote';
      break;
    case 'code':
      base = 'Code';
      break;
    case 'caption':
      base = 'Caption';
      break;
    case 'toc':
      base = `Contents ${p.level ?? 1}`;
      break;
    default:
      base = 'Normal text';
  }
  if (p.list) {
    const kind = p.list.ordered ? 'Numbered list' : 'Bulleted list';
    const lvl = p.list.level > 0 ? `, level ${p.list.level + 1}` : '';
    base = p.role === 'p' ? kind + lvl : `${base}, ${kind.toLowerCase()}${lvl}`;
  }
  if (p.align) base += `, ${p.align === 'justify' ? 'justified' : p.align === 'center' ? 'centered' : 'right-aligned'}`;
  return base;
}
