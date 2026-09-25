import type { MergeBackend, MergeContext, SplicePiece, TableRowPlan } from '../../core/merge';
import type { Block, ParaBlock, Span, TableBlock } from '../../core/model';
import { newId } from '../../core/model';
import { Importer } from './importer';
import { DocxPackage } from './package';
import type { DocxBlockX, DocxRowX } from './read';
import { blockX, makeContext, parseBlocks, parseParagraph, parseTable, spanX } from './read';
import { InlineEmitter, generateBlock, generateRow, generateRuns, neighborNumId, spanNodes } from './writer';
import { NS, createW, elements, isW, setWAttr, wAttr, wChild } from './xml';

const MARKER_STARTS = new Set(['bookmarkStart', 'commentRangeStart', 'permStart']);
const MARKER_ENDS = new Set(['bookmarkEnd', 'commentRangeEnd', 'permEnd']);

function targetPkg(ctx: MergeContext): DocxPackage {
  const pkg = ctx.target.pkg;
  if (!(pkg instanceof DocxPackage)) throw new Error('Target is not a Word document');
  return pkg;
}

function sourcePkg(ctx: MergeContext): DocxPackage | undefined {
  return ctx.source.pkg instanceof DocxPackage ? ctx.source.pkg : undefined;
}

/** Parses one freshly built body element of the target back into a block. */
function reparse(el: Element, pkg: DocxPackage, containers: Element[] | undefined): Block {
  const ctx = makeContext(pkg);
  ctx.containers = containers ? [...containers] : [];
  const local = el.namespaceURI === NS.w ? el.localName : '';
  if (local === 'p') return parseParagraph(el, ctx);
  if (local === 'tbl') return parseTable(el, ctx);
  const out: Block[] = [];
  const holder = el.ownerDocument.createElementNS(NS.w, 'w:body');
  holder.appendChild(el);
  parseBlocks(holder, ctx, out);
  holder.removeChild(el);
  if (out.length === 1) return out[0]!;
  return { id: newId('o'), type: 'opaque', label: 'Content', blocks: out, x: { el, containers } satisfies DocxBlockX };
}

function commonPrefix(a: Element[] | undefined, b: Element[] | undefined): Element[] | undefined {
  if (!a || !b) return undefined;
  const out: Element[] = [];
  for (let i = 0; i < a.length && i < b.length && a[i] === b[i]; i++) out.push(a[i]!);
  return out.length ? out : undefined;
}

function containersFor(ctx: MergeContext): Element[] | undefined {
  if (ctx.replacing) return blockX(ctx.replacing)?.containers;
  return commonPrefix(ctx.prev && blockX(ctx.prev)?.containers, ctx.next && blockX(ctx.next)?.containers);
}

