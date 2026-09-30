/**
 * A redline as a Word file: the comparison as tracked changes, which Word
 * shows struck out and underlined and can accept or reject one by one.
 *
 * It is built on a copy of B when B is a Word file, so B's page setup,
 * headers, styles and lists stay as they are; A's removed text is brought in
 * with its own formatting. Accepting every change gives B; rejecting every
 * change gives A.
 */
import type { Comparison } from '../../core/compare';
import type { Block, Doc, Fmt, ParaBlock, TableRow } from '../../core/model';
import type { RedComment, RedItem, RedNote, RedPiece, RedPoint, RedSide } from '../../core/redline';
import { redlineComments, redlinePlan } from '../../core/redline';
import { slicedSpans } from './backend';
import { Importer } from './importer';
import { DocxPackage, dirOf } from './package';
import type { DocxRowX } from './read';
import { blockX, spanX } from './read';
import { InlineEmitter, appendText, exportDocx, generateBlock, generateRow, generateRuns, newPackage, rPrFor, spanNodes } from './writer';
import { NS, REL, createW, descendants, elements, isW, parseXml, wAttr, wChild } from './xml';

export interface RedlineOptions {
  /** Shown in Word as the author of every change. */
  author?: string;
  date?: Date;
  /** Review notes and reactions, put in as Word comments. */
  notes?: readonly RedNote[];
}

type Mark = 'ins' | 'del';
type MoveMark = 'moveFrom' | 'moveTo';

/** Where a comment's range starts or ends among a paragraph's pieces. */
interface RangeEdge {
  comment: number;
  edge: 'start' | 'end';
}
type Laid = RedPiece | RangeEdge;
const isEdge = (x: Laid): x is RangeEdge => 'edge' in x;

const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

class RedlineWriter {
  private readonly doc: Document;
  private readonly date: string;
  private readonly author: string;
  private id = 1;

