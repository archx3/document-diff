import type { Block, Doc, Fmt, InlineObject, ListInfo, ParaBlock, Span, TableBlock, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, fieldKey, newId } from '../../core/model';
import { ODF, attr, child, is, kids, lengthPx, odfText } from './ns';
import { OdtPackage } from './package';

/** ODT backing of a block. */
export interface OdtBlockX {
  el: Element;
  /** Elements that wrap this block (lists and list items, sections), outermost first. */
  containers?: Element[];
}

/** ODT backing of a span. */
export interface OdtSpanX {
  /** Innermost text:span holding the text (its style gives the formatting), or null for bare text. */
  run: Element | null;
  /** Inline wrappers (links, outer spans, metadata), outermost first. */
  wrap: Element[];
  /** Exact nodes to emit for objects and markers. */
  nodes?: Element[];
}

export interface OdtRowX {
  el: Element;
}

export function blockX(b: Block | undefined): OdtBlockX | undefined {
  const x = b?.x as OdtBlockX | undefined;
  return x && x.el ? x : undefined;
}

export function spanX(s: Span): OdtSpanX | undefined {
  const x = s.x as OdtSpanX | undefined;
  return x && Array.isArray(x.wrap) ? x : undefined;
}

interface ListState {
  key: string;
  style?: string;
  level: number;
}

export interface ReadContext {
  pkg: OdtPackage;
  containers: Element[];
  list?: ListState;
  flags: { tracked: boolean; comments: boolean };
  keyById: Map<string, string>;
  lastKeyByStyle: Map<string, string>;
}

export function makeContext(pkg: OdtPackage): ReadContext {
  return { pkg, containers: [], flags: { tracked: false, comments: false }, keyById: new Map(), lastKeyByStyle: new Map() };
}

export function readOdt(data: Uint8Array, name: string): Doc {
  const pkg = OdtPackage.open(data);
  const ctx = makeContext(pkg);
  const blocks: Block[] = [];
  parseBlocks(pkg.body, ctx, blocks);
  const notes: string[] = [];
  if (ctx.flags.tracked) notes.push('Tracked changes are compared as if they were all accepted, and kept as they are when you export.');
  if (ctx.flags.comments) notes.push('Comments are not compared, but stay in the file.');
  const ext = pkg.flat ? 'fodt' : /template/.test(pkg.mimetype) ? 'ott' : 'odt';
  return { id: newId('d'), name, kind: 'odt', blocks, pkg, notes, version: 0, ext, formatLabel: 'OpenDocument' };
}

/* -------------------------------------------------------------- blocks */

const INDEX_LABELS: Record<string, string> = {
  'table-of-content': 'Table of contents',
  'alphabetical-index': 'Index',
  'illustration-index': 'Table of figures',
  'table-index': 'Table of tables',
  'object-index': 'Table of objects',
  'user-index': 'Index',
  bibliography: 'Bibliography',
};

export function parseBlocks(parent: Element, ctx: ReadContext, out: Block[]): void {
  for (const el of kids(parent)) {
    if (is(el, ODF.text)) {
      switch (el.localName) {
        case 'p':
        case 'h':
          out.push(parseParagraph(el, ctx));
          continue;
        case 'list':
          parseList(el, ctx, out);
          continue;
        case 'section':
          ctx.containers.push(el);
          parseBlocks(el, ctx, out);
          ctx.containers.pop();
          continue;
        case 'numbered-paragraph': {
          const inner = kids(el).find((c) => is(c, ODF.text, 'p') || is(c, ODF.text, 'h'));
          if (!inner) break;
          const level = Math.max(0, (parseInt(attr(el, ODF.text, 'level') ?? '1', 10) || 1) - 1);
          const key = attr(el, ODF.text, 'list-id') ?? newId('L');
          ctx.containers.push(el);
          out.push(parseParagraph(inner, ctx, listInfo(ctx.pkg, attr(el, ODF.text, 'style-name') ?? undefined, level, key, attr(el, ODF.text, 'start-value'))));
          ctx.containers.pop();
          continue;
        }
        case 'tracked-changes':
          if (el.firstElementChild) ctx.flags.tracked = true;
          break;
        case 'change':
        case 'change-start':
        case 'change-end':
          ctx.flags.tracked = true;
          break;
        default:
          if (INDEX_LABELS[el.localName]) {
            out.push(indexBlock(el, ctx));
            continue;
          }
      }
    } else if (is(el, ODF.table, 'table')) {
      out.push(parseTable(el, ctx));
      continue;
    }
    out.push({ id: newId('m'), type: 'marker', x: xOf(el, ctx) });
  }
}