function ensurePPr(p: Element): Element {
  let pPr = wChild(p, 'pPr');
  if (!pPr) {
    pPr = createW(p.ownerDocument, 'pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  return pPr;
}

/** Adjusts a paragraph copied into the target so it fits where it lands. */
function fitParagraph(p: Element, ctx: MergeContext, pkg: DocxPackage): void {
  const replaced = ctx.replacing && blockX(ctx.replacing);
  // Keep the replaced paragraph's section break.
  const sect = replaced && isW(replaced.el, 'p') ? wChild(wChild(replaced.el, 'pPr'), 'sectPr') : null;
  if (sect) {
    const pPr = ensurePPr(p);
    const change = wChild(pPr, 'pPrChange');
    pPr.insertBefore(sect.cloneNode(true), change);
  }
  // Continue the list the neighbors belong to.
  const numIdEl = wChild(wChild(wChild(p, 'pPr'), 'numPr'), 'numId');
  if (numIdEl) {
    const numId = wAttr(numIdEl, 'val') ?? '0';
    const ilvl = parseInt(wAttr(wChild(wChild(wChild(p, 'pPr'), 'numPr'), 'ilvl'), 'val') ?? '0', 10) || 0;
    const list = pkg.numbering.list(numId, ilvl);
    if (list) {
      const n = neighborNumId(list, [ctx.replacing, ctx.prev, ctx.next]);
      if (n && n !== numId) setWAttr(numIdEl, 'val', n);
    }
  }
  // Keep bookmarks and comment anchors of the replaced paragraph.
  if (replaced && isW(replaced.el, 'p')) {
    const starts: Node[] = [];
    const ends: Node[] = [];
    for (const el of Array.from(replaced.el.getElementsByTagNameNS(NS.w, '*'))) {
      if (insideTextBox(el, replaced.el)) continue;
      if (MARKER_STARTS.has(el.localName)) starts.push(el.cloneNode(true));
      else if (MARKER_ENDS.has(el.localName)) ends.push(el.cloneNode(true));
      else if (el.localName === 'commentReference' && isW(el.parentNode as Element, 'r')) ends.push((el.parentNode as Element).cloneNode(true));
    }
    const pPr = wChild(p, 'pPr');
    const anchor = pPr ? pPr.nextSibling : p.firstChild;
    for (const n of starts) p.insertBefore(n, anchor);
    for (const n of ends) p.appendChild(n);
  }
}

function insideTextBox(el: Element, stop: Element): boolean {
  for (let n = el.parentNode as Element | null; n && n !== stop; n = n.parentNode as Element | null) {
    if (isW(n, 'txbxContent')) return true;
  }
  return false;
}

function importBlockElement(block: Block, ctx: MergeContext, pkg: DocxPackage): Element | null {
  const src = sourcePkg(ctx);
  const sx = blockX(block);
  if (src && sx) {
    const [node] = Importer.between(src, pkg).importNodes([sx.el], src.mainPath, pkg.mainPath);
    if (node && node.nodeType === 1) return node as Element;
  }
  return generateBlock(block, { pkg, source: ctx.source.id, neighbors: [ctx.replacing, ctx.prev, ctx.next] });
}

/** Model spans for pieces of a paragraph that has no DOCX backing. */
function slicedSpans(block: ParaBlock, pieces: SplicePiece[]): Span[] {
  const out: Span[] = [];
  for (const p of pieces) {
    const s = block.spans[p.span];
    if (!s || s.marker) continue;
    out.push(s.obj ? s : { ...s, text: s.text.slice(p.start, p.end), x: undefined });
  }
  return out;
}

export const docxBackend: MergeBackend = {
  adopt(block, ctx) {
    const pkg = targetPkg(ctx);
    const el = importBlockElement(block, ctx, pkg);
    if (!el) return block;
    if (isW(el, 'p')) fitParagraph(el, ctx, pkg);
    return reparse(el, pkg, containersFor(ctx));
  },

  remove(block, ctx) {
    const pkg = targetPkg(ctx);
    const x = blockX(block);
    // A removed paragraph that ends a section leaves an empty paragraph holding the section break.
    const sect = x && isW(x.el, 'p') ? wChild(wChild(x.el, 'pPr'), 'sectPr') : null;
    if (!x || !sect) return [];
    const p = createW(pkg.main, 'p');
    const pPr = createW(pkg.main, 'pPr');
    pPr.appendChild(sect.cloneNode(true));
    p.appendChild(pPr);
    return [reparse(p, pkg, x.containers)];
  },

  splice(target, source, plan, ctx) {
    const pkg = targetPkg(ctx);
    const tx = blockX(target);
    if (!tx) return target;
    const doc = pkg.main;
    const p = tx.el.cloneNode(false) as Element;
    const pPr = wChild(tx.el, 'pPr');
    if (pPr) p.appendChild(pPr.cloneNode(true));
    const emitter = new InlineEmitter(p);
    const src = sourcePkg(ctx);
    const srcHasXml = !!src && source.spans.some((s) => spanX(s));
    let i = 0;
    while (i < plan.length) {
      const piece = plan[i]!;
      if (piece.from === 't') {
        const span = target.spans[piece.span]!;
        emitter.emit(spanNodes(span, piece.start, piece.end, doc), spanX(span)?.wrap ?? []);
        i++;
        continue;
      }
      let j = i;
      while (j < plan.length && plan[j]!.from === 's') j++;
      const group = plan.slice(i, j);
      i = j;
      if (src && srcHasXml) {
        // Build the pieces inside the source document, then import them with their references.
        const sdoc = src.main;
        const tmp = sdoc.createElementNS(NS.w, 'w:p');
        const semit = new InlineEmitter(tmp);
        for (const g of group) {
          const span = source.spans[g.span]!;
          semit.emit(spanNodes(span, g.start, g.end, sdoc), spanX(span)?.wrap ?? []);
        }
        const nodes = Importer.between(src, pkg).importNodes(Array.from(tmp.childNodes), src.mainPath, pkg.mainPath);
        emitter.emit(nodes, []);
      } else {
        emitter.emit(generateRuns(slicedSpans(source, group), pkg, doc), []);
      }
    }
    return reparse(p, pkg, tx.containers);
  },

  spliceTable(target: TableBlock, _source: TableBlock, plan: TableRowPlan[], ctx) {
    const pkg = targetPkg(ctx);
    const tx = blockX(target);
    if (!tx) return target;
    const tbl = tx.el.cloneNode(false) as Element;
    for (const c of elements(tx.el)) if (isW(c, 'tblPr') || isW(c, 'tblGrid')) tbl.appendChild(c.cloneNode(true));
    const src = sourcePkg(ctx);
    for (const item of plan) {
      const rx = item.row.x as DocxRowX | undefined;
      if (item.from === 't' && rx) {
        tbl.appendChild(rx.el.cloneNode(true));
      } else if (item.from === 's' && src && rx) {
        const [node] = Importer.between(src, pkg).importNodes([rx.el], src.mainPath, pkg.mainPath);
        if (node) tbl.appendChild(node);
      } else {
        tbl.appendChild(generateRow(item.row, { pkg, source: ctx.source.id, neighbors: [] }));
      }
    }
    return reparse(tbl, pkg, tx.containers);
  },
};