  constructor(
    private readonly out: DocxPackage,
    private readonly cmp: Comparison,
    opts: RedlineOptions,
  ) {
    this.doc = out.main;
    this.author = opts.author?.trim() || 'Collate';
    this.date = (opts.date ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  }

  private source(side: RedSide): Doc {
    return side === 'a' ? this.cmp.left : this.cmp.right;
  }

  private pkg(side: RedSide): DocxPackage | undefined {
    const pkg = this.source(side).pkg;
    return pkg instanceof DocxPackage ? pkg : undefined;
  }

  /**
   * Nodes of one side's Word file, brought into the redline with what they refer to. The file's own tracked
   * changes are accepted, as the comparison reads it, so the redline shows only what changed from A to B.
   */
  private bring(side: RedSide, nodes: Node[]): Node[] {
    const src = this.pkg(side)!;
    const out = Importer.between(src, this.out).importNodes(nodes, src.mainPath, this.out.mainPath);
    const hold = createW(this.doc, 'p');
    for (const n of out) hold.appendChild(n);
    acceptTracked(hold);
    // A's comments are not brought along (their ids would clash with B's).
    if (side === 'a') dropComments(hold);
    return Array.from(hold.childNodes);
  }

  /** One side's block, as it is in its file (or as a new one, for files that are not Word files). */
  private block(side: RedSide, block: Block): Element | null {
    const x = blockX(block);
    if (x && this.pkg(side)) {
      const [el] = this.bring(side, [x.el]);
      if (el?.nodeType === Node.ELEMENT_NODE) return el as Element;
    }
    return generateBlock(block, { pkg: this.out, source: this.source(side).id, neighbors: [] });
  }

  private row(side: RedSide, row: TableRow): Element {
    const x = row.x as DocxRowX | undefined;
    if (x?.el && this.pkg(side)) {
      const [el] = this.bring(side, [x.el]);
      if (el?.nodeType === Node.ELEMENT_NODE) return el as Element;
    }
    return generateRow(row, { pkg: this.out, source: this.source(side).id, neighbors: [] });
  }

  /** Runs for pieces of one side's paragraph. */
  private runs(side: RedSide, block: ParaBlock, pieces: readonly RedPiece[]): Node[] {
    const src = this.pkg(side);
    if (src && block.spans.some((s) => spanX(s))) {
      // Built inside the side's own file, keeping its run formatting and links, then brought over.
      const tmp = src.main.createElementNS(NS.w, 'w:p');
      const emitter = new InlineEmitter(tmp);
      for (const p of pieces) {
        const span = block.spans[p.span]!;
        emitter.emit(spanNodes(span, p.start, p.end, src.main), spanX(span)?.wrap ?? []);
      }
      return this.bring(side, Array.from(tmp.childNodes));
    }
    return generateRuns(slicedSpans(block, pieces), this.out, this.doc);
  }

  private change(mark: Mark | MoveMark | 'rPrChange' | 'pPrChange'): Element {
    return createW(this.doc, mark, { id: String(this.id++), author: this.author, date: this.date });
  }

  /* ------------------------------------------------------------ marking */

  /** Marks every run in `el` as inserted, deleted or moved (runs already tracked in the file are left as they are). */
  private markRuns(el: Element, mark: Mark | MoveMark): void {
    let open: Element | null = null;
    for (const r of descendants(el, NS.w, 'r')) {
      if (tracked(r, el)) continue;
      if (mark === 'del') toDeleted(r);
      // Runs next to each other share one change.
      if (open && open.nextSibling === r) {
        open.appendChild(r);
        continue;
      }
      const wrap = this.change(mark);
      r.parentNode!.insertBefore(wrap, r);
      wrap.appendChild(r);
      open = wrap;
    }
  }

  /** Marks a paragraph's mark (the end of the paragraph) as inserted, deleted or moved. */
  private markParagraph(p: Element, mark: Mark | MoveMark): void {
    let pPr = wChild(p, 'pPr');
    if (!pPr) {
      pPr = createW(this.doc, 'pPr');
      p.insertBefore(pPr, p.firstChild);
    }
    let rPr = wChild(pPr, 'rPr');
    if (!rPr) {
      rPr = createW(this.doc, 'rPr');
      pPr.insertBefore(rPr, wChild(pPr, 'sectPr') ?? wChild(pPr, 'pPrChange'));
    }
    if (wChild(rPr, 'ins') || wChild(rPr, 'del') || wChild(rPr, 'moveFrom') || wChild(rPr, 'moveTo')) return;
    rPr.insertBefore(this.change(mark), rPr.firstChild);
  }

  /** Marks a paragraph as moved away (from) or moved here (to), inside a named move range. */
  private markMove(p: Element, end: 'from' | 'to', name: string): Element {
    const mark: MoveMark = end === 'from' ? 'moveFrom' : 'moveTo';
    for (const s of descendants(p, NS.w, 'sectPr')) if (end === 'from') s.parentNode?.removeChild(s);
    this.markRuns(p, mark);
    this.markParagraph(p, mark);
    const id = String(this.id++);
    const start = createW(this.doc, `${mark}RangeStart`, { id, author: this.author, date: this.date, name });
    const pPr = wChild(p, 'pPr');
    p.insertBefore(start, pPr ? pPr.nextSibling : p.firstChild);
    p.appendChild(createW(this.doc, `${mark}RangeEnd`, { id }));
    return p;
  }

  private markRow(tr: Element, mark: Mark): void {
    let trPr = wChild(tr, 'trPr');
    if (!trPr) {
      trPr = createW(this.doc, 'trPr');
      const ex = wChild(tr, 'tblPrEx');
      tr.insertBefore(trPr, ex ? ex.nextSibling : tr.firstChild);
    }
    if (wChild(trPr, 'ins') || wChild(trPr, 'del')) return;
    trPr.insertBefore(this.change(mark), wChild(trPr, 'trPrChange'));
  }

  /** Marks everything in a block (its runs, paragraphs and table rows) as inserted or deleted. */
  private markAll(el: Element, mark: Mark): Element {
    if (mark === 'del') {
      // A's section breaks would bring A's page layout into the redline.
      for (const s of descendants(el, NS.w, 'sectPr')) s.parentNode?.removeChild(s);
    }
    this.markRuns(el, mark);
    for (const p of isW(el, 'p') ? [el] : descendants(el, NS.w, 'p')) this.markParagraph(p, mark);
    for (const tr of isW(el, 'tr') ? [el] : descendants(el, NS.w, 'tr')) this.markRow(tr, mark);
    return el;
  }

  /** Notes A's formatting on runs whose words stayed the same. */
  private markFormatting(el: Element, was: Fmt | undefined): void {
    for (const r of descendants(el, NS.w, 'r')) {
      let rPr = wChild(r, 'rPr');
      if (!rPr) {
        rPr = createW(this.doc, 'rPr');
        r.insertBefore(rPr, r.firstChild);
      }
      if (wChild(rPr, 'rPrChange')) continue;
      const change = this.change('rPrChange');
      change.appendChild(rPrFor(this.doc, was ?? {}, this.out, false) ?? createW(this.doc, 'rPr'));
      rPr.appendChild(change);
    }
  }

  /* ------------------------------------------------------------ building */

  /**
   * A paragraph laid out piece by piece, on the paragraph properties of `base` (one side's paragraph), with
   * comment ranges starting and ending between pieces; `whole` marks the paragraph itself as added or removed.
   */
  private paragraph(base: RedSide, blocks: Record<RedSide, ParaBlock | undefined>, laid: readonly Laid[], whole?: Mark): Element | null {
    const p = this.block(base, blocks[base]!);
    if (!p || !isW(p, 'p')) return p;
    for (const c of Array.from(p.childNodes)) if (!isW(c, 'pPr')) p.removeChild(c);
    const hold = createW(this.doc, 'p');
    let i = 0;
    while (i < laid.length) {
      const first = laid[i]!;
      if (isEdge(first)) {
        for (const n of this.rangeNodes(first)) p.appendChild(n);
        i++;
        continue;
      }
      let j = i + 1;
      for (; j < laid.length; j++) {
        const x = laid[j]!;
        if (isEdge(x) || x.side !== first.side || x.mark !== first.mark) break;
      }
      const group = laid.slice(i, j) as RedPiece[];
      i = j;
      for (const n of this.runs(first.side, blocks[first.side]!, group)) hold.appendChild(n);
      if (first.mark === 'ins' || first.mark === 'del') this.markRuns(hold, first.mark);
      else if (first.mark === 'fmt') this.markFormatting(hold, first.was);
      while (hold.firstChild) p.appendChild(hold.firstChild);
    }
    if (whole) {
      if (whole === 'del') for (const sect of descendants(p, NS.w, 'sectPr')) sect.parentNode?.removeChild(sect);
      this.markParagraph(p, whole);
    }
    return p;
  }

  private item(it: RedItem, edges: readonly RangeEdge[], exact: readonly RangeAt[]): Element | null {
    // A paragraph with a comment starting or ending inside it is laid out piece by piece.
    if (exact.length && it.kind !== 'table') {
      if (it.kind === 'para') return this.edges(this.paragraph('b', { a: it.a, b: it.b }, withEdges(it.pieces, exact)), edges);
      if (it.block.type === 'p') {
        const side: RedSide = it.kind === 'del' ? 'a' : 'b';
        const mark = it.kind === 'same' ? undefined : it.kind;
        const pieces = wholePieces(it.block, side, mark);
        const el = this.paragraph(side, { a: undefined, b: undefined, [side]: it.block }, withEdges(pieces, exact), mark);
        return el && this.edges(el, edges);
      }
    }
    return this.edges(this.plain(it), edges);
  }

  private plain(it: RedItem): Element | null {
    switch (it.kind) {
      case 'same':
        return this.block('b', it.block);
      case 'ins': {
        const el = this.block('b', it.block);
        if (el && it.move && isW(el, 'p')) return this.markMove(el, 'to', it.move.name);
        return el && this.markAll(el, 'ins');
      }
      case 'del': {
        const el = this.block('a', it.block);
        if (el && it.move && isW(el, 'p')) return this.markMove(el, 'from', it.move.name);
        return el && this.markAll(el, 'del');
      }
      case 'para':
        return this.paragraph('b', { a: it.a, b: it.b }, it.pieces);
      case 'table': {
        const tbl = this.block('b', it.b);
        if (!tbl || !isW(tbl, 'tbl')) return tbl;
        for (const c of elements(tbl)) if (isW(c, 'tr')) tbl.removeChild(c);
        for (const r of it.rows) {
          const tr = this.row(r.side, r.row);
          tbl.appendChild(r.mark ? this.markAll(tr, r.mark) : tr);
        }
        return tbl;
      }
    }
  }

  /* ------------------------------------------------------------ comments */

  private comments: { doc: XMLDocument; path: string } | null = null;
  private commentIds = new Map<number, string>();

  private commentsPart(): { doc: XMLDocument; path: string } {
    if (this.comments) return this.comments;
    const out = this.out;
    let path = out.partByRel(out.mainPath, REL.comments);
    let doc = path ? out.xml(path) : null;
    if (!path || !doc) {
      path = out.uniquePath(`${dirOf(out.mainPath)}comments.xml`);
      doc = parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${NS.w}"/>`);
      out.setXml(path, doc);
      out.addRel(out.mainPath, REL.comments, path.slice(dirOf(out.mainPath).length));
      out.ensureContentType(path, COMMENTS_CT);
    }
    this.comments = { doc, path };
    return this.comments;
  }

  /** Writes the comments, numbering them after any the file has. */
  private addComments(list: readonly RedComment[]): void {
    if (!list.length) return;
    const { doc, path } = this.commentsPart();
    let next = 0;
    for (const c of elements(doc.documentElement)) next = Math.max(next, (parseInt(wAttr(c, 'id') ?? '-1', 10) || 0) + 1);
    list.forEach((c, i) => {
      const id = String(next++);
      this.commentIds.set(i, id);
      const author = c.note.author?.trim() || this.author;
      const el = createW(doc, 'comment', {
        id,
        author,
        date: new Date(c.note.date).toISOString().replace(/\.\d+Z$/, 'Z'),
        initials: initials(author),
      });
      c.note.text.split('\n').forEach((line, k) => {
        const p = createW(doc, 'p');
        if (!k) {
          const ref = createW(doc, 'r');
          ref.appendChild(createW(doc, 'annotationRef'));
          p.appendChild(ref);
        }
        const r = createW(doc, 'r');
        appendText(r, line);
        p.appendChild(r);
        el.appendChild(p);
      });
      doc.documentElement.appendChild(el);
    });
    this.out.markDirty(path);
  }

  /** The start of a comment's range, or its end with the comment's mark in the text. */
  private rangeNodes(e: RangeEdge): Node[] {
    const id = this.commentIds.get(e.comment)!;
    if (e.edge === 'start') return [createW(this.doc, 'commentRangeStart', { id })];
    const r = createW(this.doc, 'r');
    r.appendChild(createW(this.doc, 'commentReference', { id }));
    return [createW(this.doc, 'commentRangeEnd', { id }), r];
  }

  /** Comment ranges that start or end at an item's edges: inside its first and last paragraphs. */
  private edges(el: Element | null, edges: readonly RangeEdge[]): Element | null {
    if (!el || !edges.length) return el;
    const ps = isW(el, 'p') ? [el] : descendants(el, NS.w, 'p');
    const first = ps[0];
    const last = ps[ps.length - 1];
    if (!first || !last) return el;
    for (const e of edges) {
      const nodes = this.rangeNodes(e);
      if (e.edge === 'start') {
        const pPr = wChild(first, 'pPr');
        for (const n of nodes) first.insertBefore(n, pPr ? pPr.nextSibling : first.firstChild);
      } else for (const n of nodes) last.appendChild(n);
    }
    return el;
  }

  body(plan: readonly RedItem[], comments: readonly RedComment[]): Node[] {
    this.addComments(comments);
    // Each item's comment range edges: at its edges, or at characters inside it.
    const edges = new Map<number, RangeEdge[]>();
    const exact = new Map<number, RangeAt[]>();
    const add = <T,>(m: Map<number, T[]>, item: number, x: T) => m.set(item, [...(m.get(item) ?? []), x]);
    comments.forEach((c, comment) => {
      const put = (pt: RedPoint, edge: 'start' | 'end') => (pt.at ? add(exact, pt.item, { comment, edge, at: pt.at }) : add(edges, pt.item, { comment, edge }));
      put(c.start, 'start');
      put(c.end, 'end');
    });
    const out: Node[] = [];
    plan.forEach((it, i) => {
      const el = this.item(it, edges.get(i) ?? [], exact.get(i) ?? []);
      if (el) out.push(el);
    });
    return out;
  }
}

/** A comment's range edge at a character of a paragraph's span. */
interface RangeAt extends RangeEdge {
  at: NonNullable<RedPoint['at']>;
}

/** All of a paragraph's text as pieces of one side. */
function wholePieces(p: ParaBlock, side: RedSide, mark?: 'ins' | 'del'): RedPiece[] {
  return p.spans.map((s, span) => ({ side, span, start: 0, end: s.marker ? 0 : s.obj ? 1 : s.text.length, mark }));
}

/** Pieces with comment range edges put in at their characters (split where they fall inside a piece). */
function withEdges(pieces: readonly RedPiece[], edges: readonly RangeAt[]): Laid[] {
  let out: Laid[] = [...pieces];
  // Ends before starts at the same place, so neighbouring ranges don't overlap.
  const sorted = [...edges].sort((x, y) => (x.edge === y.edge ? 0 : x.edge === 'end' ? -1 : 1));
  for (const e of sorted) {
    const { side, span, offset } = e.at;
    const i = out.findIndex(
      (p) => !isEdge(p) && p.side === side && p.span === span && p.start <= offset && offset <= p.end && (e.edge === 'start' ? offset < p.end || p.start === p.end : offset > p.start || p.start === p.end),
    );
    const mark: RangeEdge = { comment: e.comment, edge: e.edge };
    if (i < 0) {
      // Not among the pieces (text shown differently): at the paragraph's start or end.
      out = e.edge === 'start' ? [mark, ...out] : [...out, mark];
      continue;
    }
    const p = out[i] as RedPiece;
    if (offset <= p.start) out.splice(i, 0, mark);
    else if (offset >= p.end) out.splice(i + 1, 0, mark);
    else out.splice(i, 1, { ...p, end: offset }, mark, { ...p, start: offset });
  }
  return out;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .join('')
      .slice(0, 3) || 'C'
  );
}