function xOf(el: Element, ctx: ReadContext): OdtBlockX {
  return ctx.containers.length ? { el, containers: [...ctx.containers] } : { el };
}

function indexBlock(el: Element, ctx: ReadContext): Block {
  const inner: Block[] = [];
  const saved = ctx.containers;
  const savedList = ctx.list;
  ctx.containers = [];
  ctx.list = undefined;
  const body = child(el, ODF.text, 'index-body');
  const walk = (parent: Element) => {
    for (const c of kids(parent)) {
      if (is(c, ODF.text, 'index-title')) walk(c);
      else if (is(c, ODF.text, 'p') || is(c, ODF.text, 'h')) inner.push(parseParagraph(c, ctx));
      else if (is(c, ODF.table, 'table')) inner.push(parseTable(c, ctx));
      else if (is(c, ODF.text, 'list')) parseList(c, ctx, inner);
    }
  };
  if (body) walk(body);
  ctx.containers = saved;
  ctx.list = savedList;
  return { id: newId('o'), type: 'opaque', label: INDEX_LABELS[el.localName] ?? 'Index', blocks: inner, x: xOf(el, ctx) };
}

/* --------------------------------------------------------------- lists */

function parseList(listEl: Element, ctx: ReadContext, out: Block[]): void {
  const parent = ctx.list;
  const style = attr(listEl, ODF.text, 'style-name') ?? parent?.style;
  let key: string;
  if (parent) {
    key = parent.key;
  } else {
    const cont = attr(listEl, ODF.text, 'continue-list');
    const prevByStyle = style ? ctx.lastKeyByStyle.get(style) : undefined;
    if (cont && ctx.keyById.has(cont)) key = ctx.keyById.get(cont)!;
    else if (attr(listEl, ODF.text, 'continue-numbering') === 'true' && prevByStyle) key = prevByStyle;
    else key = newId('L');
    if (style) ctx.lastKeyByStyle.set(style, key);
  }
  const id = listEl.getAttributeNS(ODF.xml, 'id');
  if (id) ctx.keyById.set(id, key);
  ctx.pkg.listKeys.set(listEl, key);
  const level = parent ? parent.level + 1 : 0;
  const state: ListState = { key, style, level };
  ctx.containers.push(listEl);
  for (const item of kids(listEl)) {
    const isItem = is(item, ODF.text, 'list-item');
    if (!isItem && !is(item, ODF.text, 'list-header')) {
      out.push({ id: newId('m'), type: 'marker', x: xOf(item, ctx) });
      continue;
    }
    ctx.containers.push(item);
    let first = isItem;
    for (const c of kids(item)) {
      if (is(c, ODF.text, 'p') || is(c, ODF.text, 'h')) {
        ctx.list = undefined;
        const info = first ? listInfo(ctx.pkg, style, level, key, attr(item, ODF.text, 'start-value')) : undefined;
        out.push(parseParagraph(c, ctx, info));
        first = false;
      } else if (is(c, ODF.text, 'list')) {
        ctx.list = state;
        parseList(c, ctx, out);
        first = false;
      } else {
        out.push({ id: newId('m'), type: 'marker', x: xOf(c, ctx) });
      }
    }
    ctx.list = parent;
    ctx.containers.pop();
  }
  ctx.containers.pop();
}

