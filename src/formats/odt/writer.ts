import { bulletChar } from '../../core/lists';
import type { Block, Doc, Fmt, ListInfo, ParaBlock, Role, Span, TableBlock, TableRow } from '../../core/model';
import { imageSize } from '../docx/writer';
import { parseXml, textToBytes } from '../docx/xml';
import { ODF, ODT_MIME, attr, create, is, kids, setAttr } from './ns';
import { OdtPackage, bytesToBase64 } from './package';
import type { OdtBlockX } from './read';
import { spanX } from './read';

/* ------------------------------------------------------------------ text */

/** Whether a literal space written now would be dropped by ODF white-space collapsing. */
export interface WsState {
  skip: boolean;
}

const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/** Appends text to an element, encoding repeated spaces, tabs and line breaks the ODF way. */
export function appendText(parent: Element, text: string, ws: WsState): void {
  const doc = parent.ownerDocument;
  const clean = text.replace(XML_INVALID, '');
  let buf = '';
  const flush = () => {
    if (buf) parent.appendChild(doc.createTextNode(buf));
    buf = '';
  };
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i]!;
    if (ch === ' ') {
      let n = 0;
      while (clean[i] === ' ') {
        n++;
        i++;
      }
      if (!ws.skip) {
        buf += ' ';
        n--;
        ws.skip = true;
      }
      if (n > 0) {
        flush();
        const s = create(doc, ODF.text, 's');
        if (n > 1) setAttr(s, ODF.text, 'c', String(n));
        parent.appendChild(s);
        ws.skip = false;
      }
      continue;
    }
    i++;
    if (ch === '\t' || ch === '\n') {
      flush();
      parent.appendChild(create(doc, ODF.text, ch === '\t' ? 'tab' : 'line-break'));
      ws.skip = false;
    } else if (ch !== '\r') {
      buf += ch;
      ws.skip = false;
    }
  }
  flush();
}

/* ---------------------------------------------------------------- styles */

const STYLE_NS =
  `xmlns:office="${ODF.office}" xmlns:style="${ODF.style}" xmlns:text="${ODF.text}" xmlns:table="${ODF.table}" ` +
  `xmlns:draw="${ODF.draw}" xmlns:fo="${ODF.fo}" xmlns:svg="${ODF.svg}" xmlns:loext="${ODF.loext}"`;

const memos = new WeakMap<OdtPackage, Map<string, string>>();

function memo(pkg: OdtPackage): Map<string, string> {
  let m = memos.get(pkg);
  if (!m) memos.set(pkg, (m = new Map()));
  return m;
}

/** Parses a style element written as XML and adds it to the package. */
function addStyleXml(pkg: OdtPackage, xml: string, auto: boolean): Element {
  const frag = parseXml(`<root ${STYLE_NS}>${xml}</root>`).documentElement.firstElementChild!;
  const doc = auto ? pkg.content : pkg.stylesDoc;
  const el = doc.importNode(frag, true) as Element;
  pkg.addStyle(el, auto);
  return el;
}

const MONO_FONT = 'Liberation Mono';

function ensureMonoFont(pkg: OdtPackage): void {
  if (pkg.hasFont(MONO_FONT)) return;
  const decl = parseXml(
    `<style:font-face ${STYLE_NS} style:name="${MONO_FONT}" svg:font-family="'${MONO_FONT}'" style:font-family-generic="modern" style:font-pitch="fixed"/>`,
  ).documentElement;
  pkg.addFont(decl);
}

const BOLD = 'fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"';
const ITALIC = 'fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"';
const HEADING_PT = [20, 16, 14, 13, 12, 11, 11, 11, 11];

interface NamedSpec {
  name: string;
  display: string;
  xml: string;
}

