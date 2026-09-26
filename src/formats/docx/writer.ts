import type { Block, Doc, Fmt, ListInfo, ParaBlock, Role, Span, TableBlock, TableRow } from '../../core/model';
import { DocxPackage, defaultSectPr, dirOf } from './package';
import { spanX } from './read';
import type { DocxBlockX } from './read';
import { CT, NS, REL, createW, elements, isW, parseXml, setWAttr, textToBytes, wAttr, wChild } from './xml';

/* ------------------------------------------------------------------ text */

/** Appends w:t / w:tab / w:br … children for `text` to a run. */
export function appendText(r: Element, text: string): void {
  const doc = r.ownerDocument;
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const t = createW(doc, 't');
    if (/^\s|\s$|\s\s/.test(buf)) t.setAttributeNS(NS.xml, 'xml:space', 'preserve');
    t.textContent = buf;
    r.appendChild(t);
    buf = '';
  };
  for (const ch of text) {
    let special: Element | null = null;
    if (ch === '\t') special = createW(doc, 'tab');
    else if (ch === '\n') special = createW(doc, 'br');
    else if (ch === '‑') special = createW(doc, 'noBreakHyphen');
    else if (ch === '\u00ad') special = createW(doc, 'softHyphen');
    if (special) {
      flush();
      r.appendChild(special);
    } else {
      buf += ch;
    }
  }
  flush();
}

/** A run with the formatting of `template` (same document) and new content. */
export function runLike(template: Element | null, doc: Document): Element {
  const r = createW(doc, 'r');
  if (template) {
    for (const a of Array.from(template.attributes)) {
      if (a.namespaceURI === NS.w && a.localName.startsWith('rsid')) continue;
      r.setAttributeNS(a.namespaceURI, a.name, a.value);
    }
    const rPr = wChild(template, 'rPr');
    if (rPr) r.appendChild(rPr.cloneNode(true));
  }
  return r;
}

/* ------------------------------------------------------ styles & lists */

const HEADING_SIZES = [32, 28, 26, 24, 22, 22, 22, 22, 22];

interface StyleSpec {
  id: string;
  name: string;
  xml: string;
}

function paraStyleSpec(role: Role, level: number | undefined, basedOn: string): StyleSpec | undefined {
  const based = basedOn ? `<w:basedOn w:val="${basedOn}"/><w:next w:val="${basedOn}"/>` : '';
  switch (role) {
    case 'h': {
      const n = Math.max(1, Math.min(9, level ?? 1));
      return {
        id: `Heading${n}`,
        name: `heading ${n}`,
        xml: `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/>${based}<w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${HEADING_SIZES[n - 1]}"/><w:szCs w:val="${HEADING_SIZES[n - 1]}"/></w:rPr></w:style>`,
      };
    }
    case 'title':
      return {
        id: 'Title',
        name: 'Title',
        xml: `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>${based}<w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>`,
      };
    case 'subtitle':
      return {
        id: 'Subtitle',
        name: 'Subtitle',
        xml: `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/>${based}<w:uiPriority w:val="11"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:spacing w:val="15"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>`,
      };
    case 'quote':
      return {
        id: 'Quote',
        name: 'Quote',
        xml: `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>${based}<w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="160"/><w:ind w:left="864" w:right="864"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>`,
      };
    case 'code':
      return {
        id: 'HTMLPreformatted',
        name: 'HTML Preformatted',
        xml: `<w:style w:type="paragraph" w:styleId="HTMLPreformatted"><w:name w:val="HTML Preformatted"/>${based}<w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`,
      };
    case 'caption':
      return {
        id: 'Caption',
        name: 'caption',
        xml: `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/>${based}<w:uiPriority w:val="35"/><w:qFormat/><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:iCs/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>`,
      };
    case 'toc': {
      const n = Math.max(1, Math.min(9, level ?? 1));
      return {
        id: `TOC${n}`,
        name: `toc ${n}`,
        xml: `<w:style w:type="paragraph" w:styleId="TOC${n}"><w:name w:val="toc ${n}"/>${based}<w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="100"/><w:ind w:left="${(n - 1) * 220}"/></w:pPr></w:style>`,
      };
    }
    default:
      return undefined;
  }
}