/** Takes out comment ranges and marks (the comments themselves stay in their own file). */
function dropComments(el: Element): void {
  for (const local of ['commentRangeStart', 'commentRangeEnd']) for (const c of descendants(el, NS.w, local)) c.parentNode?.removeChild(c);
  for (const ref of descendants(el, NS.w, 'commentReference')) {
    const run = ref.parentNode as Element | null;
    if (run && isW(run, 'r')) run.parentNode?.removeChild(run);
    else ref.parentNode?.removeChild(ref);
  }
}

/** Accepts the tracked changes in some content: removed text goes, added text stays, old formatting is forgotten. */
function acceptTracked(el: Element): void {
  const marker = (c: Element) => ['rPr', 'trPr', 'pPr'].includes((c.parentNode as Element | null)?.localName ?? '');
  for (const local of ['del', 'moveFrom']) {
    for (const c of descendants(el, NS.w, local)) {
      if (!c.parentNode) continue;
      // A removed table row goes as a whole.
      if (isW(c.parentNode as Element, 'trPr')) c.parentNode.parentNode?.parentNode?.removeChild(c.parentNode.parentNode);
      else c.parentNode.removeChild(c);
    }
  }
  for (const local of ['ins', 'moveTo']) {
    for (const c of descendants(el, NS.w, local)) {
      if (!c.parentNode) continue;
      if (!marker(c)) while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c);
      c.parentNode.removeChild(c);
    }
  }
  for (const local of ['rPrChange', 'pPrChange', 'trPrChange', 'tblPrChange', 'tcPrChange', 'sectPrChange', 'numberingChange', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd'])
    for (const c of descendants(el, NS.w, local)) c.parentNode?.removeChild(c);
}

/** Whether a run is already a tracked change in its file. */
function tracked(r: Element, stop: Element): boolean {
  for (let n = r.parentNode as Element | null; n && n !== stop.parentNode; n = n.parentNode as Element | null) {
    if (isW(n, 'ins') || isW(n, 'del') || isW(n, 'moveFrom') || isW(n, 'moveTo')) return true;
  }
  return false;
}

/** Turns a run's text into deleted text, as Word keeps it inside a deletion. */
function toDeleted(r: Element): void {
  for (const [from, to] of [
    ['t', 'delText'],
    ['instrText', 'delInstrText'],
  ] as const) {
    for (const t of descendants(r, NS.w, from)) {
      const d = createW(t.ownerDocument, to);
      for (const a of Array.from(t.attributes)) d.setAttributeNS(a.namespaceURI, a.name, a.value);
      while (t.firstChild) d.appendChild(t.firstChild);
      t.parentNode!.replaceChild(d, t);
    }
  }
}

/** The comparison as a Word file with tracked changes: from A (rejected) to B (accepted). */
export function redlineDocx(cmp: Comparison, opts: RedlineOptions = {}): Uint8Array {
  const b = cmp.right;
  // A copy, so the redline's styles and pictures never end up in B itself.
  const out = b.pkg instanceof DocxPackage ? DocxPackage.open(exportDocx(b)) : newPackage(b.name.replace(/\.[^.]+$/, ''));
  const writer = new RedlineWriter(out, cmp, opts);
  const plan = redlinePlan(cmp);
  return out.save(writer.body(plan, redlineComments(cmp, plan, opts.notes ?? [])));
}
