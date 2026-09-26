import type { PDFPageProxy } from 'pdfjs-dist';
import type { StructTreeNode, TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Block, Doc, Fmt, ListInfo, ParaBlock, ParaProps, Span, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, blockText, newId, normalizeSpans, roleFromName } from '../../core/model';

/**
 * PDF reading. A PDF stores positioned text, not paragraphs, so the document
 * is rebuilt: from the structure tags when the PDF has them (Word, LibreOffice
 * and most modern exporters write them), otherwise from the page layout
 * (lines, spacing, font sizes, list markers, repeated headers and footers).
 */

type PdfJs = typeof import('pdfjs-dist');

let lib: Promise<PdfJs> | null = null;

/** Loads pdf.js on first use; it runs on the page's own thread (no worker file to host). */
function loadPdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.mjs')]);
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return pdfjs as unknown as PdfJs;
  })();
  lib.catch(() => {
    lib = null;
  });
  return lib;
}

export class PdfPasswordError extends Error {}

/* ------------------------------------------------------------------ items */

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  eol: boolean;
  href?: string;
  mcid?: string;
  tag?: string;
  artifact: boolean;
  /** A figure (picture) stands here; the value is its description. */
  figure?: string;
}

interface Page {
  n: number;
  width: number;
  height: number;
  items: Item[];
  tree: StructTreeNode | null;
}

interface Link {
  url: string;
  r: number[];
}

/** Page geometry shared by the readers. */
interface Geo {
  base: number;
  left: number;
  right: number;
  heights: Map<number, number>;
}

/** Geometry kept with each paragraph while the document is built. */
interface PdfBlockX {
  items: Item[];
  page?: number;
  /** A footnote body: its label and text. */
  note?: { label: string; text: string };
}

function blockPdf(b: Block | undefined): PdfBlockX | undefined {
  const x = b?.x as PdfBlockX | undefined;
  return x && Array.isArray(x.items) ? x : undefined;
}

/** Index in `s` near `i` where a word starts or ends, so link boundaries fall between words. */
function snap(s: string, i: number): number {
  for (let d = 0; d <= 2; d++) {
    for (const k of [i - d, i + d]) {
      if (k <= 0 || k >= s.length) continue;
      if ((s[k - 1] === ' ') !== (s[k] === ' ')) return k;
    }
  }
  return Math.max(0, Math.min(s.length, i));
}

/** Splits a text run where a link starts or ends inside it (link areas are rectangles on the page). */
function withLinks(it: Item, links: Link[]): Item[] {
  const top = it.y + it.size * 0.8;
  const bottom = it.y - it.size * 0.2;
  const hits = links.filter((l) => Math.min(top, l.r[3]!) - Math.max(bottom, l.r[1]!) > it.size * 0.3 && l.r[0]! < it.x + it.w - 0.5 && l.r[2]! > it.x + 0.5);
  if (!hits.length) return [it];
  const n = it.str.length;
  if (n < 2 || !it.w) return [{ ...it, href: hits[0]!.url }];
  const marks: Array<{ at: number; href?: string }> = [];
  const at = (x: number) => snap(it.str, Math.round(((x - it.x) / it.w) * n));
  const hrefs: Array<string | undefined> = new Array(n).fill(undefined);
  for (const l of hits) {
    const a = l.r[0]! <= it.x + 0.5 ? 0 : at(l.r[0]!);
    const b = l.r[2]! >= it.x + it.w - 0.5 ? n : at(l.r[2]!);
    for (let i = a; i < b; i++) hrefs[i] = l.url;
  }
  for (let i = 0; i < n; i++) if (i === 0 || hrefs[i] !== hrefs[i - 1]) marks.push({ at: i, href: hrefs[i] });
  return marks.map((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1]!.at : n;
    return { ...it, str: it.str.slice(m.at, end), x: it.x + (it.w * m.at) / n, w: (it.w * (end - m.at)) / n, href: m.href, eol: end === n ? it.eol : false };
  });
}

interface MarkedContent {
  type: string;
  id?: string;
  tag?: string;
}

export async function readPage(page: PDFPageProxy, n: number): Promise<Page> {
  const vp = page.getViewport({ scale: 1 });
  const [tc, tree, annots] = await Promise.all([
    page.getTextContent({ includeMarkedContent: true }),
    page.getStructTree().catch(() => null),
    page.getAnnotations().catch(() => []),
  ]);
  // Real font names (bold, italic, monospace) are known once the page's drawing operators are loaded.
  await page.getOperatorList().catch(() => undefined);
  const fonts = new Map<string, { bold: boolean; italic: boolean; mono: boolean }>();
  const fontOf = (id: string) => {
    let f = fonts.get(id);
    if (f) return f;
    let name = '';
    try {
      name = (page.commonObjs.get(id) as { name?: string } | undefined)?.name ?? '';
    } catch {
      /* not loaded */
    }
    const family = tc.styles[id]?.fontFamily ?? '';
    f = {
      bold: /bold|black|heavy|semibold|demibold|[-,]bd\b/i.test(name),
      italic: /italic|oblique|[-,]it\b/i.test(name),
      mono: /mono|courier|consolas|menlo|inconsolata|code/i.test(name) || family === 'monospace',
    };
    fonts.set(id, f);
    return f;
  };
  const links: Link[] = (annots as Array<{ subtype?: string; url?: string; rect?: number[] }>)
    .filter((a) => a.subtype === 'Link' && a.url && a.rect)
    .map((a) => ({ url: a.url!, r: a.rect! }));
  const items: Item[] = [];
  const stack: Array<{ id?: string; tag?: string; artifact: boolean }> = [];
  for (const raw of tc.items) {
    if (!('str' in raw)) {
      const mc = raw as MarkedContent;
      if (mc.type === 'endMarkedContent') stack.pop();
      else stack.push({ id: mc.id || undefined, tag: mc.tag, artifact: mc.tag === 'Artifact' || !!stack[stack.length - 1]?.artifact });
      continue;
    }
    const it = raw as TextItem;
    const t = it.transform as number[];
    const size = Math.hypot(t[2]!, t[3]!) || Math.hypot(t[0]!, t[1]!) || it.height || 10;
    let mcid: string | undefined;
    let tag: string | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.id) {
        mcid = stack[i]!.id;
        tag = stack[i]!.tag;
        break;
      }
    }
    const item: Item = {
      str: it.str,
      x: t[4]!,
      y: t[5]!,
      w: it.width,
      size,
      ...fontOf(it.fontName),
      eol: it.hasEOL,
      mcid,
      tag,
      artifact: !!stack[stack.length - 1]?.artifact,
    };
    items.push(...(it.str ? withLinks(item, links) : [item]));
  }
  return { n, width: vp.width, height: vp.height, items, tree: tree as StructTreeNode | null };
}