function addStyleXml(pkg: DocxPackage, xml: string, preferredId: string): string {
  const path = pkg.stylesPath(true)!;
  const doc = pkg.xml(path)!;
  const frag = parseXml(`<w:styles xmlns:w="${NS.w}">${xml}</w:styles>`).documentElement.firstElementChild!;
  const el = doc.importNode(frag, true) as Element;
  let id = preferredId;
  for (let i = 2; pkg.styles.byId.has(id); i++) id = `${preferredId}${i}`;
  setWAttr(el, 'styleId', id);
  doc.documentElement.appendChild(el);
  pkg.markDirty(path);
  pkg.styles.add(el);
  return id;
}

/** Style id for a paragraph role in `pkg`, creating a sensible style when the document lacks one. */
export function paraStyleId(pkg: DocxPackage, role: Role, level?: number): string | undefined {
  if (role === 'p') return undefined;
  const spec = paraStyleSpec(role, level, pkg.styles.defaultPara?.id ?? '');
  if (!spec) return undefined;
  const found = pkg.styles.findByName('paragraph', spec.name);
  if (found) return found.id;
  return addStyleXml(pkg, spec.xml, spec.id);
}

function charStyleId(pkg: DocxPackage, name: string, xml: string, id: string): string {
  return pkg.styles.findByName('character', name)?.id ?? addStyleXml(pkg, xml, id);
}

