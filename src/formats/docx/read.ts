import type { Block, Doc, Fmt, InlineObject, ParaBlock, Span, TableBlock, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, newId } from '../../core/model';
import { DocxPackage, resolveTarget } from './package';
import { runFmt } from './styles';
import { NS, descendants, elements, isEl, isW, plainText, wAttr, wChild, wVal } from './xml';

/** DOCX backing of a block. */
export interface DocxBlockX {
  el: Element;
  /** Block-level content controls / custom XML elements that wrap this block, outermost first. */
  containers?: Element[];
  /** Effective numbering of a list paragraph. */
  numId?: string;
  ilvl?: number;
}

export interface NodeRef {
  run: Element | null;
  node: Element;
}

/** DOCX backing of a span. */
export interface DocxSpanX {
  /** Run that provides the formatting (w:rPr) for text spans. */
  run: Element | null;
  /** Inline wrappers (hyperlink, tracked insertion, content control …), outermost first. */
  wrap: Element[];
  /** Exact nodes to emit for objects and markers. */
  nodes?: NodeRef[];
}

export interface DocxRowX {
  el: Element;
}

export function blockX(b: Block): DocxBlockX | undefined {
  const x = b.x as DocxBlockX | undefined;
  return x && x.el ? x : undefined;
}

export function spanX(s: Span): DocxSpanX | undefined {
  const x = s.x as DocxSpanX | undefined;
  return x && Array.isArray(x.wrap) ? x : undefined;
}

export interface ReadContext {
  pkg: DocxPackage;
  /** Part whose relationships resolve r:id attributes. */
  part: string;
  footnotes: Map<string, Element>;
  endnotes: Map<string, Element>;
  containers: Element[];
  flags: { tracked: boolean };
}

export function makeContext(pkg: DocxPackage): ReadContext {
  return {
    pkg,
    part: pkg.mainPath,
    footnotes: pkg.noteTexts('footnote'),
    endnotes: pkg.noteTexts('endnote'),
    containers: [],
    flags: { tracked: false },
  };
}

