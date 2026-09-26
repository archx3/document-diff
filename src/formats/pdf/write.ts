import { computeListLabels } from '../../core/lists';
import type { Block, Doc, Fmt, ParaBlock, Span, TableBlock, TableRow } from '../../core/model';
import { blockText, isBlank } from '../../core/model';

/**
 * PDF export: the document is laid out by pdfmake (with the Roboto fonts it
 * embeds, which cover Latin, Greek and Cyrillic). pdfmake is loaded from a
 * CDN the first time a PDF is saved.
 */

type Node = Record<string, unknown> | string;

/** A run showing a page number, known only once the pages are laid out. */
interface PageSlot {
  run: Record<string, unknown>;
  /** Id of the node whose first page the run shows. */
  id?: string;
  /** The run shows the number of pages. */
  total?: boolean;
  /** Table-of-contents entries: the heading they point at, and the runs that link to it. */
  heading?: string;
  links?: Record<string, unknown>[];
}

interface Ctx {
  labels: Map<ParaBlock, string>;
  notes: string[];
  mono: boolean;
  /** Inside a table of contents, where entries end with a page number after a tab. */
  toc?: boolean;
  slots: PageSlot[];
  /** Page numbers for the slots, from an earlier layout. */
  numbers?: readonly (number | undefined)[];
  /** Ids of heading nodes by their text, in document order. */
  headings: Map<string, string[]>;
  seq: { n: number };
  /** Id of the paragraph being built, once something needs to know its page. */
  here?: string;
}

const PAGE_FIELDS = /^(PAGE|NUMPAGES|SECTIONPAGES)$/;

function nextId(ctx: Ctx): string {
  return `n${++ctx.seq.n}`;
}

function addSlot(ctx: Ctx, slot: PageSlot): void {
  const n = ctx.numbers?.[ctx.slots.length];
  if (n) slot.run.text = String(n);
  ctx.slots.push(slot);
}