function hyperlinkStyle(pkg: DocxPackage): string {
  return charStyleId(
    pkg,
    'Hyperlink',
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`,
    'Hyperlink',
  );
}

const BULLET_GLYPHS = ['•', '◦', '▪'];
const ORDERED_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman'];

function randomHex8(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
}

/** Adds a fresh bulleted or numbered list definition and returns its numId. */
export function createList(pkg: DocxPackage, ordered: boolean, info?: ListInfo): string {
  const path = pkg.numberingPath(true)!;
  const doc = pkg.xml(path)!;
  const root = doc.documentElement;
  const absId = String(pkg.numbering.maxAbstractId() + 1);
  const numId = String(pkg.numbering.maxNumId() + 1);
  let levels = '';
  for (let l = 0; l < 9; l++) {
    const ind = `<w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr>`;
    if (ordered) {
      const fmt = info?.formats?.[l] && info.formats[l] !== 'bullet' ? info.formats[l]! : ORDERED_FORMATS[l % 3]!;
      const start = info?.starts?.[l] ?? 1;
      levels += `<w:lvl w:ilvl="${l}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%${l + 1}."/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
    } else {
      levels += `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLET_GLYPHS[l % 3]}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
    }
  }
  const frag = parseXml(
    `<w:numbering xmlns:w="${NS.w}"><w:abstractNum w:abstractNumId="${absId}"><w:nsid w:val="${randomHex8()}"/><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum><w:num w:numId="${numId}"><w:abstractNumId w:val="${absId}"/></w:num></w:numbering>`,
  ).documentElement;
  const [absSrc, numSrc] = elements(frag);
  const absEl = doc.importNode(absSrc!, true) as Element;
  const numEl = doc.importNode(numSrc!, true) as Element;
  const firstNum = elements(root).find((e) => isW(e, 'num') || isW(e, 'numIdMacAtCleanup'));
  root.insertBefore(absEl, firstNum ?? null);
  const cleanup = elements(root).find((e) => isW(e, 'numIdMacAtCleanup'));
  root.insertBefore(numEl, cleanup ?? null);
  pkg.markDirty(path);
  pkg.numbering.addAbstract(absEl);
  pkg.numbering.addNum(numEl);
  return numId;
}

const generatedLists = new WeakMap<DocxPackage, Map<string, string>>();

/* ------------------------------------------------------ model → WordML */

export interface GenerateContext {
  pkg: DocxPackage;
  /** Key namespace for lists (the source document id). */
  source: string;
  /** Neighboring target blocks; a list item joins their list when the kind matches. */
  neighbors: Array<Block | undefined>;
}

const WORD_HIGHLIGHTS = new Set([
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
]);

function rPrFor(doc: Document, fmt: Fmt, pkg: DocxPackage, linkStyle: boolean): Element | null {
  const rPr = createW(doc, 'rPr');
  if (linkStyle) rPr.appendChild(createW(doc, 'rStyle', { val: hyperlinkStyle(pkg) }));
  if (fmt.code) rPr.appendChild(createW(doc, 'rFonts', { ascii: 'Courier New', hAnsi: 'Courier New', cs: 'Courier New' }));
  if (fmt.b) rPr.appendChild(createW(doc, 'b'));
  if (fmt.i) rPr.appendChild(createW(doc, 'i'));
  if (fmt.s) rPr.appendChild(createW(doc, 'strike'));
  if (fmt.hl && WORD_HIGHLIGHTS.has(fmt.hl)) rPr.appendChild(createW(doc, 'highlight', { val: fmt.hl }));
  if (fmt.u) rPr.appendChild(createW(doc, 'u', { val: 'single' }));
  if (fmt.sup) rPr.appendChild(createW(doc, 'vertAlign', { val: 'superscript' }));
  else if (fmt.sub) rPr.appendChild(createW(doc, 'vertAlign', { val: 'subscript' }));
  return rPr.firstChild ? rPr : null;
}

/** Pixel size of a PNG, GIF or JPEG image. */
export function imageSize(data: Uint8Array): { w: number; h: number } | undefined {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
  if (data.length > 10 && data[0] === 0x47 && data[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return undefined;
      const marker = data[i + 1]!;
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return undefined;
}

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp' };

function drawingRun(doc: Document, span: Span, pkg: DocxPackage): Element | null {
  const obj = span.obj!;
  const ext = obj.mime ? MIME_EXT[obj.mime] : undefined;
  if (!obj.data || !ext) return null;
  const mediaDir = dirOf(pkg.mainPath) + 'media/';
  const path = pkg.uniquePath(`${mediaDir}image.${ext}`);
  pkg.addBinaryPart(path, obj.data, obj.mime);
  const rid = pkg.addRel(pkg.mainPath, REL.image, path.slice(dirOf(pkg.mainPath).length));
  const natural = imageSize(obj.data);
  let w = obj.width ?? natural?.w ?? 200;
  let h = obj.height ?? (natural && obj.width ? Math.round((natural.h * obj.width) / natural.w) : (natural?.h ?? 150));
  if (w > 624) {
    h = Math.round((h * 624) / w);
    w = 624;
  }
  const cx = w * 9525;
  const cy = h * 9525;
  const id = pkg.nextDocPrId();
  const alt = (obj.label ?? '').replace(/[<>&"]/g, '');
  const xml =
    `<w:r xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:r="${NS.r}"><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="image.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const run = doc.importNode(parseXml(xml).documentElement, true) as Element;
  const rPr = rPrFor(doc, span.fmt, pkg, false);
  if (rPr) run.insertBefore(rPr, run.firstChild);
  return run;
}

function noteRun(doc: Document, span: Span, pkg: DocxPackage): Element {
  const kind = span.obj!.kind === 'endnote' ? 'endnote' : 'footnote';
  const path = pkg.notesPath(kind, true)!;
  const notes = pkg.xml(path)!;
  let max = 0;
  for (const el of elements(notes.documentElement)) max = Math.max(max, parseInt(wAttr(el, 'id') ?? '0', 10) || 0);
  const id = String(max + 1);
  const note = createW(notes, kind, { id });
  const p = createW(notes, 'p');
  const refRun = createW(notes, 'r');
  const refPr = createW(notes, 'rPr');
  refPr.appendChild(createW(notes, 'vertAlign', { val: 'superscript' }));
  refRun.append(refPr, createW(notes, kind === 'footnote' ? 'footnoteRef' : 'endnoteRef'));
  const textRun = createW(notes, 'r');
  appendText(textRun, ' ' + (span.obj!.note ?? span.obj!.label ?? ''));
  p.append(refRun, textRun);
  note.appendChild(p);
  notes.documentElement.appendChild(note);
  pkg.markDirty(path);
  const r = createW(doc, 'r');
  const rPr = createW(doc, 'rPr');
  rPr.appendChild(createW(doc, 'vertAlign', { val: 'superscript' }));
  r.append(rPr, createW(doc, kind === 'footnote' ? 'footnoteReference' : 'endnoteReference', { id }));
  return r;
}

/** Runs (and hyperlinks) for model spans, created in `doc`. */
export function generateRuns(spans: readonly Span[], pkg: DocxPackage, doc: Document): Node[] {
  const out: Node[] = [];
  let link: { href: string; el: Element } | null = null;
  for (const s of spans) {
    if (s.marker) continue;
    let run: Element | null = null;
    if (s.obj) {
      if (s.obj.kind === 'image') run = drawingRun(doc, s, pkg);
      else if (s.obj.kind === 'footnote' || s.obj.kind === 'endnote') run = noteRun(doc, s, pkg);
      else if (s.obj.kind === 'pagebreak') {
        run = createW(doc, 'r');
        run.appendChild(createW(doc, 'br', { type: s.obj.key === 'column' ? 'column' : 'page' }));
      }
      if (!run) {
        const text = s.obj.text ?? (s.obj.kind === 'image' ? `[${s.obj.label}]` : '');
        if (!text) continue;
        run = createW(doc, 'r');
        const rPr = rPrFor(doc, s.fmt, pkg, false);
        if (rPr) run.appendChild(rPr);
        appendText(run, text);
      }
    } else {
      if (!s.text) continue;
      run = createW(doc, 'r');
      const rPr = rPrFor(doc, s.fmt, pkg, !!s.fmt.href);
      if (rPr) run.appendChild(rPr);
      appendText(run, s.text);
    }
    const href = s.fmt.href;
    if (href) {
      if (!link || link.href !== href) {
        const el = createW(doc, 'hyperlink');
        if (href.startsWith('#')) setWAttr(el, 'anchor', href.slice(1));
        else el.setAttributeNS(NS.r, 'r:id', pkg.addRel(pkg.mainPath, REL.hyperlink, href, true));
        setWAttr(el, 'history', '1');
        link = { href, el };
        out.push(el);
      }
      link.el.appendChild(run);
    } else {
      link = null;
      out.push(run);
    }
  }
  return out;
}

export function neighborNumId(list: ListInfo, neighbors: Array<Block | undefined>): string | undefined {
  for (const n of neighbors) {
    if (!n || n.type !== 'p' || !n.props.list) continue;
    const x = n.x as DocxBlockX | undefined;
    if (x?.numId && n.props.list.ordered === list.ordered) return x.numId;
  }
  return undefined;
}

export function generateParagraph(block: ParaBlock, ctx: GenerateContext): Element {
  const { pkg } = ctx;
  const doc = pkg.main;
  const p = createW(doc, 'p');
  const pPr = createW(doc, 'pPr');
  const styleId = paraStyleId(pkg, block.props.role, block.props.level);
  if (styleId) pPr.appendChild(createW(doc, 'pStyle', { val: styleId }));
  const list = block.props.list;
  if (list) {
    let numId = neighborNumId(list, ctx.neighbors);
    if (!numId) {
      let memo = generatedLists.get(pkg);
      if (!memo) generatedLists.set(pkg, (memo = new Map()));
      const key = `${ctx.source}/${list.key ?? ''}/${list.ordered ? 'o' : 'u'}`;
      numId = memo.get(key);
      if (!numId) {
        numId = createList(pkg, list.ordered, list);
        memo.set(key, numId);
      }
    }
    const numPr = createW(doc, 'numPr');
    numPr.append(createW(doc, 'ilvl', { val: String(list.level) }), createW(doc, 'numId', { val: numId }));
    pPr.appendChild(numPr);
  }
  if (block.props.align) pPr.appendChild(createW(doc, 'jc', { val: block.props.align === 'justify' ? 'both' : block.props.align }));
  if (pPr.firstChild) p.appendChild(pPr);
  for (const n of generateRuns(block.spans, pkg, doc)) p.appendChild(n);
  return p;
}

export function generateTable(block: TableBlock, ctx: GenerateContext): Element {
  const { pkg } = ctx;
  const doc = pkg.main;
  const cols = Math.max(1, ...block.rows.map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0)));
  const colW = Math.floor(9360 / cols);
  const tbl = createW(doc, 'tbl');
  const tblPr = createW(doc, 'tblPr');
  const grid = pkg.styles.findByName('table', 'Table Grid');
  if (grid) tblPr.appendChild(createW(doc, 'tblStyle', { val: grid.id }));
  tblPr.appendChild(createW(doc, 'tblW', { w: '0', type: 'auto' }));
  if (!grid) {
    const borders = createW(doc, 'tblBorders');
    for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
      borders.appendChild(createW(doc, side, { val: 'single', sz: '4', space: '0', color: 'auto' }));
    tblPr.appendChild(borders);
  }
  tblPr.appendChild(createW(doc, 'tblLook', { val: '04A0', firstRow: '1', lastRow: '0', firstColumn: '1', lastColumn: '0', noHBand: '0', noVBand: '1' }));
  tbl.appendChild(tblPr);
  const tblGrid = createW(doc, 'tblGrid');
  for (let i = 0; i < cols; i++) tblGrid.appendChild(createW(doc, 'gridCol', { w: String(colW) }));
  tbl.appendChild(tblGrid);
  for (const row of block.rows) tbl.appendChild(generateRow(row, ctx, colW));
  return tbl;
}