function namedSpec(role: Role, level: number | undefined, parent: string): NamedSpec | undefined {
  const par = parent ? ` style:parent-style-name="${parent}"` : '';
  const next = parent ? ` style:next-style-name="${parent}"` : '';
  switch (role) {
    case 'h': {
      const n = Math.max(1, Math.min(9, level ?? 1));
      return {
        name: `Heading_20_${n}`,
        display: `Heading ${n}`,
        xml: `<style:style style:name="Heading_20_${n}" style:display-name="Heading ${n}" style:family="paragraph"${par}${next} style:default-outline-level="${n}" style:class="text"><style:paragraph-properties fo:margin-top="${n === 1 ? '0.1665in' : '0.139in'}" fo:margin-bottom="0.0835in" fo:keep-with-next="always"/><style:text-properties fo:font-size="${HEADING_PT[n - 1]}pt" ${BOLD}/></style:style>`,
      };
    }
    case 'title':
      return {
        name: 'Title',
        display: 'Title',
        xml: `<style:style style:name="Title" style:family="paragraph"${par}${next} style:class="chapter"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.0835in"/><style:text-properties fo:font-size="28pt" ${BOLD}/></style:style>`,
      };
    case 'subtitle':
      return {
        name: 'Subtitle',
        display: 'Subtitle',
        xml: `<style:style style:name="Subtitle" style:family="paragraph"${par}${next} style:class="chapter"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.0835in"/><style:text-properties fo:font-size="18pt" fo:color="#595959"/></style:style>`,
      };
    case 'quote':
      return {
        name: 'Quotations',
        display: 'Quotations',
        xml: `<style:style style:name="Quotations" style:family="paragraph"${par}${next} style:class="html"><style:paragraph-properties fo:margin-left="0.3937in" fo:margin-right="0.3937in" fo:margin-bottom="0.1965in"/><style:text-properties ${ITALIC}/></style:style>`,
      };
    case 'code':
      return {
        name: 'Preformatted_20_Text',
        display: 'Preformatted Text',
        xml: `<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph"${par} style:class="html"><style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0in"/><style:text-properties style:font-name="${MONO_FONT}" fo:font-size="10pt"/></style:style>`,
      };
    case 'caption':
      return {
        name: 'Caption',
        display: 'Caption',
        xml: `<style:style style:name="Caption" style:family="paragraph"${par} style:class="extra"><style:paragraph-properties fo:margin-top="0.0835in" fo:margin-bottom="0.0835in"/><style:text-properties fo:font-size="10pt" ${ITALIC}/></style:style>`,
      };
    case 'toc': {
      const n = Math.max(1, Math.min(10, level ?? 1));
      return {
        name: `Contents_20_${n}`,
        display: `Contents ${n}`,
        xml: `<style:style style:name="Contents_20_${n}" style:display-name="Contents ${n}" style:family="paragraph"${par} style:class="index"><style:paragraph-properties fo:margin-left="${((n - 1) * 0.1965).toFixed(4)}in"/></style:style>`,
      };
    }
    default:
      return undefined;
  }
}

function defaultParaStyle(pkg: OdtPackage): string {
  if (pkg.styles.named('paragraph', 'Standard')) return 'Standard';
  const hit = memo(pkg).get('std');
  if (hit) return hit;
  addStyleXml(pkg, `<style:style style:name="Standard" style:family="paragraph" style:class="text"/>`, false);
  memo(pkg).set('std', 'Standard');
  return 'Standard';
}

/** Named paragraph style for a role, creating a plain one when the document lacks it. */
export function roleStyle(pkg: OdtPackage, role: Role, level?: number): string {
  if (role === 'p') return defaultParaStyle(pkg);
  const spec = namedSpec(role, level, '');
  if (!spec) return defaultParaStyle(pkg);
  const found = pkg.styles.named('paragraph', spec.name) ?? pkg.styles.namedByDisplay('paragraph', spec.display);
  if (found) return found.name;
  if (role === 'code') ensureMonoFont(pkg);
  const withParent = namedSpec(role, level, defaultParaStyle(pkg))!;
  addStyleXml(pkg, withParent.xml, false);
  return spec.name;
}

function noteStyle(pkg: OdtPackage, kind: 'footnote' | 'endnote'): string {
  const name = kind === 'footnote' ? 'Footnote' : 'Endnote';
  if (pkg.styles.named('paragraph', name)) return name;
  addStyleXml(
    pkg,
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${defaultParaStyle(pkg)}" style:class="extra"><style:paragraph-properties fo:margin-left="0.2362in" fo:text-indent="-0.2362in"/><style:text-properties fo:font-size="10pt"/></style:style>`,
    false,
  );
  return name;
}

function linkStyle(pkg: OdtPackage): string {
  const found = pkg.styles.named('text', 'Internet_20_link') ?? pkg.styles.namedByDisplay('text', 'Internet link') ?? pkg.styles.namedByDisplay('text', 'Hyperlink');
  if (found) return found.name;
  addStyleXml(
    pkg,
    `<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>`,
    false,
  );
  return 'Internet_20_link';
}

/** Automatic paragraph style with alignment and page breaks over a named style. */
function autoParaStyle(pkg: OdtPackage, parent: string, align: ParaBlock['props']['align'], brk: 'before' | 'after' | undefined): string {
  if (!align && !brk) return parent;
  const key = `P|${parent}|${align ?? ''}|${brk ?? ''}`;
  const m = memo(pkg);
  const hit = m.get(key);
  if (hit) return hit;
  const name = pkg.freshStyleName('paragraph', 'P', true);
  const a = align === 'right' ? 'end' : align;
  const props = (a ? ` fo:text-align="${a}" style:justify-single-word="false"` : '') + (brk ? ` fo:break-${brk}="page"` : '');
  addStyleXml(pkg, `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties${props}/></style:style>`, true);
  m.set(key, name);
  return name;
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
};