const NUM_FORMATS: Record<string, string> = { '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman', '': 'none' };

interface LevelDef {
  ordered: boolean;
  format: string;
  start: number;
  template: string;
}

export function levelDef(listStyle: Element | undefined, level: number): LevelDef {
  const n = level + 1;
  const el = listStyle ? kids(listStyle).find((c) => c.namespaceURI === ODF.text && attr(c, ODF.text, 'level') === String(n)) : undefined;
  if (!el || el.localName !== 'list-level-style-number') {
    const bullet = el && el.localName === 'list-level-style-bullet' ? (attr(el, ODF.text, 'bullet-char') ?? '') : '';
    return { ordered: false, format: 'bullet', start: 1, template: bullet };
  }
  const f = attr(el, ODF.style, 'num-format') ?? '1';
  const format = NUM_FORMATS[f] ?? (/^[a-z]/.test(f) ? 'lowerLetter' : /^[A-Z]/.test(f) ? 'upperLetter' : 'decimal');
  const start = parseInt(attr(el, ODF.text, 'start-value') ?? '1', 10) || 1;
  let template: string;
  const lo = attr(el, ODF.loext, 'num-list-format');
  if (lo) {
    template = lo.replace(/%(\d+)%/g, '%$1');
  } else {
    const shown = Math.max(1, Math.min(n, parseInt(attr(el, ODF.text, 'display-levels') ?? '1', 10) || 1));
    const parts: string[] = [];
    for (let l = n - shown + 1; l <= n; l++) parts.push(`%${l}`);
    template = (attr(el, ODF.style, 'num-prefix') ?? '') + parts.join('.') + (attr(el, ODF.style, 'num-suffix') ?? '');
  }
  return { ordered: format !== 'none', format, start, template };
}

export function listInfo(pkg: OdtPackage, style: string | undefined, level: number, key: string, startValue: string | null): ListInfo {
  const ls = pkg.styles.listStyle(style)?.el;
  const formats: string[] = [];
  const starts: number[] = [];
  let def: LevelDef | undefined;
  for (let l = 0; l <= level; l++) {
    def = levelDef(ls, l);
    formats.push(def.format);
    starts.push(def.start);
  }
  const info: ListInfo = { ordered: def!.ordered, level, key, formats, starts, template: def!.template };
  if (startValue !== null && startValue !== '') {
    const v = parseInt(startValue, 10);
    if (!Number.isNaN(v)) {
      starts[level] = v;
      info.overrideKey = newId('ov');
    }
  }
  return info;
}

/* ---------------------------------------------------------- paragraphs */

export function parseParagraph(el: Element, ctx: ReadContext, list?: ListInfo): ParaBlock {
  const { pkg } = ctx;
  const styleName = attr(el, ODF.text, 'style-name');
  const st = pkg.styles.para(styleName);
  let role = st.role;
  let level = st.level;
  if (is(el, ODF.text, 'h') && role !== 'title' && role !== 'subtitle') {
    const ol = parseInt(attr(el, ODF.text, 'outline-level') ?? '', 10);
    role = 'h';
    level = ol > 0 ? Math.min(9, ol) : (level ?? 1);
  }
  const direct = pkg.styles.paraDirect(styleName);
  return {
    id: newId('p'),
    type: 'p',
    props: { role, level: role === 'h' || role === 'toc' ? level : undefined, list, align: direct.align, styleName: st.display },
    spans: parseInline(el, ctx, direct.fmt),
    x: xOf(el, ctx),
  };
}

interface Item {
  kind: 'text' | 'atom' | 'marker';
  run: Element | null;
  wrap: Element[];
  fmt: Fmt;
  node?: Element;
  text?: string;
  obj?: InlineObject;
}