export function generateRow(row: TableRow, ctx: GenerateContext, colW = 2340): Element {
  const doc = ctx.pkg.main;
  const tr = createW(doc, 'tr');
  if (row.header) {
    const trPr = createW(doc, 'trPr');
    trPr.appendChild(createW(doc, 'tblHeader'));
    tr.appendChild(trPr);
  }
  for (const cell of row.cells) {
    const tc = createW(doc, 'tc');
    const tcPr = createW(doc, 'tcPr');
    tcPr.appendChild(createW(doc, 'tcW', { w: String(colW * (cell.colspan ?? 1)), type: 'dxa' }));
    if ((cell.colspan ?? 1) > 1) tcPr.appendChild(createW(doc, 'gridSpan', { val: String(cell.colspan) }));
    if (cell.vmerge) tcPr.appendChild(cell.vmerge === 'restart' ? createW(doc, 'vMerge', { val: 'restart' }) : createW(doc, 'vMerge'));
    tc.appendChild(tcPr);
    let hasPara = false;
    for (const b of cell.blocks) {
      const el = generateBlock(b, ctx);
      if (!el) continue;
      tc.appendChild(el);
      hasPara = isW(el, 'p');
    }
    // A cell must end with a paragraph.
    if (!hasPara) tc.appendChild(createW(doc, 'p'));
    tr.appendChild(tc);
  }
  return tr;
}