/** Text for matching table-of-contents entries to headings. */
function textKey(text: string): string {
  return text
    .replace(/\ufffc/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .replace(/[\s.·…_]{2,}$/, '')
    .trim()
    .toLowerCase();
}

function spansText(spans: readonly Span[]): string {
  return spans.map((s) => (s.marker ? '' : s.obj ? (s.obj.text ?? '') : s.text)).join('');
}

const HEADING_SIZES = [20, 16, 13.5, 12, 11, 11];

function pngOrJpeg(mime: string | undefined): boolean {
  return mime === 'image/png' || mime === 'image/jpeg';
}

function dataUrl(data: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

function runOf(text: string, fmt: Fmt, ctx: Ctx): Node {
  const run: Record<string, unknown> = { text: text.replace(/\t/g, '    ') };
  if (fmt.b) run.bold = true;
  if (fmt.i) run.italics = true;
  const deco = [fmt.u || fmt.href ? 'underline' : '', fmt.s ? 'lineThrough' : ''].filter(Boolean);
  if (deco.length) run.decoration = deco.length === 1 ? deco[0] : deco;
  if (fmt.sup) run.sup = true;
  else if (fmt.sub) run.sub = true;
  if (fmt.code && !ctx.mono) run.font = 'Courier';
  if (fmt.hl) run.background = '#fff2a8';
  if (fmt.href && /^(https?|mailto):/i.test(fmt.href)) {
    run.link = fmt.href;
    run.color = '#1f4fbf';
  }
  return run;
}

/** Text runs of a paragraph, the pictures it holds, and whether it asks for a page break. */
function inline(spans: readonly Span[], ctx: Ctx): { runs: Node[]; images: Node[]; brk?: 'before' | 'after' } {
  const runs: Node[] = [];
  const images: Node[] = [];
  let brk: 'before' | 'after' | undefined;
  for (const s of spans) {
    if (s.marker) continue;
    const o = s.obj;
    if (!o) {
      if (s.text) runs.push(runOf(s.text, s.fmt, ctx));
      continue;
    }
    if (o.kind === 'pagebreak') {
      brk = runs.length ? 'after' : 'before';
    } else if (o.kind === 'image' && o.data && pngOrJpeg(o.mime)) {
      const width = Math.min(460, Math.round((o.width ?? 240) * 0.75));
      images.push({ image: dataUrl(o.data, o.mime!), width, margin: [0, 2, 0, 6] });
    } else if (o.kind === 'footnote' || o.kind === 'endnote') {
      ctx.notes.push(o.note ?? o.label);
      runs.push({ text: String(ctx.notes.length), sup: true });
    } else if (o.kind === 'field' && PAGE_FIELDS.test(o.key)) {
      const run = runOf(o.text || '1', s.fmt, ctx) as Record<string, unknown>;
      addSlot(ctx, o.key === 'PAGE' ? { run, id: (ctx.here ??= nextId(ctx)) } : { run, total: true });
      runs.push(run);
    } else {
      const text = o.text || (o.kind === 'image' ? `[${o.label}]` : '');
      if (text) runs.push(runOf(text, s.fmt, ctx));
    }
  }
  return { runs, images, brk };
}

/**
 * A table-of-contents entry: its title, and its page number at the right
 * margin. The number becomes the page its heading lands on in this PDF, and
 * the entry a link to it.
 */
function tocEntry(p: ParaBlock, ctx: Ctx): Node | undefined {
  let tab = p.spans.length - 1;
  while (tab >= 0 && (p.spans[tab]!.obj || !p.spans[tab]!.text.includes('\t'))) tab--;
  if (tab < 0) return undefined;
  const s = p.spans[tab]!;
  const cut = s.text.lastIndexOf('\t');
  const head = [...p.spans.slice(0, tab), { ...s, text: s.text.slice(0, cut) }];
  const tail = [{ ...s, text: s.text.slice(cut + 1) }, ...p.spans.slice(tab + 1)];
  const before = inline(head, ctx).runs;
  let after = inline(tail, ctx).runs;
  const page = spansText(tail).trim();
  if (/^\d+$/.test(page)) {
    const fmt = tail.find((t) => !t.marker && (t.obj || t.text.trim()))?.fmt ?? {};
    const run = runOf(page, fmt, ctx) as Record<string, unknown>;
    after = [run];
    addSlot(ctx, { run, heading: textKey(spansText(head)), links: [...before, run].filter((r): r is Record<string, unknown> => typeof r === 'object') });
  }
  return {
    columns: [
      { width: '*', text: before.length ? before : ' ' },
      { width: 'auto', text: after.length ? after : ' ', alignment: 'right' },
    ],
    margin: [((p.props.level ?? 1) - 1) * 14, 0, 0, 3],
  };
}

function paragraph(p: ParaBlock, ctx: Ctx, inList = false): Node {
  if ((p.props.role === 'toc' || ctx.toc) && !inList) {
    const entry = tocEntry(p, ctx);
    if (entry) return entry;
  }
  ctx.here = undefined;
  const { runs, images, brk } = inline(p.spans, ctx);
  if (isBlank(p) && !images.length) {
    const blank: Record<string, unknown> = { text: ' ', margin: [0, 0, 0, ctx.mono ? 0 : 4] };
    if (brk) blank.pageBreak = brk;
    return blank;
  }
  const node: Record<string, unknown> = { text: runs.length ? runs : ' ' };
  const { role, level, align } = p.props;
  if (role === 'h' || role === 'title') {
    // Table-of-contents entries find their heading by its text, with or without its number.
    const id = (ctx.here ??= nextId(ctx));
    const text = blockText(p);
    const label = ctx.labels.get(p);
    for (const key of new Set([textKey(text), textKey(`${label ?? ''} ${text}`)])) {
      if (key) ctx.headings.set(key, [...(ctx.headings.get(key) ?? []), id]);
    }
  }
  if (ctx.here) node.id = ctx.here;
  if (role === 'h') node.style = `h${Math.max(1, Math.min(6, level ?? 1))}`;
  else if (role === 'title' || role === 'subtitle' || role === 'quote' || role === 'code' || role === 'caption') node.style = role;
  else if (role === 'toc') node.margin = [((level ?? 1) - 1) * 14, 0, 0, 3];
  if (align) node.alignment = align;
  if (ctx.mono || role === 'code') node.preserveLeadingSpaces = true;
  if (inList) node.margin = [0, 0, 0, 3];
  const out: Node = images.length ? { stack: [node, ...images] } : node;
  if (brk && typeof out === 'object') out.pageBreak = brk;
  return out;
}

/**
 * List paragraphs, each with its label written as text in a narrow column, so
 * numbering is exactly the document's own and readers of the PDF see it.
 */
function lists(paras: ParaBlock[], ctx: Ctx): Node[] {
  return paras.map((p) => {
    const list = p.props.list!;
    const raw = ctx.labels.get(p) ?? '';
    const label = list.ordered ? raw : '•';
    const body = paragraph(p, ctx, true);
    return {
      columns: [{ width: 18, text: label }, typeof body === 'string' ? { width: '*', text: body } : { width: '*', ...body }],
      columnGap: 4,
      margin: [list.level * 18, 0, 0, 3],
    };
  });
}

function table(rows: TableRow[], ctx: Ctx): Node {
  const width = (r: TableRow) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0);
  const cols = Math.max(1, ...rows.map(width));
  // Grid columns of continuation cells, per row, to size cells that span rows.
  const cont = rows.map((r) => {
    const set = new Set<number>();
    let c = 0;
    for (const cell of r.cells) {
      if (cell.vmerge === 'continue') set.add(c);
      c += cell.colspan ?? 1;
    }
    return set;
  });
  const body = rows.map((r, ri) => {
    const out: Node[] = [];
    let c = 0;
    for (const cell of r.cells) {
      const span = cell.colspan ?? 1;
      if (cell.vmerge === 'continue') {
        for (let k = 0; k < span; k++) out.push({});
        c += span;
        continue;
      }
      const node: Record<string, unknown> = { stack: blocks(cell.blocks, ctx) };
      if (!(node.stack as Node[]).length) node.stack = [' '];
      if (span > 1) node.colSpan = span;
      if (cell.vmerge === 'restart') {
        let n = 1;
        while (cont[ri + n]?.has(c)) n++;
        if (n > 1) node.rowSpan = n;
      }
      if (cell.header || r.header) {
        node.fillColor = '#eef0f4';
        node.bold = true;
      }
      out.push(node);
      for (let k = 1; k < span; k++) out.push({});
      c += span;
    }
    while (out.length < cols) out.push(' ');
    return out.slice(0, cols);
  });
  let headerRows = 0;
  while (headerRows < rows.length && rows[headerRows]!.header) headerRows++;
  return {
    table: { headerRows, widths: new Array(cols).fill('*'), body },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#8a93a3',
      vLineColor: () => '#8a93a3',
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 2, 0, 8],
  };
}