/** Field elements and the Word field code they correspond to. */
const FIELD_CODES: Record<string, string> = {
  'page-number': 'PAGE',
  'page-continuation': 'PAGE',
  'page-count': 'NUMPAGES',
  'page-variable-get': 'PAGE',
  date: 'DATE',
  time: 'TIME',
  title: 'TITLE',
  subject: 'SUBJECT',
  keywords: 'KEYWORDS',
  description: 'COMMENTS',
  'author-name': 'AUTHOR',
  'author-initials': 'AUTHOR',
  'initial-creator': 'AUTHOR',
  creator: 'LASTSAVEDBY',
  'creation-date': 'CREATEDATE',
  'creation-time': 'CREATEDATE',
  'modification-date': 'SAVEDATE',
  'modification-time': 'SAVEDATE',
  'print-date': 'PRINTDATE',
  'print-time': 'PRINTDATE',
  'editing-duration': 'EDITTIME',
  'file-name': 'FILENAME',
  'template-name': 'TEMPLATE',
  chapter: 'STYLEREF',
  sequence: 'SEQ',
  'sequence-ref': 'REF',
  'bookmark-ref': 'REF',
  'reference-ref': 'REF',
  'note-ref': 'NOTEREF',
  'word-count': 'NUMWORDS',
  'character-count': 'NUMCHARS',
  'paragraph-count': 'DOCPROPERTY',
  'user-defined': 'DOCPROPERTY',
  'user-field-get': 'DOCVARIABLE',
  'variable-get': 'DOCVARIABLE',
  'variable-set': 'SET',
  'variable-input': 'FILLIN',
  'text-input': 'FILLIN',
  expression: '=',
  placeholder: 'MACROBUTTON',
  'hidden-text': 'IF',
  'conditional-text': 'IF',
  'drop-down': 'FORMDROPDOWN',
  'bibliography-mark': 'CITATION',
  'sender-firstname': 'USERNAME',
  'sender-lastname': 'USERNAME',
  'database-display': 'MERGEFIELD',
};

const MARKERS = new Set([
  'bookmark',
  'bookmark-start',
  'bookmark-end',
  'reference-mark',
  'reference-mark-start',
  'reference-mark-end',
  'toc-mark',
  'toc-mark-start',
  'toc-mark-end',
  'alphabetical-index-mark',
  'alphabetical-index-mark-start',
  'alphabetical-index-mark-end',
  'user-index-mark',
  'user-index-mark-start',
  'user-index-mark-end',
  'soft-page-break',
  'number',
  'hidden-paragraph',
]);

/** Inline content of a paragraph as spans. */
export function parseInline(p: Element, ctx: ReadContext, base: Fmt): Span[] {
  const items: Item[] = [];
  collect(p, null, [], base, ctx, items, { skip: true });
  return itemsToSpans(items);
}