/** Automatic text style for inline formatting, or undefined for plain text. */
function autoTextStyle(pkg: OdtPackage, fmt: Fmt): string | undefined {
  let props = '';
  if (fmt.b) props += ` ${BOLD}`;
  if (fmt.i) props += ` ${ITALIC}`;
  if (fmt.u) props += ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"';
  if (fmt.s) props += ' style:text-line-through-style="solid" style:text-line-through-type="single"';
  if (fmt.sup) props += ' style:text-position="super 58%"';
  else if (fmt.sub) props += ' style:text-position="sub 58%"';
  if (fmt.code) props += ` style:font-name="${MONO_FONT}"`;
  if (fmt.hl) props += ` fo:background-color="${/^#[0-9a-f]{6}$/i.test(fmt.hl) ? fmt.hl : (HIGHLIGHTS[fmt.hl] ?? '#ffff00')}"`;
  if (!props) return undefined;
  const key = `T|${props}`;
  const m = memo(pkg);
  const hit = m.get(key);
  if (hit) return hit;
  if (fmt.code) ensureMonoFont(pkg);
  const name = pkg.freshStyleName('text', 'T', true);
  addStyleXml(pkg, `<style:style style:name="${name}" style:family="text"><style:text-properties${props}/></style:style>`, true);
  m.set(key, name);
  return name;
}

function cellStyle(pkg: OdtPackage): string {
  const m = memo(pkg);
  const hit = m.get('cell');
  if (hit) return hit;
  const name = pkg.freshStyleName('table-cell', 'TblCell', true);
  addStyleXml(
    pkg,
    `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties fo:padding="0.0382in" fo:border="0.5pt solid #000000"/></style:style>`,
    true,
  );
  m.set('cell', name);
  return name;
}

/* ----------------------------------------------------------------- lists */