/* ------------------------------------------------------ paragraph text */

const BULLET_CHARS = '•●◦○▪■□‣⁃∙·–—-*•◦▪●⁃∙\uf0b7\uf0a7\uf0d8\uf076\uf0fc\uf0a8\uf06f';
const BULLET_CLASS = `[${BULLET_CHARS.replace(/[-\]\\]/g, '\\$&')}]`;
const BULLET_ONLY = new RegExp(`^${BULLET_CLASS}$`);
const BULLET_GLUED = new RegExp(`^(${BULLET_CLASS})\\s+\\S`);
const NUMBER_LABEL = /^\(?([0-9]{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,7})[.)]$/;
const SENTENCE_END = /[.!?:;]["”’)]?$/;

function sameFmt(a: Fmt, b: Fmt): boolean {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.code === !!b.code && !!a.sup === !!b.sup && !!a.sub === !!b.sub && (a.href ?? '') === (b.href ?? '');
}

/** Spans for text items that make up one paragraph, with spaces restored between lines and runs. */
function spansFrom(items: Item[], base: number): Span[] {
  const spans: Span[] = [];
  let text = '';
  let fmt: Fmt = {};
  /** Last item on the paragraph's baseline, and last item of any kind. */
  let line: Item | null = null;
  let last: Item | null = null;
  let pendingBreak = false;
  const flush = () => {
    if (text) spans.push({ text, fmt });
    text = '';
  };
  const tail = () => text || spans[spans.length - 1]?.text || '';
  for (const it of items) {
    if (it.figure !== undefined) {
      if (tail() && !/\s$/.test(tail())) text += ' ';
      flush();
      spans.push({ text: OBJ_CHAR, fmt: {}, obj: { kind: 'image', key: `img:pdf:${it.figure}`, label: it.figure || 'Picture' } });
      last = null;
      continue;
    }
    if (!it.str) {
      if (it.eol && (text || spans.length)) pendingBreak = true;
      continue;
    }
    let str = it.str;
    const small = it.size < base * 0.85;
    const newLine = pendingBreak || (line !== null && !small && Math.abs(it.y - line.y) > Math.max(line.size, it.size) * 0.6);
    if (newLine) {
      const prevText = tail();
      if (/\p{L}-$/u.test(prevText) && /^\p{Ll}/u.test(str)) {
        // A word hyphenated at the end of the line.
        if (text) text = text.slice(0, -1);
        else if (spans.length) spans[spans.length - 1]!.text = spans[spans.length - 1]!.text.slice(0, -1);
      } else if (prevText && !/\s$/.test(prevText)) {
        str = ' ' + str.replace(/^\s+/, '');
      } else {
        str = str.replace(/^\s+/, '');
      }
    } else if (last && it.x - (last.x + last.w) > it.size * 0.25 && !/\s$/.test(tail()) && !/^\s/.test(str)) {
      str = ' ' + str;
    }
    pendingBreak = false;
    const f: Fmt = {};
    if (it.bold) f.b = true;
    if (it.italic) f.i = true;
    if (it.mono) f.code = true;
    if (it.href) f.href = it.href;
    if (small && line && Math.abs(it.y - line.y) < base * 0.6) {
      if (it.y > line.y + base * 0.15) f.sup = true;
      else if (it.y < line.y - base * 0.1) f.sub = true;
    }
    if (text && !sameFmt(f, fmt)) flush();
    if (!text) fmt = f;
    text += str;
    if (it.eol) pendingBreak = true;
    if (!f.sup && !f.sub) line = it;
    last = it;
  }
  flush();
  while (spans.length && !spans[0]!.obj && !spans[0]!.text.trim()) spans.shift();
  while (spans.length && !spans[spans.length - 1]!.obj && !spans[spans.length - 1]!.text.trim()) spans.pop();
  if (spans.length && !spans[0]!.obj) spans[0]!.text = spans[0]!.text.replace(/^\s+/, '');
  if (spans.length && !spans[spans.length - 1]!.obj) spans[spans.length - 1]!.text = spans[spans.length - 1]!.text.replace(/\s+$/, '');
  return normalizeSpans(spans.map((s) => (s.obj ? s : { ...s, text: s.text.replace(/ {2,}/g, ' ') })));
}

/** Lines of a paragraph's items (by baseline), for alignment checks. */
function itemLines(items: Item[], base: number): Array<{ x0: number; x1: number }> {
  const lines: Array<{ y: number; x0: number; x1: number }> = [];
  for (const it of items) {
    if (!it.str.trim() || it.size < base * 0.85) continue;
    const l = lines.find((x) => Math.abs(x.y - it.y) < it.size * 0.5);
    if (l) {
      l.x0 = Math.min(l.x0, it.x);
      l.x1 = Math.max(l.x1, it.x + it.w);
    } else lines.push({ y: it.y, x0: it.x, x1: it.x + it.w });
  }
  return lines;
}

function alignment(items: Item[], geo: Geo): ParaProps['align'] {
  const lines = itemLines(items, geo.base);
  if (!lines.length) return undefined;
  const width = geo.right - geo.left;
  const mid = (geo.left + geo.right) / 2;
  if (lines.every((l) => l.x1 - l.x0 < width * 0.85 && Math.abs((l.x0 + l.x1) / 2 - mid) < 3) && lines.some((l) => l.x0 > geo.left + 6)) return 'center';
  if (lines.every((l) => Math.abs(l.x1 - geo.right) < 3 && l.x0 > geo.left + width * 0.3)) return 'right';
  return undefined;
}

/** Whether the paragraph's last line runs to the right margin (so the text may continue on the next page). */
function endsFull(items: Item[], geo: Geo): boolean {
  const lines = itemLines(items, geo.base);
  const lastLine = lines[lines.length - 1];
  return !!lastLine && lastLine.x1 > geo.right - geo.base * 3;
}

function para(items: Item[], props: ParaProps, geo: Geo, page?: number, detectAlign = true): ParaBlock {
  let spans = spansFrom(items, geo.base);
  // Bold headings and italic quotes usually come from the style: compare them like Word's styled headings.
  const textSpans = spans.filter((s) => !s.obj && s.text.trim());
  if (textSpans.length && ['h', 'title', 'subtitle', 'toc'].includes(props.role) && textSpans.every((s) => s.fmt.b)) spans = spans.map((s) => ({ ...s, fmt: { ...s.fmt, b: undefined } }));
  if (textSpans.length && ['quote', 'caption'].includes(props.role) && textSpans.every((s) => s.fmt.i)) spans = spans.map((s) => ({ ...s, fmt: { ...s.fmt, i: undefined } }));
  if (props.role === 'toc') spans = tocTab(spans);
  if (detectAlign && !props.list && !props.align) {
    const align = alignment(items, geo);
    if (align) props = { ...props, align };
  }
  return { id: newId('p'), type: 'p', props, spans: normalizeSpans(spans), x: { items, page } satisfies PdfBlockX };
}

/** A table-of-contents entry: a tab before its page number, as in Word. */
function tocTab(spans: Span[]): Span[] {
  const last = spans[spans.length - 1];
  if (!last || last.obj) return spans;
  const m = /^(.*\S)[\s.·…]+(\d+|[ivxlc]+)$/i.exec(last.text);
  if (m) return [...spans.slice(0, -1), { ...last, text: `${m[1]}\t${m[2]}` }];
  if (spans.length > 1 && /^\s*(\d+|[ivxlc]+)$/i.test(last.text)) {
    const prev = spans[spans.length - 2]!;
    return [...spans.slice(0, -2), { ...prev, text: prev.text.replace(/[\s.·…]+$/, '') }, { ...last, text: '\t' + last.text.trim() }];
  }
  return spans;
}

function dominantSize(items: Item[]): number {
  const counts = new Map<number, number>();
  for (const it of items) {
    const k = Math.round(it.size * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + it.str.trim().length);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best || 11;
}

function labelInfo(label: string): { ordered: boolean; format: string; start?: number; template: string } {
  const l = label.trim();
  const m = NUMBER_LABEL.exec(l);
  if (!m) return { ordered: false, format: 'bullet', template: l };
  const v = m[1]!;
  const template = l.replace(v, '%1');
  if (/^\d+$/.test(v)) return { ordered: true, format: 'decimal', start: parseInt(v, 10), template };
  if (/^[ivxlcdm]{2,}$|^i$/.test(v)) return { ordered: true, format: 'lowerRoman', template };
  if (/^[IVXLCDM]{2,}$|^I$/.test(v)) return { ordered: true, format: 'upperRoman', template };
  if (/^[a-z]$/.test(v)) return { ordered: true, format: 'lowerLetter', start: v.charCodeAt(0) - 96, template };
  return { ordered: true, format: 'upperLetter', start: v.charCodeAt(0) - 64, template };
}

function listInfo(label: string, level: number, key: string): ListInfo {
  const info = labelInfo(label);
  const formats: string[] = [];
  const starts: number[] = [];
  formats[level] = info.format;
  if (info.start !== undefined) starts[level] = info.start;
  return { ordered: info.ordered, level, key, formats, starts, template: info.template };
}

/* ----------------------------------------------------------- tagged PDFs */

const HEADINGS: Record<string, number> = { H: 1, H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const PARAGRAPHS = new Set(['P', 'Normal', 'Title', 'Subtitle', 'Caption', 'BlockQuote', 'Code', 'TOCI', 'Formula', 'Lbl', 'Aside']);
const INLINE = new Set(['Span', 'Link', 'Reference', 'Annot', 'Form', 'Ruby', 'RB', 'RT', 'RP', 'Warichu', 'WT', 'WP', 'Em', 'Strong', 'Sub', 'BibEntry', 'Quote']);

function isNode(c: unknown): c is StructTreeNode {
  return !!c && typeof c === 'object' && 'role' in (c as object);
}

class TaggedReader {
  readonly blocks: Block[] = [];
  private byId = new Map<string, Item[]>();
  private listLevel = -1;
  private page = 0;
  /** Inside a table cell, where alignment against the page margins means nothing. */
  private inCell = 0;

  constructor(private readonly geo: Geo) {}

  read(p: Page): void {
    this.byId = new Map();
    this.page = p.n;
    for (const it of p.items) {
      if (!it.mcid || it.artifact) continue;
      let list = this.byId.get(it.mcid);
      if (!list) this.byId.set(it.mcid, (list = []));
      list.push(it);
    }
    if (p.tree) this.walk(p.tree, this.blocks);
  }

  /** Text items of a structure element, in reading order (figures become placeholders). */
  private collect(node: StructTreeNode, out: Item[] = []): Item[] {
    for (const c of node.children) {
      if (isNode(c)) {
        if (c.role === 'Artifact') continue;
        if (c.role === 'Figure') {
          const alt = (c as { alt?: string }).alt ?? '';
          out.push({ str: '', x: 0, y: 0, w: 0, size: 0, bold: false, italic: false, mono: false, eol: false, artifact: false, figure: alt });
          continue;
        }
        this.collect(c, out);
      } else if (c.type === 'content') {
        out.push(...(this.byId.get(c.id) ?? []));
      }
    }
    return out;
  }

  private props(node: StructTreeNode, items: Item[]): ParaProps {
    const level = HEADINGS[node.role];
    if (level) return { role: 'h', level };
    if (node.role === 'TOCI') return { role: 'toc', level: 1 };
    if (node.role === 'Caption') return { role: 'caption' };
    if (node.role === 'BlockQuote') return { role: 'quote' };
    if (node.role === 'Code') return { role: 'code' };
    // Custom role names (often the style name, like "Title" or "Quotations") refine plain paragraphs.
    const hint = roleFromName(items.find((i) => i.tag)?.tag ?? '') ?? roleFromName(node.role);
    if (hint && hint.role !== 'h') return { role: hint.role, level: hint.level };
    return { role: 'p' };
  }

  private paragraph(node: StructTreeNode, out: Block[], list?: ListInfo, role?: ParaProps): void {
    const items = this.collect(node);
    if (!items.some((i) => i.str.trim() || i.figure !== undefined)) return;
    let props = role ?? this.props(node, items);
    if (list) props = { ...props, list };
    out.push(para(items, props, this.geo, this.page, !this.inCell));
  }

  private walk(node: StructTreeNode, out: Block[]): void {
    let loose: Item[] = [];
    const flushLoose = () => {
      if (loose.some((i) => i.str.trim())) out.push(para(loose, { role: 'p' }, this.geo, this.page, !this.inCell));
      loose = [];
    };
    for (const c of node.children) {
      if (!isNode(c)) {
        if (c.type === 'content') loose.push(...(this.byId.get(c.id) ?? []));
        continue;
      }
      if (c.role === 'Artifact') continue;
      if (INLINE.has(c.role) && !c.children.some((k: unknown) => isNode(k) && (PARAGRAPHS.has(k.role) || !!HEADINGS[k.role]))) {
        loose.push(...this.collect(c));
        continue;
      }
      flushLoose();
      if (HEADINGS[c.role] || PARAGRAPHS.has(c.role)) this.paragraph(c, out);
      else if (c.role === 'L') this.list(c, out);
      else if (c.role === 'Table') {
        const t = this.table(c);
        if (t) out.push(t);
      } else if (c.role === 'TOC') this.toc(c, out);
      else if (c.role === 'Note' || c.role === 'FENote') this.note(c, out);
      else if (c.role === 'Figure') this.paragraph({ role: 'P', children: [c] } as StructTreeNode, out);
      else this.walk(c, out);
    }
    flushLoose();
  }

  private list(node: StructTreeNode, out: Block[]): void {
    this.listLevel++;
    const level = Math.max(0, Math.min(8, this.listLevel));
    const key = newId('L');
    for (const li of node.children) {
      if (!isNode(li)) continue;
      if (li.role === 'L') {
        this.list(li, out);
        continue;
      }
      const kids: StructTreeNode[] = li.children.filter(isNode);
      const lbl = kids.find((k) => k.role === 'Lbl');
      const label = lbl ? this.collect(lbl).map((i) => i.str).join('').trim() : '';
      const body = kids.find((k) => k.role === 'LBody');
      const info = listInfo(label || '•', level, key);
      let first = true;
      const holder: StructTreeNode = body ?? ({ role: 'LBody', children: li.children.filter((k: unknown) => !(isNode(k) && k.role === 'Lbl')) } as StructTreeNode);
      const inline = holder.children.filter((k: unknown) => !isNode(k) || INLINE.has((k as StructTreeNode).role));
      if (inline.length) {
        const items = this.collect({ role: 'P', children: inline } as StructTreeNode);
        if (items.some((i) => i.str.trim())) {
          out.push(para(items, { role: 'p', list: info }, this.geo, this.page));
          first = false;
        }
      }
      for (const k of holder.children) {
        if (!isNode(k) || INLINE.has(k.role)) continue;
        if (k.role === 'L') {
          this.list(k, out);
          first = false;
          continue;
        }
        const before = out.length;
        if (HEADINGS[k.role] || PARAGRAPHS.has(k.role)) this.paragraph(k, out, first ? info : undefined);
        else this.walk(k, out);
        if (out.length > before) first = false;
      }
    }
    this.listLevel--;
  }

  private table(node: StructTreeNode): Block | null {
    const rows: TableRow[] = [];
    const addRow = (tr: StructTreeNode, header: boolean) => {
      const cells: TableCell[] = [];
      for (const td of tr.children) {
        if (!isNode(td) || (td.role !== 'TD' && td.role !== 'TH')) continue;
        const blocks: Block[] = [];
        const saved = this.listLevel;
        this.listLevel = -1;
        this.inCell++;
        this.walk(td, blocks);
        this.inCell--;
        this.listLevel = saved;
        const cell: TableCell = { blocks };
        if ((td.colSpan ?? 1) > 1) cell.colspan = td.colSpan;
        if ((td.rowSpan ?? 1) > 1) cell.rowspan = td.rowSpan;
        if (td.role === 'TH' || header) cell.header = true;
        cells.push(cell);
      }
      if (cells.length) rows.push({ id: newId('r'), cells, header: header || cells.every((c) => c.header) || undefined });
    };
    const visit = (n: StructTreeNode, header: boolean) => {
      for (const c of n.children) {
        if (!isNode(c)) continue;
        if (c.role === 'TR') addRow(c, header);
        else if (c.role === 'THead' || c.role === 'TBody' || c.role === 'TFoot') visit(c, c.role === 'THead');
      }
    };
    visit(node, false);
    if (!rows.length) return null;
    expandRowspans(rows);
    return { id: newId('t'), type: 'table', rows, x: { items: [], page: this.page } satisfies PdfBlockX };
  }

  private toc(node: StructTreeNode, out: Block[]): void {
    const inner: Block[] = [];
    const visit = (n: StructTreeNode, level: number) => {
      for (const c of n.children) {
        if (!isNode(c)) continue;
        if (c.role === 'TOCI') this.paragraph(c, inner, undefined, { role: 'toc', level });
        else if (c.role === 'TOC') visit(c, level + 1);
        else this.paragraph(c, inner, undefined, c.role === 'Caption' ? { role: 'p' } : undefined);
      }
    };
    visit(node, 1);
    if (inner.length) out.push({ id: newId('o'), type: 'opaque', label: 'Table of contents', blocks: inner, x: { items: [], page: this.page } satisfies PdfBlockX });
  }

  private note(node: StructTreeNode, out: Block[]): void {
    const kids = node.children.filter(isNode);
    const lbl = kids.find((k) => k.role === 'Lbl');
    const label = lbl ? this.collect(lbl).map((i) => i.str).join('').trim() : '';
    const items = this.collect({ role: 'P', children: node.children.filter((k: unknown) => k !== lbl) } as StructTreeNode);
    const p = para(items, { role: 'p' }, this.geo, this.page);
    const text = blockText(p).trim();
    (p.x as PdfBlockX).note = { label, text };
    if (label) p.spans = [{ text: label + ' ', fmt: {} }, ...p.spans];
    out.push(p);
  }
}

/** Cells spanning rows are listed once; the rows below get continuation cells, as in Word. */
function expandRowspans(rows: TableRow[]): void {
  const pending: Array<{ col: number; left: number; colspan: number }> = [];
  for (const row of rows) {
    let col = 0;
    const cells: TableCell[] = [];
    const take = () => {
      for (;;) {
        const p = pending.find((x) => x.col === col && x.left > 0);
        if (!p) break;
        cells.push({ blocks: [], vmerge: 'continue', colspan: p.colspan > 1 ? p.colspan : undefined });
        p.left--;
        col += p.colspan;
      }
    };
    for (const cell of row.cells) {
      take();
      const span = cell.colspan ?? 1;
      if ((cell.rowspan ?? 1) > 1) {
        cell.vmerge = 'restart';
        pending.push({ col, left: cell.rowspan! - 1, colspan: span });
        delete cell.rowspan;
      }
      cells.push(cell);
      col += span;
    }
    take();
    row.cells = cells;
  }
}

/* --------------------------------------------------------- untagged PDFs */

interface Line {
  items: Item[];
  y: number;
  x0: number;
  x1: number;
  size: number;
  page: number;
  text: string;
}

export function linesOf(p: Page): Line[] {
  const lines: Line[] = [];
  let cur: Item[] = [];
  const end = () => {
    const real = cur.filter((i) => i.str.trim());
    if (real.length) {
      const size = dominantSize(real);
      lines.push({
        items: cur,
        y: real.reduce((m, i) => (i.size >= size * 0.85 ? Math.min(m, i.y) : m), Infinity),
        x0: Math.min(...real.map((i) => i.x)),
        x1: Math.max(...real.map((i) => i.x + i.w)),
        size,
        page: p.n,
        text: cur.map((i) => i.str).join('').trim(),
      });
    }
    cur = [];
  };
  for (const it of p.items) {
    if (it.artifact) continue;
    const last = cur.filter((i) => i.str.trim()).pop();
    if (last && it.str.trim()) {
      const similar = !(it.size < last.size * 0.85 || last.size < it.size * 0.85);
      if (similar && Math.abs(it.y - last.y) > Math.max(last.size, it.size) * 0.5) end();
      else if (it.x < last.x - last.size * 2 && Math.abs(it.y - last.y) > 1) end();
    }
    cur.push(it);
    if (it.eol) end();
  }
  end();
  return lines;
}

const PAGE_NUMBER = /^(page\s+)?#+(\s*(of|\/)\s*#+)?$|^[-–—]\s*#+\s*[-–—]$/i;

/** Drops running headers, footers and page numbers. */
function dropFurniture(pages: Page[], lines: Line[]): Line[] {
  const heightOf = new Map(pages.map((p) => [p.n, p.height]));
  const edge = (l: Line) => {
    const h = heightOf.get(l.page) ?? 792;
    return l.y > h * 0.9 || l.y < h * 0.08;
  };
  const norm = (l: Line) => l.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const seen = new Map<string, Set<number>>();
  for (const l of lines) {
    if (!edge(l)) continue;
    const k = norm(l);
    let s = seen.get(k);
    if (!s) seen.set(k, (s = new Set()));
    s.add(l.page);
  }
  const repeated = (k: string) => {
    const n = seen.get(k)?.size ?? 0;
    return pages.length > 1 && n >= 2 && n >= pages.length * 0.4;
  };
  return lines.filter((l) => !(edge(l) && (repeated(norm(l)) || PAGE_NUMBER.test(norm(l)))));
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let n = -1;
  for (const [k, c] of counts) if (c > n || (c === n && k < best)) [best, n] = [k, c];
  return best;
}

/** Splits a line into cells at wide gaps (a row of a table without tags). */
function cellsOf(line: Line): Item[][] {
  const cells: Item[][] = [];
  let cur: Item[] = [];
  let prev: Item | null = null;
  for (const it of line.items) {
    if (!it.str.trim()) {
      if (cur.length) cur.push(it);
      continue;
    }
    if (prev && it.x - (prev.x + prev.w) > line.size * 2) {
      cells.push(cur);
      cur = [];
    }
    cur.push(it);
    prev = it;
  }
  if (cur.length) cells.push(cur);
  return cells;
}

/** A line of a table of contents: text, then a page number after dot leaders or a wide gap. Returns the number's right edge. */
function tocEntry(l: Line): number | null {
  const real = l.items.filter((i) => i.str.trim());
  const num = real[real.length - 1];
  const before = real[real.length - 2];
  if (!num || !before || !/^(\d{1,4}|[ivxlc]{1,6})$/i.test(num.str.trim())) return null;
  if (!/\.{4,}|…{2,}|(\. ){3,}/.test(l.text) && num.x - (before.x + before.w) < l.size * 1.5) return null;
  return num.x + num.w;
}

const CONTENTS_TITLE = /^(table of )?contents$|^index$|^inhalt(sverzeichnis)?$|^sommaire$|^table des matières$|^índice$|^indice$|^inhoud(sopgave)?$/i;

class LayoutReader {
  readonly blocks: Block[] = [];

  constructor(
    private readonly lines: Line[],
    private readonly geo: Geo,
  ) {}

  run(): void {
    const { lines, geo } = this;
    const { base } = geo;
    const bodyLines = lines.filter((l) => Math.abs(l.size - base) < 0.6);
    const gaps: number[] = [];
    for (let i = 1; i < bodyLines.length; i++) {
      const a = bodyLines[i - 1]!;
      const b = bodyLines[i]!;
      if (a.page === b.page && a.y > b.y) gaps.push(Math.round((a.y - b.y) * 2) / 2);
    }
    const leading = mode(gaps.filter((g) => g < base * 2.2)) || base * 1.2;
    const headingSizes = [...new Set(lines.filter((l) => l.size >= base * 1.12).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
    const markerX = lines.filter((l) => this.marker(l, false)).map((l) => l.x0);
    const listLeft = markerX.length ? Math.min(...markerX) : geo.left;

    let cur: Line[] = [];
    let curKind: 'p' | 'h' | 'li' = 'p';
    let listKey = newId('L');
    let lastWasList = false;
    const flush = () => {
      if (!cur.length) return;
      const items = cur.flatMap((l) => l.items);
      let props: ParaProps = { role: 'p' };
      if (curKind === 'h') {
        const idx = headingSizes.indexOf(Math.round(cur[0]!.size * 2) / 2);
        props = { role: 'h', level: Math.min(6, Math.max(1, idx + 1)) };
      }
      let body = items;
      if (curKind === 'li') {
        const m = this.marker(cur[0]!, true)!;
        body = items.slice(m.count);
        const level = Math.max(0, Math.min(8, Math.round((cur[0]!.x0 - listLeft) / 18)));
        props.list = listInfo(m.label, level, listKey);
        lastWasList = true;
      } else {
        lastWasList = false;
      }
      const p = para(body, props, geo, cur[0]!.page);
      // A numbered paragraph at the foot of the page may be a footnote (it becomes one if a reference points at it).
      const h = geo.heights.get(cur[0]!.page) ?? 792;
      const note = /^(\d{1,3}|[*†‡§])\s*(\S.*)$/.exec(blockText(p));
      if (note && !props.list && curKind === 'p' && cur[0]!.y < h * (cur[0]!.size < base * 0.93 ? 0.4 : 0.2)) (p.x as PdfBlockX).note = { label: note[1]!, text: note[2]!.trim() };
      this.blocks.push(p);
      cur = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const prev = i > 0 ? lines[i - 1]! : null;
      if (tocEntry(l) !== null) {
        let j = i;
        while (j < lines.length && tocEntry(lines[j]!) !== null) j++;
        const ends = lines.slice(i, j).map((x) => tocEntry(x)!);
        const aligned = ends.every((e) => Math.abs(e - ends[0]!) < 2);
        const titled = cur.length > 0 && CONTENTS_TITLE.test(cur.map((x) => x.text).join(' ').trim());
        const titledBefore = !cur.length && CONTENTS_TITLE.test(blockText(this.blocks[this.blocks.length - 1] ?? { id: '', type: 'marker' }).trim());
        if (j - i >= 2 && (aligned || titled || titledBefore)) {
          flush();
          this.pushToc(lines.slice(i, j));
          i = j - 1;
          lastWasList = false;
          continue;
        }
      }
      const kind: 'p' | 'h' | 'li' = l.size >= base * 1.12 ? 'h' : this.marker(l, false) ? 'li' : 'p';
      // Rows of an untagged table: several lines split into aligned cells.
      const table = kind === 'p' ? this.tableAt(i) : 0;
      if (table) {
        flush();
        this.pushTable(lines.slice(i, i + table));
        i += table - 1;
        lastWasList = false;
        continue;
      }
      let start = !cur.length || kind !== curKind || kind === 'li';
      if (!start && prev) {
        const samePage = prev.page === l.page;
        const gap = prev.y - l.y;
        const full = prev.x1 > geo.right - base * 3;
        if (samePage && (gap > leading * 1.3 || gap < 0)) start = true;
        else if (Math.abs(l.size - prev.size) > base * 0.1) start = true;
        else if (samePage && l.x0 > prev.x0 + base * 0.8 && cur.length > 1) start = true;
        else if (samePage && !full && SENTENCE_END.test(prev.text)) start = true;
        else if (!samePage && (!full || (SENTENCE_END.test(prev.text) && !/^\p{Ll}/u.test(l.text)))) start = true;
      }
      if (start) {
        flush();
        if (kind === 'li' && !lastWasList) listKey = newId('L');
        curKind = kind;
      }
      cur.push(l);
    }
    flush();
    this.findTitle(headingSizes);
  }

  /** The largest text near the top of the first page, used once, is the title. */
  private findTitle(headingSizes: number[]): void {
    if (!headingSizes.length) return;
    const top = headingSizes[0]!;
    const withTop = this.blocks.filter((b) => b.type === 'p' && b.props.role === 'h' && b.props.level === 1);
    const lines = this.lines.filter((l) => Math.round(l.size * 2) / 2 === top);
    const first = withTop[0];
    if (!first || withTop.length > 1 || lines.length > 2 || blockPdf(first)?.page !== 1 || headingSizes.length < 2) return;
    if (first.type === 'p') first.props = { ...first.props, role: 'title', level: undefined };
    for (const b of this.blocks) if (b.type === 'p' && b.props.role === 'h') b.props = { ...b.props, level: Math.max(1, (b.props.level ?? 2) - 1) };
  }

  /** A list marker at the start of a line: a bullet, or a number standing apart from the text. */
  private marker(l: Line, strip: boolean): { label: string; count: number } | null {
    const real = l.items.findIndex((i) => i.str.trim());
    if (real < 0) return null;
    const it = l.items[real]!;
    const s = it.str.trim();
    const next = l.items.slice(real + 1).find((i) => i.str.trim());
    const apart = !!next && next.x - (it.x + it.w) > it.size * 0.2;
    if (BULLET_ONLY.test(s) && next) return { label: s, count: real + 1 };
    if (NUMBER_LABEL.test(s) && apart) return { label: s, count: real + 1 };
    // A bullet glued to the text in one run ("• Item").
    const m = BULLET_GLUED.exec(it.str.trimStart());
    if (m && !'-*–—'.includes(m[1]!)) {
      if (strip) it.str = it.str.trimStart().slice(1);
      return { label: m[1]!, count: real };
    }
    return null;
  }

  /** Number of consecutive lines from `i` that look like table rows (0 if none). */
  private tableAt(i: number): number {
    const first = this.lines[i]!;
    const cols = cellsOf(first);
    if (cols.length < 2 || /\.{4,}|…{2,}/.test(first.text)) return 0;
    const starts = cols.map((c) => c[0]!.x);
    let n = 1;
    for (let j = i + 1; j < this.lines.length; j++) {
      const l = this.lines[j]!;
      if (l.page !== first.page || Math.abs(l.size - first.size) > 1) break;
      const cells = cellsOf(l);
      if (cells.length < 2 || /\.{4,}/.test(l.text)) break;
      if (!cells.every((c) => starts.some((x) => Math.abs(x - c[0]!.x) < 4))) break;
      n++;
    }
    return n >= 2 ? n : 0;
  }

  private pushTable(lines: Line[]): void {
    const starts: number[] = [];
    for (const l of lines) for (const c of cellsOf(l)) if (!starts.some((x) => Math.abs(x - c[0]!.x) < 4)) starts.push(c[0]!.x);
    starts.sort((a, b) => a - b);
    const rows: TableRow[] = lines.map((l) => {
      const cells: TableCell[] = starts.map(() => ({ blocks: [] }));
      for (const c of cellsOf(l)) {
        const k = starts.findIndex((x) => Math.abs(x - c[0]!.x) < 4);
        cells[k]!.blocks.push(para(c, { role: 'p' }, this.geo, l.page, false));
      }
      return { id: newId('r'), cells };
    });
    this.blocks.push({ id: newId('t'), type: 'table', rows, x: { items: [], page: lines[0]!.page } satisfies PdfBlockX });
  }

  private pushToc(lines: Line[]): void {
    const inner: Block[] = [];
    // The heading just before the entries ("Contents") belongs to the table.
    const prev = this.blocks[this.blocks.length - 1];
    if (prev?.type === 'p' && CONTENTS_TITLE.test(blockText(prev).trim()) && !prev.props.list) {
      this.blocks.pop();
      inner.push({ ...prev, props: { role: 'p' }, spans: prev.spans.map((s) => ({ ...s, fmt: { ...s.fmt, b: undefined } })) });
    }
    const left = Math.min(...lines.map((l) => l.x0));
    for (const l of lines) inner.push(para(l.items, { role: 'toc', level: 1 + Math.max(0, Math.round((l.x0 - left) / 12)) }, this.geo, l.page));
    this.blocks.push({ id: newId('o'), type: 'opaque', label: 'Table of contents', blocks: inner, x: { items: [], page: lines[0]!.page } satisfies PdfBlockX });
  }
}

/* ------------------------------------------------------ post-processing */

/** Joins paragraphs that a page break split in two, and tables of contents split across pages. */
function joinAcrossPages(blocks: Block[], geo: Geo): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    const px = blockPdf(prev);
    const bx = blockPdf(b);
    const nextPage = px?.page !== undefined && bx?.page !== undefined && bx.page === px.page + 1;
    if (nextPage && prev?.type === 'opaque' && b.type === 'opaque' && prev.label === b.label) {
      out[out.length - 1] = { ...prev, blocks: [...prev.blocks, ...b.blocks], x: { items: [], page: bx!.page } satisfies PdfBlockX };
      continue;
    }
    if (
      nextPage &&
      prev?.type === 'p' &&
      b.type === 'p' &&
      !px!.note &&
      !bx!.note &&
      (prev.props.role === 'p' || prev.props.role === 'quote') &&
      b.props.role === 'p' &&
      !b.props.list &&
      Math.abs(dominantSize(px!.items) - dominantSize(bx!.items)) < 0.6 &&
      endsFull(px!.items, geo) &&
      (!SENTENCE_END.test(blockText(prev)) || /^\p{Ll}/u.test(blockText(b)))
    ) {
      const spans = [...prev.spans];
      const last = spans[spans.length - 1];
      if (last && !last.obj && /\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(blockText(b))) spans[spans.length - 1] = { ...last, text: last.text.slice(0, -1) };
      else spans.push({ text: ' ', fmt: {} });
      out[out.length - 1] = { ...prev, props: { ...prev.props, align: undefined }, spans: normalizeSpans([...spans, ...b.spans]), x: { items: [...px!.items, ...bx!.items], page: bx!.page } satisfies PdfBlockX };
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Footnote bodies at the bottom of a page become footnotes at their superscript references. */
function attachNotes(blocks: Block[]): Block[] {
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    const nx = blockPdf(out[i]);
    if (!nx?.note || !nx.note.label) continue;
    const { label, text } = nx.note;
    let done = false;
    for (let j = i - 1; j >= 0 && !done; j--) {
      const b = out[j]!;
      const bx = blockPdf(b);
      if (b.type !== 'p' || bx?.note || (bx?.page !== undefined && nx.page !== undefined && bx.page < nx.page - 1)) continue;
      const k = b.spans.findIndex((s) => !s.obj && s.fmt.sup && s.text.trim() === label);
      if (k < 0) continue;
      const spans = [...b.spans];
      spans[k] = { text: OBJ_CHAR, fmt: {}, obj: { kind: 'footnote', key: `footnote:${text}`, label: `Footnote: ${text}`, note: text } };
      // Drop the space a superscript leaves before the punctuation that follows it.
      const after = spans[k + 1];
      if (after && !after.obj && /^\s+[.,;:!?)]/.test(after.text)) spans[k + 1] = { ...after, text: after.text.replace(/^\s+/, '') };
      out[j] = { ...b, spans: normalizeSpans(spans) };
      out.splice(i, 1);
      i--;
      done = true;
    }
  }
  return out;
}

/** Geometry is not needed once the document is built (it holds every glyph position). */
function dropGeometry(blocks: Block[]): void {
  for (const b of blocks) {
    delete b.x;
    if (b.type === 'table') for (const r of b.rows) for (const c of r.cells) dropGeometry(c.blocks);
    else if (b.type === 'opaque') dropGeometry(b.blocks);
  }
}

export function geometry(pages: Page[], items: Item[]): Geo {
  const base = dominantSize(items);
  const body = items.filter((i) => i.str.trim() && Math.abs(i.size - base) < 0.6);
  const width = pages[0]?.width ?? 612;
  const left = body.length ? mode(body.map((i) => Math.round(i.x))) : 72;
  const ends = body.map((i) => i.x + i.w).filter((x) => x <= width - 18);
  const widest = ends.length ? Math.max(...ends) : width - left;
  // Margins are usually symmetric; text that reaches further shows they are not.
  const right = widest > width - left + 4 ? widest : width - left;
  return { base, left, right, heights: new Map(pages.map((p) => [p.n, p.height])) };
}

/* ------------------------------------------------------------------ main */

export { loadPdfjs };

export async function readPdf(data: Uint8Array, name: string): Promise<Doc> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: data.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    // Pictures are not compared: skip decoding them.
    maxImageSize: 1,
    verbosity: 0,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/cmaps/',
    cMapPacked: true,
  });
  task.onPassword = () => {
    void task.destroy();
  };
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException' || /password|destroyed/i.test((e as Error).message))
      throw new PdfPasswordError('This PDF is password protected. Open it, save a copy without a password, and load that.');
    throw e;
  }
  try {
    const pages: Page[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push(await readPage(page, n));
      page.cleanup();
    }
    const all = pages.flatMap((p) => p.items).filter((i) => !i.artifact);
    const chars = all.reduce((n, i) => n + i.str.trim().length, 0);
    const geo = geometry(pages, all);
    const tagged = pages.some((p) => p.tree) && all.filter((i) => i.mcid).reduce((n, i) => n + i.str.trim().length, 0) >= chars * 0.8;
    let blocks: Block[];
    const notes: string[] = [];
    if (tagged) {
      const r = new TaggedReader(geo);
      for (const p of pages) r.read(p);
      blocks = r.blocks;
    } else {
      const lines = dropFurniture(pages, pages.flatMap(linesOf));
      const r = new LayoutReader(lines, geo);
      r.run();
      blocks = r.blocks;
      notes.push('This PDF has no structure tags, so its paragraphs, headings and lists were worked out from the page layout. Pictures are not compared.');
    }
    blocks = attachNotes(joinAcrossPages(blocks, geo));
    dropGeometry(blocks);
    if (!chars) notes.unshift('This PDF has no text layer (it is probably a scan), so there is nothing to compare.');
    notes.push('PDFs are read only: export a merged result as Word, OpenDocument or another editable format.');
    return { id: newId('d'), name, kind: 'pdf', blocks, version: 0, ext: 'pdf', formatLabel: 'PDF', notes };
  } finally {
    void task.destroy();
  }
}