function collect(parent: Element, run: Element | null, wrap: Element[], fmt: Fmt, ctx: ReadContext, items: Item[], ws: { skip: boolean }): void {
  const { pkg } = ctx;
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) {
      // ODF collapses white space: runs become one space, leading space is dropped.
      let text = '';
      for (const ch of n.nodeValue ?? '') {
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          if (!ws.skip) {
            text += ' ';
            ws.skip = true;
          }
        } else {
          text += ch;
          ws.skip = false;
        }
      }
      if (text) items.push({ kind: 'text', run, wrap, fmt, text });
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const local = el.localName;
    if (el.namespaceURI === ODF.text) {
      switch (local) {
        case 's': {
          const c = Math.max(1, parseInt(attr(el, ODF.text, 'c') ?? '1', 10) || 1);
          items.push({ kind: 'text', run, wrap, fmt, text: ' '.repeat(Math.min(c, 1000)) });
          ws.skip = false;
          continue;
        }
        case 'tab':
          items.push({ kind: 'text', run, wrap, fmt, text: '\t' });
          ws.skip = false;
          continue;
        case 'line-break':
          items.push({ kind: 'text', run, wrap, fmt, text: '\n' });
          ws.skip = false;
          continue;
        case 'span': {
          const f = { ...fmt, ...pkg.styles.spanFmt(attr(el, ODF.text, 'style-name')) };
          collect(el, el, run ? [...wrap, run] : wrap, f, ctx, items, ws);
          continue;
        }
        case 'a': {
          const f = { ...fmt, ...pkg.styles.spanFmt(attr(el, ODF.text, 'style-name')) };
          const href = attr(el, ODF.xlink, 'href');
          if (href) f.href = href;
          collect(el, null, run ? [...wrap, run, el] : [...wrap, el], f, ctx, items, ws);
          continue;
        }
        case 'meta':
        case 'meta-field':
          collect(el, null, run ? [...wrap, run, el] : [...wrap, el], fmt, ctx, items, ws);
          continue;
        case 'note':
          items.push({ kind: 'atom', run, wrap, fmt, node: el, obj: noteObj(el) });
          ws.skip = false;
          continue;
        case 'change':
        case 'change-start':
        case 'change-end':
          ctx.flags.tracked = true;
          items.push({ kind: 'marker', run, wrap, fmt, node: el });
          continue;
        case 'ruby': {
          const text = odfText(child(el, ODF.text, 'ruby-base') ?? el);
          items.push({ kind: 'atom', run, wrap, fmt, node: el, obj: { kind: 'field', key: `RUBY|${text}`, label: 'Ruby text', text } });
          ws.skip = false;
          continue;
        }
      }
      if (MARKERS.has(local)) {
        items.push({ kind: 'marker', run, wrap, fmt, node: el });
        continue;
      }
      const code = FIELD_CODES[local];
      const text = odfText(el);
      if (code !== undefined || text) {
        const c = code ?? local.toUpperCase();
        items.push({ kind: 'atom', run, wrap, fmt, node: el, obj: { kind: 'field', key: fieldKey(c, text), label: `Field: ${c}`, text } });
        ws.skip = false;
      } else {
        items.push({ kind: 'marker', run, wrap, fmt, node: el });
      }
      continue;
    }
    if (el.namespaceURI === ODF.office && (local === 'annotation' || local === 'annotation-end')) {
      ctx.flags.comments = true;
      items.push({ kind: 'marker', run, wrap, fmt, node: el });
      continue;
    }
    if (el.namespaceURI === ODF.draw) {
      let f = fmt;
      let frame: Element | null = el;
      if (local === 'a') {
        const href = attr(el, ODF.xlink, 'href');
        if (href) f = { ...fmt, href };
        frame = kids(el).find((c) => c.namespaceURI === ODF.draw) ?? null;
      }
      items.push({ kind: 'atom', run, wrap, fmt: f, node: el, obj: frame ? drawObj(frame, ctx) : { kind: 'object', key: 'obj:link', label: 'Linked object' } });
      ws.skip = false;
      continue;
    }
    // Unknown elements (extensions): keep their text visible when they have any.
    const text = odfText(el);
    if (text) {
      items.push({ kind: 'atom', run, wrap, fmt, node: el, obj: { kind: 'field', key: `${local}|${text}`, label: local, text } });
      ws.skip = false;
    } else {
      items.push({ kind: 'marker', run, wrap, fmt, node: el });
    }
  }
}

function noteObj(el: Element): InlineObject {
  const kind = attr(el, ODF.text, 'note-class') === 'endnote' ? 'endnote' : 'footnote';
  const body = child(el, ODF.text, 'note-body');
  const text = body ? odfText(body).trim() : '';
  return { kind, key: `${kind}:${text}`, label: `${kind === 'footnote' ? 'Footnote' : 'Endnote'}: ${text}`, note: text };
}