export function readDocx(data: ArrayBuffer | Uint8Array, name: string): Doc {
  const pkg = DocxPackage.open(data);
  const ctx = makeContext(pkg);
  const blocks: Block[] = [];
  parseBlocks(pkg.body, ctx, blocks);
  const notes: string[] = [];
  if (ctx.flags.tracked) notes.push('Tracked changes are compared as if they were all accepted, and kept as they are when you export.');
  if (pkg.partByRel(pkg.mainPath, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'))
    notes.push('Comments are not compared, but stay in the file.');
  return { id: newId('d'), name, kind: 'docx', blocks, pkg, notes, version: 0 };
}

/* ------------------------------------------------------------- blocks */

const CONTAINERS = new Set(['sdt', 'customXml']);

const BLOCK_PROPS = new Set(['tcPr', 'trPr', 'tblPr', 'tblGrid', 'sdtPr', 'sdtEndPr', 'customXmlPr']);

export function parseBlocks(parent: Element, ctx: ReadContext, out: Block[]): void {
  for (const el of elements(parent)) {
    if (el.namespaceURI === NS.w) {
      if (BLOCK_PROPS.has(el.localName)) continue;
      switch (el.localName) {
        case 'p':
          out.push(parseParagraph(el, ctx));
          continue;
        case 'tbl':
          out.push(parseTable(el, ctx));
          continue;
        case 'sectPr':
          if (el === ctx.pkg.finalSectPr) continue;
          break;
        case 'altChunk':
          out.push({ id: newId('o'), type: 'opaque', label: 'Embedded document', blocks: [], x: xOf(el, ctx) });
          continue;
      }
      if (CONTAINERS.has(el.localName)) {
        if (el.localName === 'sdt' && isOpaqueSdt(el)) {
          const inner: Block[] = [];
          const saved = ctx.containers;
          ctx.containers = [];
          parseBlocks(wChild(el, 'sdtContent') ?? el, ctx, inner);
          ctx.containers = saved;
          out.push({ id: newId('o'), type: 'opaque', label: sdtLabel(el), blocks: inner, x: xOf(el, ctx) });
          continue;
        }
        ctx.containers.push(el);
        parseBlocks(el.localName === 'sdt' ? (wChild(el, 'sdtContent') ?? el) : el, ctx, out);
        ctx.containers.pop();
        continue;
      }
      if (el.localName === 'ins' || el.localName === 'del') ctx.flags.tracked = true;
    }
    out.push({ id: newId('m'), type: 'marker', x: xOf(el, ctx) });
  }
}

function xOf(el: Element, ctx: ReadContext): DocxBlockX {
  return ctx.containers.length ? { el, containers: [...ctx.containers] } : { el };
}

function isOpaqueSdt(sdt: Element): boolean {
  const pr = wChild(sdt, 'sdtPr');
  const gallery = wAttr(wChild(wChild(pr, 'docPartObj'), 'docPartGallery') ?? wChild(wChild(pr, 'docPartList'), 'docPartGallery'), 'val');
  return !!gallery && /table of contents|bibliograph/i.test(gallery);
}

function sdtLabel(sdt: Element): string {
  const pr = wChild(sdt, 'sdtPr');
  const gallery = wAttr(wChild(wChild(pr, 'docPartObj'), 'docPartGallery'), 'val');
  if (gallery && /table of contents/i.test(gallery)) return 'Table of contents';
  if (gallery && /bibliograph/i.test(gallery)) return 'Bibliography';
  return wVal(pr, 'alias') ?? 'Content control';
}

/* ---------------------------------------------------------- paragraphs */

export function parseParagraph(p: Element, ctx: ReadContext): ParaBlock {
  const { pkg } = ctx;
  const pPr = wChild(p, 'pPr');
  const st = pkg.styles.para(wVal(pPr, 'pStyle'));
  let role = st.role;
  let level = st.level;
  const outline = wVal(pPr, 'outlineLvl');
  if (role === 'p' && outline !== null) {
    const n = parseInt(outline, 10);
    if (n >= 0 && n < 9) {
      role = 'h';
      level = n + 1;
    }
  }
  let numId = st.numId;
  let ilvl = st.ilvl ?? 0;
  const numPr = wChild(pPr, 'numPr');
  if (numPr) {
    const id = wVal(numPr, 'numId');
    if (id !== null) numId = id;
    const lv = wVal(numPr, 'ilvl');
    if (lv !== null) ilvl = parseInt(lv, 10) || 0;
  }
  const list = numId ? pkg.numbering.list(numId, ilvl, (sid) => pkg.styles.para(sid).numId) : undefined;
  const jc = wVal(pPr, 'jc');
  const align =
    jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : undefined;
  const x: DocxBlockX = { el: p };
  if (ctx.containers.length) x.containers = [...ctx.containers];
  if (list) {
    x.numId = numId;
    x.ilvl = ilvl;
  }
  return {
    id: newId('p'),
    type: 'p',
    props: { role, level: role === 'h' || role === 'toc' ? level : undefined, list, align, styleName: st.name },
    spans: parseInline(p, ctx),
    x,
  };
}

interface Item {
  kind: 'text' | 'atom' | 'marker' | 'fldBegin' | 'fldSep' | 'fldEnd' | 'instr';
  run: Element | null;
  node: Element;
  wrap: Element[];
  fmt: Fmt;
  text?: string;
  obj?: InlineObject;
  /** For a collapsed field: every item from begin to end. */
  group?: Item[];
}

const WRAPPERS = new Set(['hyperlink', 'ins', 'moveTo', 'smartTag', 'customXml', 'dir', 'bdo', 'sdt']);
const WRAPPER_PROPS = new Set(['smartTagPr', 'customXmlPr', 'sdtPr', 'sdtEndPr']);

/** Inline content of a paragraph (or any element holding runs) as spans. */
export function parseInline(parent: Element, ctx: ReadContext): Span[] {
  const items: Item[] = [];
  collectInline(elements(parent), [], ctx, items, undefined);
  return itemsToSpans(groupFields(items));
}

function hyperlinkHref(el: Element, ctx: ReadContext): string | undefined {
  const rid = el.getAttributeNS(NS.r, 'id');
  const anchor = wAttr(el, 'anchor');
  if (rid) {
    const rel = ctx.pkg.rels(ctx.part).get(rid);
    if (rel) return rel.target + (anchor ? '#' + anchor : '');
  }
  return anchor ? '#' + anchor : undefined;
}

function collectInline(children: Element[], wrap: Element[], ctx: ReadContext, items: Item[], link: string | undefined): void {
  for (const el of children) {
    if (el.namespaceURI === NS.w) {
      const n = el.localName;
      if (n === 'pPr') continue;
      if (n === 'r') {
        collectRun(el, wrap, ctx, items, link);
        continue;
      }
      if (WRAPPERS.has(n)) {
        if (n === 'ins' || n === 'moveTo') ctx.flags.tracked = true;
        const inner = n === 'sdt' ? wChild(el, 'sdtContent') : el;
        if (!inner) {
          items.push({ kind: 'marker', run: null, node: el, wrap, fmt: {} });
          continue;
        }
        // Content sits directly inside the wrapper, next to its property elements.
        const kids = elements(inner).filter((c) => !(c.namespaceURI === NS.w && WRAPPER_PROPS.has(c.localName)));
        collectInline(kids, [...wrap, el], ctx, items, n === 'hyperlink' ? (hyperlinkHref(el, ctx) ?? link) : link);
        continue;
      }
      if (n === 'fldSimple') {
        const instr = (wAttr(el, 'instr') ?? '').trim();
        const text = plainText(el);
        items.push({ kind: 'atom', run: null, node: el, wrap, fmt: fieldFmt(instr, {}), obj: fieldObj(instr, text) });
        continue;
      }
      if (n === 'del' || n === 'moveFrom') ctx.flags.tracked = true;
      items.push({ kind: 'marker', run: null, node: el, wrap, fmt: {} });
      continue;
    }
    if (isEl(el, NS.m, 'oMath') || isEl(el, NS.m, 'oMathPara')) {
      const text = plainText(el);
      items.push({ kind: 'atom', run: null, node: el, wrap, fmt: {}, obj: { kind: 'math', key: 'math:' + text, label: 'Equation', text } });
      continue;
    }
    if (isEl(el, NS.mc, 'AlternateContent')) {
      items.push({ kind: 'atom', run: null, node: el, wrap, fmt: {}, obj: drawingObj(el, ctx) });
      continue;
    }
    items.push({ kind: 'marker', run: null, node: el, wrap, fmt: {} });
  }
}

function fieldFmt(instr: string, base: Fmt): Fmt {
  const m = /^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(instr);
  if (!m) return base;
  const url = /\\l\s+"/i.test(instr) ? '#' + m[1] : m[1]!;
  return { ...base, href: url };
}

function fieldObj(instr: string, text: string): InlineObject {
  const code = instr.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  return { kind: 'field', key: `${code}|${text}`, label: code ? `Field: ${code}` : 'Field', text };
}

const TEXT_CHILD: Record<string, string> = {
  tab: '\t',
  ptab: '\t',
  cr: '\n',
  noBreakHyphen: '‑',
  softHyphen: '\u00ad',
};

function collectRun(r: Element, wrap: Element[], ctx: ReadContext, items: Item[], link: string | undefined): void {
  const rPr = wChild(r, 'rPr');
  const fmt: Fmt = { ...ctx.pkg.styles.charFmt(wVal(rPr, 'rStyle')), ...runFmt(rPr, true) };
  if (link) fmt.href = link;
  for (const c of elements(r)) {
    if (c.namespaceURI === NS.w) {
      const n = c.localName;
      if (n === 'rPr' || n === 'lastRenderedPageBreak' || n === 'delText') continue;
      if (n === 't') {
        items.push({ kind: 'text', run: r, node: c, wrap, fmt, text: c.textContent ?? '' });
        continue;
      }
      const ch = TEXT_CHILD[n];
      if (ch !== undefined) {
        items.push({ kind: 'text', run: r, node: c, wrap, fmt, text: ch });
        continue;
      }
      if (n === 'br') {
        const type = wAttr(c, 'type');
        if (type === 'page' || type === 'column') {
          const label = type === 'page' ? 'Page break' : 'Column break';
          items.push({ kind: 'atom', run: r, node: c, wrap, fmt, obj: { kind: 'pagebreak', key: type, label } });
        } else {
          items.push({ kind: 'text', run: r, node: c, wrap, fmt, text: '\n' });
        }
        continue;
      }
      if (n === 'sym') {
        const code = parseInt(wAttr(c, 'char') ?? '0', 16) || 0;
        const font = wAttr(c, 'font') ?? '';
        const shown = String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code);
        items.push({ kind: 'atom', run: r, node: c, wrap, fmt, obj: { kind: 'symbol', key: `${font}:${code}`, label: `Symbol (${font})`, text: shown } });
        continue;
      }
      if (n === 'drawing' || n === 'pict' || n === 'object') {
        items.push({ kind: 'atom', run: r, node: c, wrap, fmt, obj: drawingObj(c, ctx) });
        continue;
      }
      if (n === 'footnoteReference' || n === 'endnoteReference') {
        const kind = n === 'footnoteReference' ? 'footnote' : 'endnote';
        const id = wAttr(c, 'id') ?? '';
        const note = (kind === 'footnote' ? ctx.footnotes : ctx.endnotes).get(id);
        const text = note ? plainText(note).trim() : '';
        items.push({
          kind: 'atom',
          run: r,
          node: c,
          wrap,
          fmt,
          obj: { kind, key: `${kind}:${text}`, label: `${kind === 'footnote' ? 'Footnote' : 'Endnote'}: ${text}`, note: text },
        });
        continue;
      }
      if (n === 'fldChar') {
        const t = wAttr(c, 'fldCharType');
        items.push({ kind: t === 'begin' ? 'fldBegin' : t === 'separate' ? 'fldSep' : 'fldEnd', run: r, node: c, wrap, fmt });
        continue;
      }
      if (n === 'instrText') {
        items.push({ kind: 'instr', run: r, node: c, wrap, fmt, text: c.textContent ?? '' });
        continue;
      }
      items.push({ kind: 'marker', run: r, node: c, wrap, fmt });
      continue;
    }
    if (isEl(c, NS.mc, 'AlternateContent')) {
      items.push({ kind: 'atom', run: r, node: c, wrap, fmt, obj: drawingObj(c, ctx) });
      continue;
    }
    items.push({ kind: 'marker', run: r, node: c, wrap, fmt });
  }
}

/**
 * Collapses complete complex fields (begin … separate … end within this
 * paragraph) into a single atom showing the field result. Parts of fields
 * that cross paragraphs become markers so they survive untouched.
 */
function groupFields(items: Item[]): Item[] {
  const out: Item[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i]!;
    if (it.kind !== 'fldBegin') {
      if (it.kind === 'fldSep' || it.kind === 'fldEnd' || it.kind === 'instr') out.push({ ...it, kind: 'marker' });
      else out.push(it);
      i++;
      continue;
    }
    let depth = 0;
    let end = -1;
    let sep = -1;
    for (let j = i; j < items.length; j++) {
      const k = items[j]!.kind;
      if (k === 'fldBegin') depth++;
      else if (k === 'fldSep' && depth === 1 && sep < 0) sep = j;
      else if (k === 'fldEnd') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) {
      out.push({ ...it, kind: 'marker' });
      i++;
      continue;
    }
    let instr = '';
    let text = '';
    const resultFrom = sep < 0 ? end : sep;
    for (let j = i + 1; j < resultFrom; j++) if (items[j]!.kind === 'instr' && depthAt(items, i, j) === 1) instr += items[j]!.text;
    for (let j = resultFrom + 1; j < end; j++) if (items[j]!.kind === 'text') text += items[j]!.text;
    const group = items.slice(i, end + 1);
    const obj = fieldObj(instr, text);
    // Carry any drawing inside the result (e.g. an INCLUDEPICTURE field) as the object shown.
    const pic = group.find((g) => g.kind === 'atom' && g.obj?.kind === 'image');
    out.push({
      kind: 'atom',
      run: it.run,
      node: it.node,
      wrap: it.wrap,
      fmt: fieldFmt(instr, group.find((g) => g.kind === 'text')?.fmt ?? it.fmt),
      obj: pic?.obj ? { ...pic.obj, key: `${obj.key}|${pic.obj.key}` } : obj,
      group,
    });
    i = end + 1;
  }
  return out;
}