export function generateBlock(block: Block, ctx: GenerateContext): Element | null {
  switch (block.type) {
    case 'p':
      return generateParagraph(block, ctx);
    case 'table':
      return generateTable(block, ctx);
    case 'opaque': {
      const doc = ctx.pkg.main;
      const sdt = createW(doc, 'sdt');
      const sdtPr = createW(doc, 'sdtPr');
      const gallery = block.label === 'Table of contents' ? 'Table of Contents' : block.label === 'Bibliography' ? 'Bibliographies' : undefined;
      if (gallery) {
        // Word recognizes these as a table of contents / bibliography.
        const obj = createW(doc, 'docPartObj');
        obj.append(createW(doc, 'docPartGallery', { val: gallery }), createW(doc, 'docPartUnique'));
        sdtPr.appendChild(obj);
      } else {
        sdtPr.appendChild(createW(doc, 'alias', { val: block.label }));
      }
      const content = createW(doc, 'sdtContent');
      for (const b of block.blocks) {
        const el = generateBlock(b, ctx);
        if (el) content.appendChild(el);
      }
      if (!content.firstChild) content.appendChild(createW(doc, 'p'));
      sdt.append(sdtPr, content);
      return sdt;
    }
    case 'marker':
      return null;
  }
}

/* ------------------------------------------------------ splicing runs */

