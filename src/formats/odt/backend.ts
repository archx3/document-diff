import type { MergeBackend, MergeContext, SplicePiece, TableRowPlan } from '../../core/merge';
import type { Block, ParaBlock, Span, TableBlock } from '../../core/model';
import { OdtImporter } from './importer';
import { ODF, attr, create, is, kids, setAttr } from './ns';
import { OdtPackage } from './package';
import type { OdtRowX } from './read';
import { blockX, parseWithin, spanX } from './read';
import { OdtEmitter, generateBlock, generateRow, generateRuns, listId, listStyleFor } from './writer';

function targetPkg(ctx: MergeContext): OdtPackage {
  const pkg = ctx.target.pkg;
  if (!(pkg instanceof OdtPackage)) throw new Error('Target is not an OpenDocument file');
  return pkg;
}

function sourcePkg(ctx: MergeContext): OdtPackage | undefined {
  return ctx.source.pkg instanceof OdtPackage ? ctx.source.pkg : undefined;
}

const isList = (el: Element) => is(el, ODF.text, 'list');
const LIST_PARTS = new Set(['list', 'list-item', 'list-header', 'numbered-paragraph']);

/** The part of a container chain outside any list. */
function outside(chain: Element[] | undefined): Element[] {
  if (!chain) return [];
  const i = chain.findIndex((c) => c.namespaceURI === ODF.text && LIST_PARTS.has(c.localName));
  return i < 0 ? [...chain] : chain.slice(0, i);
}

function commonPrefix(a: Element[] | undefined, b: Element[] | undefined): Element[] {
  if (!a || !b) return [];
  const out: Element[] = [];
  for (let i = 0; i < a.length && i < b.length && a[i] === b[i]; i++) out.push(a[i]!);
  return out;
}

const listMemo = new WeakMap<OdtPackage, Map<string, Element>>();

/** Containers for a block copied into the target: list paragraphs join a neighboring list. */
function chainFor(block: Block, ctx: MergeContext, pkg: OdtPackage): Element[] {
  const doc = pkg.content;
  const around = ctx.replacing ? blockX(ctx.replacing)?.containers : commonPrefix(blockX(ctx.prev)?.containers, blockX(ctx.next)?.containers);
  if (block.type !== 'p' || !block.props.list) return outside(around);
  const list = block.props.list;
  const level = Math.max(0, Math.min(9, list.level));
  const deeper = (chain: Element[], from: number) => {
    for (let l = from; l < level; l++) chain.push(create(doc, ODF.text, 'list'), create(doc, ODF.text, 'list-item'));
    return chain;
  };
  for (const n of [ctx.replacing, ctx.prev, ctx.next]) {
    if (!n || n.type !== 'p' || !n.props.list || n.props.list.ordered !== list.ordered) continue;
    const chain = blockX(n)?.containers;
    if (!chain) continue;
    const lists: number[] = [];
    chain.forEach((c, i) => {
      if (isList(c)) lists.push(i);
    });
    if (!lists.length) continue;
    const nLevel = lists.length - 1;
    if (n === ctx.replacing && level === nLevel) return [...chain];
    if (level > nLevel && n === ctx.prev) {
      // Nest under the previous item.
      return deeper(chain.slice(0, lists[nLevel]! + 2), nLevel);
    }
    const at = lists[Math.min(level, nLevel)]!;
    return deeper([...chain.slice(0, at + 1), create(doc, ODF.text, 'list-item')], Math.min(level, nLevel));
  }
  // No list to join: start one (items of the same source list share it).
  let memo = listMemo.get(pkg);
  if (!memo) listMemo.set(pkg, (memo = new Map()));
  const key = `${ctx.source.id}/${list.key ?? ''}/${list.ordered ? 'o' : 'u'}`;
  let top = memo.get(key);
  if (!top) {
    top = create(doc, ODF.text, 'list');
    const src = sourcePkg(ctx);
    const srcList = src ? blockX(block)?.containers?.find(isList) : undefined;
    const srcStyle = srcList ? attr(srcList, ODF.text, 'style-name') : null;
    const style = src && srcStyle ? OdtImporter.between(src, pkg).mapList(srcStyle) : null;
    setAttr(top, ODF.text, 'style-name', style ?? listStyleFor(pkg, list, ctx.source.id));
    listId(top);
    memo.set(key, top);
  }
  return deeper([...outside(around), top, create(doc, ODF.text, 'list-item')], 0);
}

const ANCHOR_STARTS = new Set(['bookmark', 'bookmark-start', 'reference-mark', 'reference-mark-start']);
const ANCHOR_ENDS = new Set(['bookmark-end', 'reference-mark-end']);