function depthAt(items: Item[], from: number, at: number): number {
  let d = 0;
  for (let j = from; j < at; j++) {
    const k = items[j]!.kind;
    if (k === 'fldBegin') d++;
    else if (k === 'fldEnd') d--;
  }
  return d;
}

function itemsToSpans(items: Item[]): Span[] {
  const spans: Span[] = [];
  for (const it of items) {
    if (it.kind === 'text') {
      const last = spans[spans.length - 1];
      const lx = last ? spanX(last) : undefined;
      if (last && !last.obj && !last.marker && lx && lx.run === it.run && sameWrap(lx.wrap, it.wrap)) {
        last.text += it.text ?? '';
      } else {
        spans.push({ text: it.text ?? '', fmt: it.fmt, x: { run: it.run, wrap: it.wrap } satisfies DocxSpanX });
      }
      continue;
    }
    const group = it.group;
    const nodes: NodeRef[] = group ? group.map((g) => ({ run: g.run, node: g.node })) : [{ run: it.run, node: it.node }];
    if (it.kind === 'atom' && it.obj) {
      spans.push({ text: OBJ_CHAR, fmt: it.fmt, obj: it.obj, x: { run: it.run, wrap: it.wrap, nodes } satisfies DocxSpanX });
    } else {
      spans.push({ text: '', fmt: {}, marker: true, x: { run: it.run, wrap: it.wrap, nodes } satisfies DocxSpanX });
    }
  }
  return spans;
}