function blocks(list: readonly Block[], ctx: Ctx): Node[] {
  const out: Node[] = [];
  let i = 0;
  while (i < list.length) {
    const b = list[i]!;
    if (b.type === 'p' && b.props.list) {
      const run: ParaBlock[] = [];
      while (i < list.length && list[i]!.type === 'p' && (list[i] as ParaBlock).props.list) run.push(list[i++] as ParaBlock);
      out.push(...lists(run, ctx));
      continue;
    }
    if (b.type === 'table' && b.fragment) {
      // CSV rows are separate blocks: gather them into one table.
      const rows: TableRow[] = [];
      while (i < list.length && list[i]!.type === 'table' && (list[i] as TableBlock).fragment) rows.push(...(list[i++] as TableBlock).rows);
      out.push(table(rows, ctx));
      continue;
    }
    i++;
    if (b.type === 'p') out.push(paragraph(b, ctx));
    else if (b.type === 'table') out.push(table(b.rows, ctx));
    else if (b.type === 'opaque') out.push({ stack: blocks(b.blocks, { ...ctx, toc: b.label === 'Table of contents' }), margin: [0, 0, 0, 6] });
  }
  return out;
}

/**
 * The pdfmake document definition for a document, and the runs that show page
 * numbers. `numbers` fills those runs in, from an earlier layout.
 */