const ODF_NUM: Record<string, string> = { decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I', none: '' };
const DEFAULT_NUM = ['1', 'a', 'i'];

function templateParts(template: string | undefined): { prefix: string; suffix: string; levels: number } | undefined {
  if (!template || !/%\d/.test(template)) return undefined;
  const first = template.search(/%\d/);
  const lastMatch = [...template.matchAll(/%\d/g)].pop()!;
  return {
    prefix: template.slice(0, first),
    suffix: template.slice(lastMatch.index! + 2),
    levels: template.match(/%\d/g)!.length,
  };
}

function escAttr(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

/** Automatic list style for lists of a source document (one per source list). */
export function listStyleFor(pkg: OdtPackage, info: ListInfo, source: string): string {
  const key = `L|${source}|${info.key ?? ''}|${info.ordered ? 'o' : 'u'}`;
  const m = memo(pkg);
  const hit = m.get(key);
  if (hit) return hit;
  const name = pkg.freshStyleName('list', 'L', true);
  let levels = '';
  for (let l = 0; l < 10; l++) {
    const indent = (0.25 * (l + 1) + 0.25).toFixed(4);
    const props = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${indent}in" fo:text-indent="-0.25in" fo:margin-left="${indent}in"/></style:list-level-properties>`;
    const format = info.formats?.[l];
    const ordered = info.ordered ? format !== 'bullet' : format !== undefined && format !== 'bullet' && l < info.level;
    if (ordered) {
      const numFormat = format !== undefined ? (ODF_NUM[format] ?? '1') : DEFAULT_NUM[l % 3]!;
      const start = info.starts?.[l];
      const parts = l === info.level ? templateParts(info.template) : undefined;
      const prefix = parts?.prefix ? ` style:num-prefix="${escAttr(parts.prefix)}"` : '';
      const suffix = ` style:num-suffix="${escAttr(parts ? parts.suffix : '.')}"`;
      const shown = parts && parts.levels > 1 ? ` text:display-levels="${Math.min(parts.levels, l + 1)}"` : '';
      levels += `<text:list-level-style-number text:level="${l + 1}"${prefix}${suffix} style:num-format="${numFormat}"${start !== undefined && start !== 1 ? ` text:start-value="${start}"` : ''}${shown}>${props}</text:list-level-style-number>`;
    } else {
      const glyph = bulletChar(l === info.level ? info.template : undefined, l);
      levels += `<text:list-level-style-bullet text:level="${l + 1}" text:bullet-char="${escAttr(glyph)}">${props}</text:list-level-style-bullet>`;
    }
  }
  addStyleXml(pkg, `<text:list-style style:name="${name}">${levels}</text:list-style>`, true);
  m.set(key, name);
  return name;
}

/** Gives a list element an xml:id (so later lists can continue it) and returns it. */
export function listId(list: Element): string {
  let id = list.getAttributeNS(ODF.xml, 'id');
  if (!id) {
    id = `list${Math.floor(Math.random() * 1e9)}${Date.now() % 1e6}`;
    list.setAttributeNS(ODF.xml, 'xml:id', id);
  }
  return id;
}

/* ------------------------------------------------------- model → ODF XML */

export interface GenerateContext {
  pkg: OdtPackage;
  /** Key namespace for lists (the source document id). */
  source: string;
}

let noteSeq = 0;

function frameFor(doc: Document, span: Span, pkg: OdtPackage): Element | null {
  const obj = span.obj!;
  if (!obj.data || !obj.mime || !/^image\//.test(obj.mime)) return null;
  const natural = imageSize(obj.data);
  let w = obj.width ?? natural?.w ?? 200;
  let h = obj.height ?? (natural && obj.width ? Math.round((natural.h * obj.width) / natural.w) : (natural?.h ?? 150));
  if (w > 624) {
    h = Math.round((h * 624) / w);
    w = 624;
  }
  const frame = create(doc, ODF.draw, 'frame', [
    [ODF.draw, 'name', pkg.uniqueName(ODF.draw, 'frame', ODF.draw, 'name', 'Image1')],
    [ODF.text, 'anchor-type', 'as-char'],
    [ODF.svg, 'width', `${(w / 96).toFixed(4)}in`],
    [ODF.svg, 'height', `${(h / 96).toFixed(4)}in`],
    [ODF.draw, 'z-index', '0'],
  ]);
  const img = create(doc, ODF.draw, 'image');
  const href = pkg.addPicture(obj.data, obj.mime);
  if (href) {
    setAttr(img, ODF.xlink, 'href', href);
    setAttr(img, ODF.xlink, 'type', 'simple');
    setAttr(img, ODF.xlink, 'show', 'embed');
    setAttr(img, ODF.xlink, 'actuate', 'onLoad');
  } else {
    const bin = create(doc, ODF.office, 'binary-data');
    bin.textContent = bytesToBase64(obj.data);
    img.appendChild(bin);
  }
  setAttr(img, ODF.draw, 'mime-type', obj.mime);
  frame.appendChild(img);
  if (obj.label && obj.label !== 'Image') {
    const title = create(doc, ODF.svg, 'title');
    title.textContent = obj.label;
    frame.appendChild(title);
  }
  return frame;
}

function noteFor(doc: Document, span: Span, pkg: OdtPackage): Element {
  const kind = span.obj!.kind === 'endnote' ? 'endnote' : 'footnote';
  const note = create(doc, ODF.text, 'note', [
    [ODF.text, 'id', `ftn_g${Date.now().toString(36)}${++noteSeq}`],
    [ODF.text, 'note-class', kind],
  ]);
  const cit = create(doc, ODF.text, 'note-citation');
  cit.textContent = String(noteSeq);
  const body = create(doc, ODF.text, 'note-body');
  const p = create(doc, ODF.text, 'p', [[ODF.text, 'style-name', noteStyle(pkg, kind)]]);
  appendText(p, span.obj!.note ?? span.obj!.label ?? '', { skip: true });
  body.appendChild(p);
  note.append(cit, body);
  return note;
}

/** Inline ODF nodes for model spans, created in the package's content document. */
export function generateRuns(spans: readonly Span[], pkg: OdtPackage, ws: WsState): Node[] {
  const doc = pkg.content;
  const out: Node[] = [];
  let link: { href: string; el: Element } | null = null;
  for (const s of spans) {
    if (s.marker) continue;
    const container = (): Element | null => {
      const href = s.fmt.href;
      if (!href) {
        link = null;
        return null;
      }
      if (!link || link.href !== href) {
        const a = create(doc, ODF.text, 'a', [
          [ODF.xlink, 'type', 'simple'],
          [ODF.xlink, 'href', href],
          [ODF.text, 'style-name', linkStyle(pkg)],
        ]);
        link = { href, el: a };
        out.push(a);
      }
      return link.el;
    };
    const put = (n: Node) => {
      const c = container();
      if (c) c.appendChild(n);
      else out.push(n);
    };
    const styled = (fmt: Fmt): Element => {
      const { href: _href, ...rest } = fmt;
      const name = autoTextStyle(pkg, rest);
      const span = create(doc, ODF.text, 'span');
      if (name) setAttr(span, ODF.text, 'style-name', name);
      return span;
    };
    if (s.obj) {
      const o = s.obj;
      let node: Element | null = null;
      if (o.kind === 'pagebreak') continue;
      if (o.kind === 'image') node = frameFor(doc, s, pkg);
      else if (o.kind === 'footnote' || o.kind === 'endnote') node = noteFor(doc, s, pkg);
      else if (o.kind === 'field' && /^(PAGE|NUMPAGES)(\||$)/.test(o.key)) {
        node = o.key.startsWith('PAGE') ? create(doc, ODF.text, 'page-number', [[ODF.text, 'select-page', 'current']]) : create(doc, ODF.text, 'page-count');
        node.textContent = o.text || '1';
      }
      if (node) {
        const span = styled(s.fmt);
        span.appendChild(node);
        put(span.attributes.length ? span : node);
        ws.skip = false;
        continue;
      }
      const text = o.text ?? (o.kind === 'image' ? `[${o.label}]` : '');
      if (!text) continue;
      const span = styled(s.fmt);
      appendText(span, text, ws);
      put(span.attributes.length ? span : span.childNodes.length === 1 ? span.firstChild! : span);
      continue;
    }
    if (!s.text) continue;
    const span = styled(s.fmt);
    if (span.attributes.length) {
      appendText(span, s.text, ws);
      put(span);
    } else {
      const holder = create(doc, ODF.text, 'span');
      appendText(holder, s.text, ws);
      for (const n of Array.from(holder.childNodes)) put(n);
    }
  }
  return out;
}

export function generateParagraph(block: ParaBlock, ctx: GenerateContext): Element {
  const { pkg } = ctx;
  const doc = pkg.content;
  const { role, level, align } = block.props;
  const visible = block.spans.filter((s) => !s.marker);
  const breakAt = visible.findIndex((s) => s.obj?.kind === 'pagebreak');
  const brk = breakAt < 0 ? undefined : breakAt === 0 ? 'before' : 'after';
  const style = autoParaStyle(pkg, roleStyle(pkg, role, level), align, brk);
  const el = role === 'h' ? create(doc, ODF.text, 'h', [[ODF.text, 'outline-level', String(Math.max(1, Math.min(10, level ?? 1)))]]) : create(doc, ODF.text, 'p');
  setAttr(el, ODF.text, 'style-name', style);
  for (const n of generateRuns(block.spans, pkg, { skip: true })) el.appendChild(n);
  return el;
}

function tableName(pkg: OdtPackage): string {
  return pkg.uniqueName(ODF.table, 'table', ODF.table, 'name', 'Table1');
}

export function generateTable(block: TableBlock, ctx: GenerateContext): Element {
  const { pkg } = ctx;
  const doc = pkg.content;
  const width = (r: TableRow) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0);
  const cols = Math.max(1, ...block.rows.map(width));
  const tbl = create(doc, ODF.table, 'table', [[ODF.table, 'name', tableName(pkg)]]);
  const col = create(doc, ODF.table, 'table-column');
  if (cols > 1) setAttr(col, ODF.table, 'number-columns-repeated', String(cols));
  tbl.appendChild(col);
  // Grid columns covered by cells from rows above (HTML-style rowspans).
  const covered = new Map<number, Map<number, number>>();
  // Grid columns of vertically merged continuation cells (Word-style), per row.
  const contAt = block.rows.map((r) => {
    const set = new Set<number>();
    let c = 0;
    for (const cell of r.cells) {
      if (cell.vmerge === 'continue') set.add(c);
      c += cell.colspan ?? 1;
    }
    return set;
  });
  let header: Element | null = null;
  block.rows.forEach((row, r) => {
    const tr = generateRow(row, ctx, (c) => covered.get(r)?.get(c), (c) => {
      let n = 1;
      while (contAt[r + n]?.has(c)) n++;
      return n;
    }, (c, cs, rs) => {
      for (let k = 1; k < rs; k++) {
        let m = covered.get(r + k);
        if (!m) covered.set(r + k, (m = new Map()));
        m.set(c, cs);
      }
    });
    if (row.header && (header || r === 0)) {
      if (!header) {
        header = create(doc, ODF.table, 'table-header-rows');
        tbl.appendChild(header);
      }
      header.appendChild(tr);
    } else {
      tbl.appendChild(tr);
    }
  });
  return tbl;
}

/**
 * One table row. `coveredAt` tells which grid columns are covered by cells
 * above, `rowsFrom` how many rows a vertically merged cell spans, `span`
 * records a cell spanning several rows.
 */
export function generateRow(
  row: TableRow,
  ctx: GenerateContext,
  coveredAt: (col: number) => number | undefined = () => undefined,
  rowsFrom: (col: number) => number = () => 1,
  span: (col: number, colspan: number, rowspan: number) => void = () => {},
): Element {
  const { pkg } = ctx;
  const doc = pkg.content;
  const tr = create(doc, ODF.table, 'table-row');
  const coverCells = (n: number) => {
    for (let i = 0; i < n; i++) tr.appendChild(create(doc, ODF.table, 'covered-table-cell'));
  };
  let c = 0;
  const skipCovered = () => {
    for (let cs = coveredAt(c); cs; cs = coveredAt(c)) {
      coverCells(cs);
      c += cs;
    }
  };
  for (const cell of row.cells) {
    skipCovered();
    const cs = cell.colspan ?? 1;
    if (cell.vmerge === 'continue') {
      coverCells(cs);
      c += cs;
      continue;
    }
    const rs = cell.rowspan && cell.rowspan > 1 ? cell.rowspan : cell.vmerge === 'restart' ? rowsFrom(c) : 1;
    const tc = create(doc, ODF.table, 'table-cell', [
      [ODF.table, 'style-name', cellStyle(pkg)],
      [ODF.office, 'value-type', 'string'],
    ]);
    if (cs > 1) setAttr(tc, ODF.table, 'number-columns-spanned', String(cs));
    if (rs > 1) setAttr(tc, ODF.table, 'number-rows-spanned', String(rs));
    for (const n of generateBlocks(cell.blocks, ctx)) tc.appendChild(n);
    if (!tc.firstChild) tc.appendChild(create(doc, ODF.text, 'p', [[ODF.text, 'style-name', defaultParaStyle(pkg)]]));
    tr.appendChild(tc);
    coverCells(cs - 1);
    if (cell.rowspan && cell.rowspan > 1) span(c, cs, cell.rowspan);
    c += cs;
  }
  skipCovered();
  return tr;
}

/** ODF index element for each kind of generated table or index the model knows. */
const INDEXES: Record<string, string> = {
  'Table of contents': 'table-of-content',
  Index: 'alphabetical-index',
  'Table of figures': 'illustration-index',
  'Table of tables': 'table-index',
  'Table of objects': 'object-index',
  Bibliography: 'bibliography',
};

export function generateBlock(block: Block, ctx: GenerateContext): Element | null {
  switch (block.type) {
    case 'p':
      return generateParagraph(block, ctx);
    case 'table':
      return generateTable(block, ctx);
    case 'opaque': {
      const doc = ctx.pkg.content;
      const inner = generateBlocks(block.blocks, ctx);
      if (!inner.length) inner.push(create(doc, ODF.text, 'p'));
      const index = INDEXES[block.label];
      if (index) {
        // A real index keeps its meaning: LibreOffice can update it later.
        const el = create(doc, ODF.text, index, [
          [ODF.text, 'name', ctx.pkg.uniqueName(ODF.text, index, ODF.text, 'name', `${block.label}1`)],
          [ODF.text, 'protected', 'true'],
        ]);
        const source = create(doc, ODF.text, `${index === 'table-of-content' ? 'table-of-content' : index}-source`);
        if (index === 'table-of-content') setAttr(source, ODF.text, 'outline-level', '10');
        const body = create(doc, ODF.text, 'index-body');
        for (const n of inner) body.appendChild(n);
        el.append(source, body);
        return el;
      }
      const name = ctx.pkg.uniqueName(ODF.text, 'section', ODF.text, 'name', block.label.replace(/[^\p{L}\p{N}]+/gu, '_') || 'Section1');
      const sec = create(doc, ODF.text, 'section', [[ODF.text, 'name', name]]);
      for (const n of inner) sec.appendChild(n);
      return sec;
    }
    case 'marker':
      return null;
  }
}

/** Elements for a run of model blocks; list paragraphs are grouped into (nested) lists. */
export function generateBlocks(blocks: readonly Block[], ctx: GenerateContext): Element[] {
  const doc = ctx.pkg.content;
  const out: Element[] = [];
  let stack: Array<{ list: Element; item: Element | null }> = [];
  let current = '';
  const firstByKey = new Map<string, Element>();
  for (const b of blocks) {
    if (b.type === 'p' && b.props.list) {
      const info = b.props.list;
      const key = `${info.key ?? ''}|${info.ordered ? 'o' : 'u'}`;
      if (!stack.length || key !== current) {
        current = key;
        const list = create(doc, ODF.text, 'list', [[ODF.text, 'style-name', listStyleFor(ctx.pkg, info, ctx.source)]]);
        const first = firstByKey.get(key);
        if (first) setAttr(list, ODF.text, 'continue-list', listId(first));
        else firstByKey.set(key, list);
        out.push(list);
        stack = [{ list, item: null }];
      }
      const level = Math.max(0, Math.min(9, info.level));
      while (stack.length - 1 > level) stack.pop();
      while (stack.length - 1 < level) {
        const top = stack[stack.length - 1]!;
        if (!top.item) {
          top.item = create(doc, ODF.text, 'list-item');
          top.list.appendChild(top.item);
        }
        const sub = create(doc, ODF.text, 'list');
        top.item.appendChild(sub);
        stack.push({ list: sub, item: null });
      }
      const top = stack[stack.length - 1]!;
      top.item = create(doc, ODF.text, 'list-item');
      top.list.appendChild(top.item);
      top.item.appendChild(generateParagraph(b, ctx));
      continue;
    }
    stack = [];
    current = '';
    const el = generateBlock(b, ctx);
    if (el) out.push(el);
  }
  return out;
}

/* --------------------------------------------------------- splicing runs */

/**
 * Emits inline nodes into a paragraph, re-creating inline wrappers (links,
 * spans, metadata) around them, and keeps track of white space so text
 * pieces join without losing or gaining spaces.
 */
export class OdtEmitter {
  private stack: Array<{ src: Element; clone: Element }> = [];
  private opened = new Set<Element>();

  constructor(
    private readonly p: Element,
    readonly ws: WsState = { skip: true },
  ) {}

  private container(): Element {
    return this.stack.length ? this.stack[this.stack.length - 1]!.clone : this.p;
  }

  private open(wrap: readonly Element[]): Element {
    let k = 0;
    while (k < this.stack.length && k < wrap.length && this.stack[k]!.src === wrap[k]) k++;
    this.stack.length = k;
    for (let i = k; i < wrap.length; i++) {
      const src = wrap[i]!;
      const clone = src.cloneNode(false) as Element;
      if (this.opened.has(src)) clone.removeAttributeNS(ODF.xml, 'id');
      this.opened.add(src);
      this.container().appendChild(clone);
      this.stack.push({ src, clone });
    }
    return this.container();
  }

  emit(nodes: Node[], wrap: readonly Element[]): void {
    const target = this.open(wrap);
    for (const n of nodes) target.appendChild(n);
  }

  /** Characters [start, end) of a span read from ODF (objects and markers are emitted whole). */
  emitSpan(span: Span, start: number, end: number): void {
    const x = spanX(span);
    if (!x) return;
    const doc = this.p.ownerDocument;
    if (span.obj || span.marker) {
      const nodes = (x.nodes ?? []).map((n) => {
        const copy = doc.importNode(n, true);
        if (!x.run) return copy;
        const r = doc.importNode(x.run, false);
        r.appendChild(copy);
        return r;
      });
      this.emit(nodes, x.wrap);
      if (span.obj) this.ws.skip = false;
      return;
    }
    const text = span.text.slice(start, end);
    if (!text) return;
    const target = this.open(x.wrap);
    if (x.run) {
      const r = doc.importNode(x.run, false) as Element;
      target.appendChild(r);
      appendText(r, text, this.ws);
    } else {
      appendText(target, text, this.ws);
    }
  }
}

/* ------------------------------------------------------------------ save */

function reopen(src: Element, clone: Element, first: Element, pkg: OdtPackage): void {
  if (is(src, ODF.text, 'list')) {
    clone.removeAttributeNS(ODF.xml, 'id');
    clone.removeAttributeNS(ODF.text, 'continue-numbering');
    setAttr(clone, ODF.text, 'continue-list', listId(first));
  } else if (is(src, ODF.text, 'section')) {
    setAttr(clone, ODF.text, 'name', pkg.uniqueName(ODF.text, 'section', ODF.text, 'name', attr(src, ODF.text, 'name') ?? 'Section1'));
  } else {
    clone.removeAttributeNS(ODF.xml, 'id');
  }
}

/** Body nodes for the blocks of an ODT-backed document. */
export function bodyNodes(blocks: readonly Block[], pkg: OdtPackage, source = 'export'): Node[] {
  const out: Node[] = [];
  const stack: Array<{ src: Element; clone: Element }> = [];
  const firstClone = new Map<Element, Element>();
  const ctx: GenerateContext = { pkg, source };
  for (const b of blocks) {
    const x = b.x as OdtBlockX | undefined;
    const el = x?.el ?? generateBlock(b, ctx);
    if (!el) continue;
    const chain = x?.el ? (x.containers ?? []) : [];
    let k = 0;
    while (k < stack.length && k < chain.length && stack[k]!.src === chain[k]) k++;
    stack.length = k;
    for (let i = k; i < chain.length; i++) {
      const src = chain[i]!;
      const clone = src.cloneNode(false) as Element;
      const first = firstClone.get(src);
      if (first) reopen(src, clone, first, pkg);
      else firstClone.set(src, clone);
      if (stack.length) stack[stack.length - 1]!.clone.appendChild(clone);
      else out.push(clone);
      stack.push({ src, clone });
    }
    if (stack.length) stack[stack.length - 1]!.clone.appendChild(el.cloneNode(true));
    else out.push(el);
  }
  // A list item must hold something; drop items (and then lists) emptied by edits.
  const prune = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      prune(Array.from(e.childNodes));
      if ((is(e, ODF.text, 'list-item') || is(e, ODF.text, 'list') || is(e, ODF.text, 'section')) && !kids(e).length) e.parentNode?.removeChild(e);
    }
  };
  prune(out);
  return out.filter((n) => !(n.nodeType === 1 && (is(n, ODF.text, 'list') || is(n, ODF.text, 'section')) && !(n as Element).firstElementChild));
}

