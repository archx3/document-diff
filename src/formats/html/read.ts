import type { Block, Doc, DocKind, Fmt, InlineObject, ListInfo, ParaBlock, ParaProps, Role, Span, TableCell, TableRow } from '../../core/model';
import { OBJ_CHAR, hashBytes, newId, normalizeSpans } from '../../core/model';

/**
 * Converts HTML (a file, or rich text pasted from Google Docs, Word or a web
 * page) into the document model.
 */

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'ul',
]);

const SKIP_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'noscript', 'template', 'svg', 'object', 'iframe', 'button', 'select', 'input', 'textarea']);

/** Parses an inline style attribute (keeps properties that CSSOM would drop, like mso-list). */
function styleMap(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  const raw = el.getAttribute('style');
  if (!raw) return map;
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim().toLowerCase());
  }
  return map;
}

interface ListCtx {
  ordered: boolean;
  key: string;
  start?: number;
}

interface Ctx {
  fmt: Fmt;
  role: Role | null;
  preserve: boolean;
  lists: ListCtx[];
}

function elementFmt(el: Element, base: Fmt, style: Map<string, string>): Fmt {
  const f: Fmt = { ...base };
  switch (el.localName) {
    case 'b':
    case 'strong':
      f.b = true;
      break;
    case 'i':
    case 'em':
    case 'cite':
    case 'dfn':
    case 'var':
      f.i = true;
      break;
    case 'u':
    case 'ins':
      f.u = true;
      break;
    case 's':
    case 'strike':
    case 'del':
      f.s = true;
      break;
    case 'sup':
      f.sup = true;
      f.sub = false;
      break;
    case 'sub':
      f.sub = true;
      f.sup = false;
      break;
    case 'code':
    case 'tt':
    case 'kbd':
    case 'samp':
      f.code = true;
      break;
    case 'mark':
      f.hl = 'yellow';
      break;
    case 'a': {
      const href = el.getAttribute('href');
      if (href && !/^\s*javascript:/i.test(href)) f.href = href.trim();
      break;
    }
  }
  const weight = style.get('font-weight');
  if (weight) {
    const n = parseInt(weight, 10);
    if (weight === 'bold' || weight === 'bolder' || n >= 600) f.b = true;
    else if (weight === 'normal' || weight === 'lighter' || (n > 0 && n < 600)) f.b = false;
  }
  const fs = style.get('font-style');
  if (fs) f.i = fs === 'italic' || fs === 'oblique';
  const deco = style.get('text-decoration') ?? style.get('text-decoration-line');
  if (deco) {
    if (deco.includes('none')) {
      f.u = false;
      f.s = false;
    }
    if (deco.includes('underline')) f.u = true;
    if (deco.includes('line-through')) f.s = true;
  }
  const va = style.get('vertical-align');
  if (va === 'super') {
    f.sup = true;
    f.sub = false;
  } else if (va === 'sub') {
    f.sub = true;
    f.sup = false;
  } else if (va === 'baseline') {
    f.sup = false;
    f.sub = false;
  }
  const family = style.get('font-family');
  if (family && /monospace|courier|consolas|menlo|mono\b/.test(family)) f.code = true;
  const bg = style.get('background-color') ?? style.get('background');
  if (bg && /^(#ff0|#ffff00|yellow|rgb\(255,\s*255,\s*0\))/.test(bg)) f.hl = 'yellow';
  return f;
}

function containsBlock(el: Element): boolean {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const tag = c.localName;
    if (BLOCK_TAGS.has(tag)) return true;
    if (!SKIP_TAGS.has(tag) && containsBlock(c)) return true;
  }
  return false;
}

function decodeDataUrl(src: string): { data: Uint8Array; mime: string } | undefined {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return undefined;
  try {
    if (m[2]) {
      const bin = atob(m[3]!.replace(/\s+/g, ''));
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      return { data, mime: m[1]! };
    }
    return { data: new TextEncoder().encode(decodeURIComponent(m[3]!)), mime: m[1]! };
  } catch {
    return undefined;
  }
}

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function imageObject(el: Element, style: Map<string, string>): InlineObject {
  const src = el.getAttribute('src') ?? '';
  const alt = el.getAttribute('alt') ?? el.getAttribute('title') ?? '';
  const px = (v: string | null | undefined) => {
    if (!v) return undefined;
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return undefined;
    return /pt$/.test(v) ? Math.round((n * 96) / 72) : Math.round(n);
  };
  const width = px(el.getAttribute('width')) ?? px(style.get('width'));
  const height = px(el.getAttribute('height')) ?? px(style.get('height'));
  const decoded = src.startsWith('data:') ? decodeDataUrl(src) : undefined;
  return {
    kind: 'image',
    key: 'img:' + (decoded ? hashBytes(decoded.data) : hashString(src)),
    label: alt || 'Image',
    src: src || undefined,
    width,
    height,
    data: decoded?.data,
    mime: decoded?.mime,
  };
}

class Builder {
  readonly out: Block[] = [];
  private spans: Span[] | null = null;
  private props: ParaProps | null = null;
  /** List item waiting for its first paragraph. */
  pendingList: ListInfo | null = null;

  isOpen(): boolean {
    return this.spans !== null;
  }

  open(props: ParaProps): void {
    this.close();
    if (this.pendingList) {
      props = { ...props, list: this.pendingList };
      this.pendingList = null;
    }
    this.props = props;
    this.spans = [];
  }

  ensureOpen(ctx: Ctx): Span[] {
    if (!this.spans) this.open({ role: ctx.role ?? 'p' });
    return this.spans!;
  }

  add(span: Span, ctx: Ctx): void {
    this.ensureOpen(ctx).push(span);
  }

  close(): void {
    if (!this.spans || !this.props) return;
    const spans = trimSpans(normalizeSpans(this.spans));
    this.out.push({ id: newId('p'), type: 'p', props: this.props, spans } satisfies ParaBlock);
    this.spans = null;
    this.props = null;
  }

  push(block: Block): void {
    this.close();
    this.out.push(block);
  }
}

/** Drops whitespace at the start and end of a paragraph (including trailing line breaks). */
function trimSpans(spans: Span[]): Span[] {
  const out = spans.slice();
  while (out.length && !out[0]!.obj) {
    const t = out[0]!.text.replace(/^[ \t\n\r]+/, '');
    if (t) {
      out[0] = { ...out[0]!, text: t };
      break;
    }
    out.shift();
  }
  while (out.length && !out[out.length - 1]!.obj) {
    const last = out[out.length - 1]!;
    const t = last.text.replace(/[ \t\n\r]+$/, '');
    if (t) {
      out[out.length - 1] = { ...last, text: t };
      break;
    }
    out.pop();
  }
  return out;
}

function alignOf(el: Element, style: Map<string, string>): ParaProps['align'] {
  const a = style.get('text-align') ?? el.getAttribute('align')?.toLowerCase();
  if (a === 'center') return 'center';
  if (a === 'right' || a === 'end') return 'right';
  if (a === 'justify') return 'justify';
  return undefined;
}

const ORDERED_STYLE = /decimal|alpha|roman|latin|greek|armenian|georgian|cjk|hebrew|kana|hiragana|katakana|upper|lower/;

function listFormat(type: string | undefined, ordered: boolean): string {
  if (!ordered) return 'bullet';
  if (!type) return 'decimal';
  if (/lower-(alpha|latin)|^a$/.test(type)) return 'lowerLetter';
  if (/upper-(alpha|latin)|^A$/.test(type)) return 'upperLetter';
  if (/lower-roman|^i$/.test(type)) return 'lowerRoman';
  if (/upper-roman|^I$/.test(type)) return 'upperRoman';
  return 'decimal';
}

function walkChildren(parent: Element, ctx: Ctx, b: Builder): void {
  for (let n = parent.firstChild; n; n = n.nextSibling) walk(n, ctx, b);
}

function walk(node: Node, ctx: Ctx, b: Builder): void {
  if (node.nodeType === 3) {
    let text = node.nodeValue ?? '';
    if (!ctx.preserve) text = text.replace(/[\t\n\r ]+/g, ' ');
    if (!text) return;
    // Whitespace-only text between blocks does not start a paragraph.
    if (!text.trim() && !b.isOpen()) return;
    b.add({ text, fmt: ctx.fmt }, ctx);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.localName;
  if (SKIP_TAGS.has(tag) || tag.includes(':')) return; // o:p, v:shape, w:… from Word
  const style = styleMap(el);
  if (style.get('display') === 'none' || /mso-list:\s*ignore/i.test(el.getAttribute('style') ?? '')) return;
  const preserve = ctx.preserve || /^pre/.test(style.get('white-space') ?? '');

  switch (tag) {
    case 'br':
      b.add({ text: '\n', fmt: ctx.fmt }, ctx);
      return;
    case 'img':
      b.add({ text: OBJ_CHAR, fmt: ctx.fmt, obj: imageObject(el, style) }, ctx);
      return;
    case 'hr':
      b.close();
      return;
    case 'table':
      b.push(readTable(el, ctx));
      return;
    case 'ul':
    case 'ol':
    case 'menu':
    case 'dir': {
      b.close();
      const start = parseInt(el.getAttribute('start') ?? '', 10);
      const lists = [...ctx.lists, { ordered: tag === 'ol', key: newId('l'), start: isFinite(start) ? start : undefined }];
      walkChildren(el, { ...ctx, lists }, b);
      b.close();
      return;
    }
    case 'li': {
      b.close();
      const list = ctx.lists[ctx.lists.length - 1] ?? { ordered: false, key: newId('l') };
      const type = style.get('list-style-type') ?? el.parentElement?.getAttribute('type') ?? undefined;
      const ordered = type ? ORDERED_STYLE.test(type) || /^[aAiI1]$/.test(type) : list.ordered;
      const aria = parseInt(el.getAttribute('aria-level') ?? '', 10);
      const level = isFinite(aria) && aria > 0 ? aria - 1 : Math.max(0, ctx.lists.length - 1);
      const formats: string[] = [];
      formats[level] = listFormat(type, ordered);
      const starts: number[] = [];
      if (list.start !== undefined) starts[level] = list.start;
      b.pendingList = { ordered, level, key: list.key, formats, starts };
      walkChildren(el, { ...ctx, fmt: elementFmt(el, ctx.fmt, style), preserve }, b);
      if (b.pendingList) {
        // An empty list item still counts.
        b.open({ role: 'p' });
      }
      b.close();
      return;
    }
  }

  if (/^h[1-6]$/.test(tag)) {
    b.open({ role: 'h', level: parseInt(tag[1]!, 10), align: alignOf(el, style) });
    walkChildren(el, { ...ctx, fmt: elementFmt(el, ctx.fmt, style), preserve }, b);
    b.close();
    return;
  }

  if (BLOCK_TAGS.has(tag)) {
    const cls = (el.getAttribute('class') ?? '').toLowerCase();
    let role: Role | null = ctx.role;
    if (tag === 'blockquote') role = 'quote';
    else if (tag === 'pre') role = 'code';
    else if (/msotitle|\btitle\b/.test(cls)) role = 'title';
    else if (/msosubtitle|\bsubtitle\b/.test(cls)) role = 'subtitle';
    else if (/msoquote|msointensequote/.test(cls)) role = 'quote';
    else if (/msocaption|figcaption/.test(cls) || tag === 'figcaption') role = 'caption';
    const inner: Ctx = { ...ctx, role, preserve: preserve || tag === 'pre', fmt: elementFmt(el, ctx.fmt, style) };

    // Word's list paragraphs: <p class=MsoListParagraph style="mso-list:l0 level1 lfo1">
    const msoList = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(el.getAttribute('style') ?? '');
    if (msoList && !containsBlock(el)) {
      const marker = el.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]')?.textContent ?? '';
      const ordered = /^\s*[(\[]?[0-9a-zA-Z]{1,5}[.)\]]/.test(marker.replace(/\u00a0/g, ' '));
      const level = Math.max(0, parseInt(msoList[2]!, 10) - 1);
      b.close();
      b.pendingList = { ordered, level, key: 'mso-' + msoList[1] };
      b.open({ role: 'p', align: alignOf(el, style) });
      walkChildren(el, inner, b);
      b.close();
      return;
    }

    if (containsBlock(el) || tag === 'blockquote' || tag === 'body') {
      b.close();
      walkChildren(el, inner, b);
      b.close();
      return;
    }
    b.open({ role: role ?? 'p', align: alignOf(el, style) });
    walkChildren(el, inner, b);
    b.close();
    return;
  }

  // Inline element (or unknown): formatting applies to its content.
  walkChildren(el, { ...ctx, fmt: elementFmt(el, ctx.fmt, style), preserve }, b);
}

function readTable(table: Element, ctx: Ctx): Block {
  const rows: TableRow[] = [];
  const addRow = (tr: Element) => {
    const cells: TableCell[] = [];
    for (let c = tr.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName !== 'td' && c.localName !== 'th') continue;
      const cb = new Builder();
      walkChildren(c, { fmt: ctx.fmt, role: null, preserve: false, lists: [] }, cb);
      cb.close();
      const cell: TableCell = { blocks: cb.out.length ? cb.out : [{ id: newId('p'), type: 'p', props: { role: 'p' }, spans: [] }] };
      const colspan = parseInt(c.getAttribute('colspan') ?? '1', 10);
      const rowspan = parseInt(c.getAttribute('rowspan') ?? '1', 10);
      if (colspan > 1) cell.colspan = colspan;
      if (rowspan > 1) cell.rowspan = rowspan;
      if (c.localName === 'th') cell.header = true;
      cells.push(cell);
    }
    if (cells.length) rows.push({ id: newId('r'), cells, header: tr.parentElement?.localName === 'thead' || undefined });
  };
  const visit = (el: Element) => {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'tr') addRow(c);
      else if (c.localName === 'thead' || c.localName === 'tbody' || c.localName === 'tfoot') visit(c);
    }
  };
  visit(table);
  expandRowspans(rows);
  return { id: newId('t'), type: 'table', rows };
}

/** Turns HTML rowspans into DOCX-style vertical merges so both formats compare alike. */
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

export function readHtml(html: string, name: string, kind: DocKind = 'html'): Doc {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const b = new Builder();
  walkChildren(dom.body, { fmt: {}, role: null, preserve: false, lists: [] }, b);
  b.close();
  const blocks = b.out;
  return { id: newId('d'), name, kind, blocks, version: 0 };
}

/** Where pasted rich text most likely came from, for the load message. */
export function pasteSource(html: string): 'google-docs' | 'word' | 'web' {
  if (/docs-internal-guid|id="docs-/.test(html)) return 'google-docs';
  if (/urn:schemas-microsoft-com:office|class="?Mso/.test(html)) return 'word';
  return 'web';
}