function sameWrap(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ------------------------------------------------------------ objects */

const EMU_PER_PX = 9525;

function drawingObj(node: Element, ctx: ReadContext): InlineObject {
  const { pkg } = ctx;
  const extent = descendants(node, NS.wp, 'extent')[0];
  const width = extent ? Math.round(parseInt(extent.getAttribute('cx') ?? '0', 10) / EMU_PER_PX) : undefined;
  const height = extent ? Math.round(parseInt(extent.getAttribute('cy') ?? '0', 10) / EMU_PER_PX) : undefined;
  const docPr = descendants(node, NS.wp, 'docPr')[0];
  const alt = docPr?.getAttribute('descr') || docPr?.getAttribute('title') || '';

  let rid: string | null = null;
  const blip = descendants(node, NS.a, 'blip')[0];
  if (blip) rid = blip.getAttributeNS(NS.r, 'embed') || blip.getAttributeNS(NS.r, 'link');
  if (!rid) {
    const img = descendants(node, NS.v, 'imagedata')[0];
    if (img) rid = img.getAttributeNS(NS.r, 'id') || img.getAttributeNS(NS.o, 'relid');
  }
  if (rid) {
    const rel = pkg.rels(ctx.part).get(rid);
    if (rel && !rel.external) {
      const path = resolveTarget(ctx.part, rel.target);
      const hash = pkg.hashOf(path) ?? path;
      return {
        kind: 'image',
        key: `img:${hash}`,
        label: alt || 'Image',
        src: pkg.imageUrl(path),
        width: width || undefined,
        height: height || undefined,
        data: pkg.files.get(path),
        mime: pkg.contentType(path),
      };
    }
    if (rel?.external) return { kind: 'image', key: `img:${rel.target}`, label: alt || 'Linked image', width, height };
  }
  const box = descendants(node, NS.w, 'txbxContent')[0];
  if (box) {
    const text = plainText(box).trim();
    return { kind: 'textbox', key: `textbox:${text}`, label: 'Text box', text };
  }
  const gd = descendants(node, NS.a, 'graphicData')[0];
  const uri = gd?.getAttribute('uri') ?? '';
  const label = /chart/.test(uri) ? 'Chart' : /diagram/.test(uri) ? 'Diagram' : /wordprocessingShape|shape/i.test(uri) ? 'Shape' : 'Embedded object';
  return { kind: 'object', key: `obj:${uri}:${docPr?.getAttribute('name') ?? ''}:${plainText(node).trim()}`, label: alt ? `${label}: ${alt}` : label };
}

/* -------------------------------------------------------------- tables */

export function parseTable(tbl: Element, ctx: ReadContext): TableBlock {
  const rows: TableRow[] = [];
  const saved = ctx.containers;
  ctx.containers = [];
  const addRow = (tr: Element) => {
    const trPr = wChild(tr, 'trPr');
    const cells: TableCell[] = [];
    for (const tc of elements(tr)) {
      if (!isW(tc, 'tc')) continue;
      const tcPr = wChild(tc, 'tcPr');
      const span = parseInt(wVal(tcPr, 'gridSpan') ?? '1', 10) || 1;
      const vm = wChild(tcPr, 'vMerge');
      const blocks: Block[] = [];
      parseBlocks(tc, ctx, blocks);
      const cell: TableCell = { blocks, x: { el: tc } };
      if (span > 1) cell.colspan = span;
      if (vm) cell.vmerge = wAttr(vm, 'val') === 'restart' ? 'restart' : 'continue';
      cells.push(cell);
    }
    rows.push({ id: newId('r'), cells, header: !!wChild(trPr, 'tblHeader'), x: { el: tr } satisfies DocxRowX });
  };
  const walk = (parent: Element) => {
    for (const el of elements(parent)) {
      if (isW(el, 'tr')) addRow(el);
      else if (isW(el, 'sdt')) walk(wChild(el, 'sdtContent') ?? el);
      else if (isW(el, 'customXml')) walk(el);
    }
  };
  walk(tbl);
  ctx.containers = saved;
  const x: DocxBlockX = { el: tbl };
  if (ctx.containers.length) x.containers = [...ctx.containers];
  return { id: newId('t'), type: 'table', rows, x };
}