/* ------------------------------------------------------------ new files */

const OFFICE_NS =
  `xmlns:office="${ODF.office}" xmlns:style="${ODF.style}" xmlns:text="${ODF.text}" xmlns:table="${ODF.table}" xmlns:draw="${ODF.draw}" ` +
  `xmlns:fo="${ODF.fo}" xmlns:xlink="${ODF.xlink}" xmlns:dc="${ODF.dc}" xmlns:meta="${ODF.meta}" xmlns:svg="${ODF.svg}" xmlns:loext="${ODF.loext}" ` +
  `xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" xmlns:math="${ODF.math}"`;

const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** An empty but complete .odt package. */
export function newPackage(title: string): OdtPackage {
  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  const files = new Map<string, Uint8Array>();
  const put = (path: string, text: string) => files.set(path, textToBytes(text));
  put('mimetype', ODT_MIME);
  put(
    'META-INF/manifest.xml',
    `${DECL}<manifest:manifest xmlns:manifest="${ODF.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  );
  const fonts = `<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman" style:font-pitch="variable"/><style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/></office:font-face-decls>`;
  put(
    'content.xml',
    `${DECL}<office:document-content ${OFFICE_NS} office:version="1.3">${fonts}<office:automatic-styles/><office:body><office:text><text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/><text:sequence-decl text:display-outline-level="0" text:name="Table"/><text:sequence-decl text:display-outline-level="0" text:name="Text"/><text:sequence-decl text:display-outline-level="0" text:name="Drawing"/><text:sequence-decl text:display-outline-level="0" text:name="Figure"/></text:sequence-decls></office:text></office:body></office:document-content>`,
  );
  put(
    'styles.xml',
    `${DECL}<office:document-styles ${OFFICE_NS} office:version="1.3">${fonts}<office:styles>` +
      `<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2" style:writing-mode="page"/><style:text-properties style:font-name="Liberation Sans" fo:font-size="11pt" fo:language="en" fo:country="US"/></style:default-style>` +
      `<style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-top="0in" fo:margin-bottom="0.0835in" fo:line-height="115%"/></style:style>` +
      `<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-bottom="0in"/></style:style>` +
      `</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" style:print-orientation="portrait" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in"/></style:page-layout></office:automatic-styles>` +
      `<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>`,
  );
  put(
    'meta.xml',
    `${DECL}<office:document-meta xmlns:office="${ODF.office}" xmlns:meta="${ODF.meta}" xmlns:dc="${ODF.dc}" office:version="1.3"><office:meta><meta:generator>Collate</meta:generator><dc:title>${escapeXml(title)}</dc:title><meta:creation-date>${now}</meta:creation-date><dc:date>${now}</dc:date></office:meta></office:document-meta>`,
  );
  return OdtPackage.fromParts(files);
}

/** Serializes a document as OpenDocument: in place for ODT-backed documents, as a new .odt otherwise. */
export function exportOdt(doc: Doc): Uint8Array {
  if (doc.pkg instanceof OdtPackage) return doc.pkg.save(bodyNodes(doc.blocks, doc.pkg, doc.id));
  const pkg = newPackage(doc.name.replace(/\.[^.]+$/, ''));
  const prelude = kids(pkg.body);
  const nodes = [...prelude, ...generateBlocks(doc.blocks, { pkg, source: doc.id })];
  return pkg.save(nodes);
}