/**
 * Emits nodes into a paragraph while keeping inline wrappers (hyperlinks,
 * content controls, tracked changes) nested correctly.
 */
export class InlineEmitter {
  private stack: Array<{ src: Element; clone: Element }> = [];
  private opened = new Set<Element>();

  constructor(private readonly p: Element) {}

  private container(): Element {
    return this.stack.length ? this.stack[this.stack.length - 1]!.clone : this.p;
  }

  emit(nodes: Node[], wrap: readonly Element[]): void {
    let k = 0;
    while (k < this.stack.length && k < wrap.length && this.stack[k]!.src === wrap[k]) k++;
    this.stack.length = k;
    for (let i = k; i < wrap.length; i++) {
      const src = wrap[i]!;
      const clone = src.cloneNode(false) as Element;
      let content = clone;
      if (isW(src, 'sdt')) {
        for (const c of elements(src)) if (isW(c, 'sdtPr') || isW(c, 'sdtEndPr')) clone.appendChild(c.cloneNode(true));
        if (this.opened.has(src)) {
          const id = wChild(wChild(clone, 'sdtPr'), 'id');
          if (id) setWAttr(id, 'val', String(Math.floor(Math.random() * 1e9)));
        }
        content = createW(src.ownerDocument, 'sdtContent');
        clone.appendChild(content);
      } else {
        for (const c of elements(src)) if (isW(c, 'smartTagPr') || isW(c, 'customXmlPr')) clone.appendChild(c.cloneNode(true));
      }
      this.opened.add(src);
      this.container().appendChild(clone);
      this.stack.push({ src, clone: content });
    }
    const target = this.container();
    for (const n of nodes) target.appendChild(n);
  }
}

/** Nodes for part of a span that came from a DOCX paragraph (in that paragraph's document). */
export function spanNodes(span: Span, start: number, end: number, doc: Document): Node[] {
  const x = spanX(span);
  if (!x) return [];
  if (span.obj || span.marker) {
    const out: Node[] = [];
    for (const ref of x.nodes ?? []) {
      if (ref.run) {
        const r = runLike(ref.run, doc);
        r.appendChild(ref.node.cloneNode(true));
        out.push(r);
      } else {
        out.push(ref.node.cloneNode(true));
      }
    }
    return out;
  }
  const text = span.text.slice(start, end);
  if (!text) return [];
  const r = runLike(x.run, doc);
  appendText(r, text);
  return [r];
}

/* -------------------------------------------------------------- save */

function openContainer(src: Element, reopened: boolean): { el: Element; content: Element } {
  const clone = src.cloneNode(false) as Element;
  if (isW(src, 'sdt')) {
    for (const c of elements(src)) if (isW(c, 'sdtPr') || isW(c, 'sdtEndPr')) clone.appendChild(c.cloneNode(true));
    if (reopened) {
      const id = wChild(wChild(clone, 'sdtPr'), 'id');
      if (id) setWAttr(id, 'val', String(Math.floor(Math.random() * 1e9)));
    }
    const content = createW(src.ownerDocument, 'sdtContent');
    clone.appendChild(content);
    return { el: clone, content };
  }
  for (const c of elements(src)) if (isW(c, 'customXmlPr')) clone.appendChild(c.cloneNode(true));
  return { el: clone, content: clone };
}