/** Keeps the bookmarks and comments of a replaced paragraph (cross-references and the table of contents point at them). */
function keepAnchors(p: Element, replaced: Element): void {
  const starts: Node[] = [];
  const ends: Node[] = [];
  const walk = (el: Element) => {
    for (const c of kids(el)) {
      if (c.namespaceURI === ODF.text && (c.localName === 'note' || c.localName === 'ruby')) continue;
      if (c.namespaceURI === ODF.draw) continue;
      if (c.namespaceURI === ODF.text && ANCHOR_STARTS.has(c.localName)) starts.push(c.cloneNode(true));
      else if (c.namespaceURI === ODF.text && ANCHOR_ENDS.has(c.localName)) ends.push(c.cloneNode(true));
      else if (is(c, ODF.office, 'annotation')) starts.push(c.cloneNode(true));
      else if (is(c, ODF.office, 'annotation-end')) ends.push(c.cloneNode(true));
      else walk(c);
    }
  };
  walk(replaced);
  const doc = p.ownerDocument;
  for (let i = starts.length - 1; i >= 0; i--) p.insertBefore(doc.importNode(starts[i]!, true), p.firstChild);
  for (const n of ends) p.appendChild(doc.importNode(n, true));
}

function importBlock(block: Block, ctx: MergeContext, pkg: OdtPackage): Element | null {
  const src = sourcePkg(ctx);
  const sx = src ? blockX(block) : undefined;
  if (src && sx) {
    const [node] = OdtImporter.between(src, pkg).importNodes([sx.el]);
    if (node && node.nodeType === 1) return node as Element;
  }
  return generateBlock(block, { pkg, source: ctx.source.id });
}

/** Model spans for pieces of a paragraph that has no ODT backing. */
function slicedSpans(block: ParaBlock, pieces: SplicePiece[]): Span[] {
  const out: Span[] = [];
  for (const p of pieces) {
    const s = block.spans[p.span];
    if (!s || s.marker) continue;
    out.push(s.obj ? s : { ...s, text: s.text.slice(p.start, p.end), x: undefined });
  }
  return out;
}

export const odtBackend: MergeBackend = {
  adopt(block, ctx) {
    const pkg = targetPkg(ctx);
    const el = importBlock(block, ctx, pkg);
    if (!el) return block;
    const replaced = blockX(ctx.replacing);
    if (replaced && (is(el, ODF.text, 'p') || is(el, ODF.text, 'h'))) keepAnchors(el, replaced.el);
    return parseWithin(el, pkg, chainFor(block, ctx, pkg), block.type === 'p' && !!block.props.list);
  },

  remove() {
    return [];
  },

  splice(target, source, plan, ctx) {
    const pkg = targetPkg(ctx);
    const tx = blockX(target);
    if (!tx) return target;
    const p = tx.el.cloneNode(false) as Element;
    const emitter = new OdtEmitter(p);
    const src = sourcePkg(ctx);
    const srcHasXml = !!src && source.spans.some((s) => spanX(s));
    let i = 0;
    while (i < plan.length) {
      const piece = plan[i]!;
      if (piece.from === 't') {
        emitter.emitSpan(target.spans[piece.span]!, piece.start, piece.end);
        i++;
        continue;
      }
      let j = i;
      while (j < plan.length && plan[j]!.from === 's') j++;
      const group = plan.slice(i, j);
      i = j;
      if (src && srcHasXml) {
        // Build the pieces inside the source document, then import them with their styles.
        const tmp = src.content.createElementNS(ODF.text, 'text:p');
        const semit = new OdtEmitter(tmp, emitter.ws);
        for (const g of group) semit.emitSpan(source.spans[g.span]!, g.start, g.end);
        emitter.emit(OdtImporter.between(src, pkg).importNodes(Array.from(tmp.childNodes)), []);
      } else {
        emitter.emit(generateRuns(slicedSpans(source, group), pkg, emitter.ws), []);
      }
    }
    return parseWithin(p, pkg, tx.containers, !!target.props.list);
  },

  spliceTable(target: TableBlock, _source: TableBlock, plan: TableRowPlan[], ctx) {
    const pkg = targetPkg(ctx);
    const tx = blockX(target);
    if (!tx) return target;
    const tbl = tx.el.cloneNode(false) as Element;
    const ROWS = new Set(['table-row', 'table-rows', 'table-header-rows', 'table-row-group']);
    for (const c of kids(tx.el)) if (!(c.namespaceURI === ODF.table && ROWS.has(c.localName))) tbl.appendChild(c.cloneNode(true));
    const src = sourcePkg(ctx);
    let header: Element | null = null;
    let bodyStarted = false;
    for (const item of plan) {
      const rx = item.row.x as OdtRowX | undefined;
      let row: Element | null = null;
      if (item.from === 't' && rx) row = rx.el.cloneNode(true) as Element;
      else if (item.from === 's' && src && rx) row = (OdtImporter.between(src, pkg).importNodes([rx.el])[0] as Element | undefined) ?? null;
      else row = generateRow(item.row, { pkg, source: ctx.source.id });
      if (!row) continue;
      row.removeAttributeNS(ODF.table, 'number-rows-repeated');
      if (item.row.header && !bodyStarted) {
        if (!header) {
          header = create(pkg.content, ODF.table, 'table-header-rows');
          tbl.appendChild(header);
        }
        header.appendChild(row);
      } else {
        bodyStarted = true;
        tbl.appendChild(row);
      }
    }
    return parseWithin(tbl, pkg, tx.containers, false);
  },
};