function drawObj(el: Element, ctx: ReadContext): InlineObject {
  const { pkg } = ctx;
  const width = lengthPx(attr(el, ODF.svg, 'width'));
  const height = lengthPx(attr(el, ODF.svg, 'height'));
  const title = (child(el, ODF.svg, 'title')?.textContent || child(el, ODF.svg, 'desc')?.textContent || '').trim();
  if (el.localName === 'frame') {
    const obj = child(el, ODF.draw, 'object') ?? child(el, ODF.draw, 'object-ole');
    const img = child(el, ODF.draw, 'image');
    if (obj) {
      const href = (attr(obj, ODF.xlink, 'href') ?? '').replace(/^\.\//, '');
      const inner = pkg.files.get(`${href}/content.xml`);
      const isMath = !!child(obj, ODF.math, 'math') || (!!inner && /<(?:math:)?math\b/.test(new TextDecoder().decode(inner.subarray(0, 4000))));
      const rep = img ? pkg.imageData(img) : undefined;
      if (isMath) {
        const text = (obj.textContent ?? '').trim() || title;
        return { kind: 'math', key: `math:${rep?.hash ?? text}`, label: 'Equation', text };
      }
      return { kind: 'object', key: `obj:${rep?.hash ?? href}`, label: title ? `Embedded object: ${title}` : 'Embedded object' };
    }
    if (img) {
      const data = pkg.imageData(img);
      if (data) {
        return {
          kind: 'image',
          key: `img:${data.hash}`,
          label: title || 'Image',
          src: pkg.imageUrl(data),
          width,
          height,
          data: data.data,
          mime: data.mime,
        };
      }
      const href = attr(img, ODF.xlink, 'href') ?? '';
      return { kind: 'image', key: `img:${href}`, label: title || 'Linked image', width, height };
    }
    const box = child(el, ODF.draw, 'text-box');
    if (box) {
      const text = odfText(box).trim();
      return { kind: 'textbox', key: `textbox:${text}`, label: 'Text box', text };
    }
  }
  const text = odfText(el).trim();
  return { kind: 'object', key: `shape:${el.localName}:${attr(el, ODF.draw, 'name') ?? ''}:${text}`, label: title ? `Shape: ${title}` : 'Shape' };
}

function itemsToSpans(items: Item[]): Span[] {
  const spans: Span[] = [];
  for (const it of items) {
    if (it.kind === 'text') {
      const last = spans[spans.length - 1];
      const lx = last ? (last.x as OdtSpanX | undefined) : undefined;
      if (last && !last.obj && !last.marker && lx && lx.run === it.run && sameWrap(lx.wrap, it.wrap)) last.text += it.text ?? '';
      else spans.push({ text: it.text ?? '', fmt: it.fmt, x: { run: it.run, wrap: it.wrap } satisfies OdtSpanX });
      continue;
    }
    const x: OdtSpanX = { run: it.run, wrap: it.wrap, nodes: it.node ? [it.node] : [] };
    if (it.kind === 'atom' && it.obj) spans.push({ text: OBJ_CHAR, fmt: it.fmt, obj: it.obj, x });
    else spans.push({ text: '', fmt: {}, marker: true, x });
  }
  return spans;
}

function sameWrap(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* -------------------------------------------------------------- tables */

export function parseTable(tbl: Element, ctx: ReadContext): TableBlock {
  const rows: TableRow[] = [];
  const saved = ctx.containers;
  const savedList = ctx.list;
  const x = xOf(tbl, ctx);
  ctx.containers = [];
  ctx.list = undefined;
  // Cells spanning several rows, by the grid column they start in.
  const vspans = new Map<number, { colspan: number; left: number }>();
  const addRow = (tr: Element, header: boolean) => {
    const repeat = Math.min(50, Math.max(1, parseInt(attr(tr, ODF.table, 'number-rows-repeated') ?? '1', 10) || 1));
    for (let r = 0; r < repeat; r++) {
      const cells: TableCell[] = [];
      let col = 0;
      let skipUntil = 0;
      for (const tc of kids(tr)) {
        const covered = is(tc, ODF.table, 'covered-table-cell');
        if (!covered && !is(tc, ODF.table, 'table-cell')) continue;
        const rep = Math.min(64, Math.max(1, parseInt(attr(tc, ODF.table, 'number-columns-repeated') ?? '1', 10) || 1));
        for (let k = 0; k < rep; k++, col++) {
          if (covered) {
            if (col < skipUntil) continue;
            const v = vspans.get(col);
            if (!v) continue;
            const cell: TableCell = { blocks: [], vmerge: 'continue', x: { el: tc } };
            if (v.colspan > 1) cell.colspan = v.colspan;
            cells.push(cell);
            skipUntil = col + v.colspan;
            if (--v.left <= 0) vspans.delete(col);
            continue;
          }
          const cs = Math.max(1, parseInt(attr(tc, ODF.table, 'number-columns-spanned') ?? '1', 10) || 1);
          const rs = Math.max(1, parseInt(attr(tc, ODF.table, 'number-rows-spanned') ?? '1', 10) || 1);
          const blocks: Block[] = [];
          parseBlocks(tc, ctx, blocks);
          const cell: TableCell = { blocks, x: { el: tc } };
          if (cs > 1) cell.colspan = cs;
          if (rs > 1) {
            cell.vmerge = 'restart';
            vspans.set(col, { colspan: cs, left: rs - 1 });
          }
          if (header) cell.header = true;
          cells.push(cell);
          skipUntil = col + cs;
        }
      }
      rows.push({ id: newId('r'), cells, header: header || undefined, x: { el: tr } satisfies OdtRowX });
    }
  };
  const walk = (parent: Element, header: boolean) => {
    for (const el of kids(parent)) {
      if (is(el, ODF.table, 'table-row')) addRow(el, header);
      else if (is(el, ODF.table, 'table-header-rows')) walk(el, true);
      else if (is(el, ODF.table, 'table-rows') || is(el, ODF.table, 'table-row-group')) walk(el, header);
    }
  };
  walk(tbl, false);
  ctx.containers = saved;
  ctx.list = savedList;
  return { id: newId('t'), type: 'table', rows, x };
}

/* ------------------------------------------------------------ reparsing */

/**
 * Parses one body element of `pkg` that sits inside `containers`. List
 * paragraphs take their numbering from the lists in the chain.
 */
export function parseWithin(el: Element, pkg: OdtPackage, containers: Element[] | undefined, listStart: boolean): Block {
  const ctx = makeContext(pkg);
  ctx.containers = containers ? [...containers] : [];
  if (is(el, ODF.text, 'p') || is(el, ODF.text, 'h')) {
    const lists = ctx.containers.filter((c) => is(c, ODF.text, 'list'));
    let info: ListInfo | undefined;
    if (lists.length && listStart) {
      let style: string | undefined;
      for (let i = lists.length - 1; i >= 0 && !style; i--) style = attr(lists[i]!, ODF.text, 'style-name') ?? undefined;
      let key = pkg.listKeys.get(lists[0]!);
      if (!key) {
        key = newId('L');
        pkg.listKeys.set(lists[0]!, key);
      }
      const item = ctx.containers[ctx.containers.length - 1];
      const start = item && is(item, ODF.text, 'list-item') ? attr(item, ODF.text, 'start-value') : null;
      info = listInfo(pkg, style, lists.length - 1, key, start);
    }
    return parseParagraph(el, ctx, info);
  }
  if (is(el, ODF.table, 'table')) return parseTable(el, ctx);
  const out: Block[] = [];
  const holder = el.ownerDocument.createElementNS(ODF.office, 'office:text');
  const parent = el.parentNode;
  const next = el.nextSibling;
  holder.appendChild(el);
  parseBlocks(holder, ctx, out);
  if (parent) parent.insertBefore(el, next);
  else holder.removeChild(el);
  if (out.length === 1) return out[0]!;
  return { id: newId('o'), type: 'opaque', label: 'Content', blocks: out, x: { el, containers } satisfies OdtBlockX };
}