/** Top-level body nodes for the blocks of a DOCX-backed document. */
export function bodyNodes(blocks: readonly Block[], pkg: DocxPackage, source = 'export'): Node[] {
  const out: Node[] = [];
  const stack: Array<{ src: Element; content: Element }> = [];
  const opened = new Set<Element>();
  for (const b of blocks) {
    const x = b.x as DocxBlockX | undefined;
    const el = x?.el ?? generateBlock(b, { pkg, source, neighbors: [] });
    if (!el) continue;
    const chain = x?.containers ?? [];
    let k = 0;
    while (k < stack.length && k < chain.length && stack[k]!.src === chain[k]) k++;
    stack.length = k;
    for (let i = k; i < chain.length; i++) {
      const src = chain[i]!;
      const c = openContainer(src, opened.has(src));
      opened.add(src);
      if (stack.length) stack[stack.length - 1]!.content.appendChild(c.el);
      else out.push(c.el);
      stack.push({ src, content: c.content });
    }
    if (stack.length) stack[stack.length - 1]!.content.appendChild(el.cloneNode(true));
    else out.push(el);
  }
  return out;
}

/* ------------------------------------------------------- new documents */

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}" xmlns:r="${NS.r}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** An empty but complete .docx package. */
export function newPackage(title: string): DocxPackage {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = new Map<string, Uint8Array>();
  const put = (path: string, text: string) => files.set(path, textToBytes(text));
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  put(
    '[Content_Types].xml',
    `${decl}<Types xmlns="${NS.ct}"><Default Extension="rels" ContentType="${CT.rels}"/><Default Extension="xml" ContentType="${CT.xml}"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="${CT.main}"/><Override PartName="/word/styles.xml" ContentType="${CT.styles}"/><Override PartName="/word/settings.xml" ContentType="${CT.settings}"/><Override PartName="/docProps/core.xml" ContentType="${CT.core}"/><Override PartName="/docProps/app.xml" ContentType="${CT.app}"/></Types>`,
  );
  put(
    '_rels/.rels',
    `${decl}<Relationships xmlns="${NS.rels}"><Relationship Id="rId1" Type="${REL.officeDocument}" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  put(
    'word/_rels/document.xml.rels',
    `${decl}<Relationships xmlns="${NS.rels}"><Relationship Id="rId1" Type="${REL.styles}" Target="styles.xml"/><Relationship Id="rId2" Type="${REL.settings}" Target="settings.xml"/></Relationships>`,
  );
  put(
    'word/document.xml',
    `${decl}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"><w:body><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>`,
  );
  put('word/styles.xml', STYLES_XML);
  put(
    'word/settings.xml',
    `${decl}<w:settings xmlns:w="${NS.w}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
  );
  put(
    'docProps/core.xml',
    `${decl}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>Collate</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put(
    'docProps/app.xml',
    `${decl}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Collate</Application></Properties>`,
  );
  return new DocxPackage(files);
}

/** Serializes a document as .docx: in place for DOCX-backed documents, as a new file otherwise. */
export function exportDocx(doc: Doc): Uint8Array {
  if (doc.pkg instanceof DocxPackage) return doc.pkg.save(bodyNodes(doc.blocks, doc.pkg));
  const pkg = newPackage(doc.name.replace(/\.[^.]+$/, ''));
  const nodes: Node[] = [];
  for (const b of doc.blocks) {
    // Lists are numbered by their own key, so separate lists stay separate.
    const el = generateBlock(b, { pkg, source: doc.id, neighbors: [] });
    if (el) nodes.push(el);
  }
  return pkg.save(nodes);
}

export { defaultSectPr };