function plan(doc: Doc, numbers?: readonly (number | undefined)[]): { def: Record<string, unknown>; slots: PageSlot[] } {
  const ctx: Ctx = { labels: computeListLabels(doc.blocks), notes: [], mono: !!doc.mono, slots: [], numbers, headings: new Map(), seq: { n: 0 } };
  const content = blocks(doc.blocks, ctx);
  // Point table-of-contents entries at their headings, in order when titles repeat.
  const used = new Set<string>();
  for (const slot of ctx.slots) {
    if (slot.heading === undefined) continue;
    const id = ctx.headings.get(slot.heading)?.find((h) => !used.has(h));
    if (!id) continue;
    used.add(id);
    slot.id = id;
    for (const run of slot.links ?? []) run.linkToDestination = id;
  }
  if (ctx.notes.length) {
    content.push({ text: 'Notes', style: 'notesTitle' });
    ctx.notes.forEach((n, k) => content.push({ columns: [{ width: 18, text: `${k + 1}.` }, { width: '*', text: n }], columnGap: 4, style: 'note', margin: [0, 0, 0, 3] }));
  }
  const headings = Object.fromEntries(
    HEADING_SIZES.map((size, k) => [`h${k + 1}`, { fontSize: size, bold: true, margin: [0, k < 2 ? 14 : 10, 0, 5], lineHeight: 1.15 }]),
  );
  const def = {
    info: { title: doc.name.replace(/\.[^.]+$/, ''), creator: 'Collate', producer: 'Collate' },
    pageSize: 'A4',
    pageMargins: [60, 56, 60, 60],
    defaultStyle: ctx.mono ? { font: 'Courier', fontSize: 9, lineHeight: 1.2 } : { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3 },
    styles: {
      ...headings,
      title: { fontSize: 24, bold: true, margin: [0, 0, 0, 10], lineHeight: 1.1 },
      subtitle: { fontSize: 14, color: '#555c68', margin: [0, 0, 0, 10] },
      quote: { italics: true, margin: [24, 2, 24, 8], color: '#333a45' },
      code: { font: 'Courier', fontSize: 9, margin: [0, 0, 0, 2] },
      caption: { italics: true, fontSize: 9, color: '#555c68', margin: [0, 2, 0, 8] },
      notesTitle: { fontSize: 11, bold: true, margin: [0, 16, 0, 6] },
      note: { fontSize: 9 },
    },
    content: content.map((n) => (typeof n === 'string' ? n : { margin: [0, 0, 0, 6], ...n })),
  };
  return { def, slots: ctx.slots };
}

/** The pdfmake document definition for a document. */
export function pdfDefinition(doc: Doc): Record<string, unknown> {
  return plan(doc).def;
}

export interface PdfMake {
  createPdf(def: Record<string, unknown>): { getBuffer(): Promise<Uint8Array> };
}

interface NodeInfo {
  id?: string;
  pageNumbers: number[];
  pages: number;
}

/**
 * A PDF of the document made with a pdfmake instance. Page numbers (in the
 * table of contents and page fields) come from a first layout of the document,
 * then the document is laid out again with them filled in.
 */
export async function renderPdf(pdfMake: PdfMake, doc: Doc): Promise<Uint8Array> {
  const first = plan(doc);
  if (first.slots.some((s) => s.id || s.total)) {
    const starts = new Map<string, number>();
    let total = 0;
    first.def.pageBreakBefore = (node: NodeInfo) => {
      if (node.id && !starts.has(node.id)) starts.set(node.id, node.pageNumbers[0]!);
      total = node.pages;
      return false;
    };
    await pdfMake.createPdf(first.def).getBuffer();
    const numbers = first.slots.map((s) => (s.total ? total : s.id ? starts.get(s.id) : undefined));
    return new Uint8Array(await pdfMake.createPdf(plan(doc, numbers).def).getBuffer());
  }
  return new Uint8Array(await pdfMake.createPdf(first.def).getBuffer());
}

/* ----------------------------------------------------------- in a browser */

const CDN = 'https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/';
const SCRIPTS: Array<[string, string]> = [
  ['pdfmake.min.js', 'sha384-vsaIaEjAOZA6uoCQ2pryCKIc8YGpQ/0HK5krdezL4PYvnmLzrizBMDJCZulvIomS'],
  ['vfs_fonts.js', 'sha384-pkBUW1wxcm6m7ZjKDxADnNHqnz+Sx9sAL1ndsLNv/GZnWZgodPYsju1yxeyQnn0c'],
  ['standard-fonts/Courier.js', 'sha384-C7OtgvR6B2TEB3r3NkimHHJZMXqKg7V6fSyzHucz1nFFEOR3uW/u/wLtP8Xg9E0A'],
];

let loading: Promise<PdfMake> | null = null;

function loadScript(src: string, integrity: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The PDF maker could not be loaded (it needs an internet connection).'));
    document.head.appendChild(s);
  });
}

function loadPdfmake(): Promise<PdfMake> {
  loading ??= (async () => {
    for (const [file, hash] of SCRIPTS) await loadScript(CDN + file, hash);
    const lib = (window as unknown as { pdfMake?: PdfMake }).pdfMake;
    if (!lib) throw new Error('The PDF maker did not start.');
    return lib;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** A PDF of the document. */
export async function exportPdf(doc: Doc): Promise<Uint8Array> {
  return renderPdf(await loadPdfmake(), doc);
}
