import { unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { NumberingIndex } from './numbering';
import { StyleIndex } from './styles';
import {
  CT,
  NS,
  REL,
  STRICT_W,
  bytesToText,
  createW,
  elements,
  hashBytes,
  isW,
  parseXml,
  serializeXml,
  setWAttr,
  textToBytes,
  wAttr,
  wChild,
} from './xml';

export interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

let pkgCounter = 0;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
};

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1).toLowerCase();
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Resolves a relationship target relative to the part that owns the relationship. */
export function resolveTarget(fromPart: string, target: string): string {
  const t = decodeURI(target.split('#')[0]!);
  if (t.startsWith('/')) return normalizePath(t);
  return normalizePath(dirOf(fromPart) + t);
}

/** Relative path from the folder of `fromPart` to `toPath`. */
export function relativeTarget(fromPart: string, toPath: string): string {
  const from = dirOf(fromPart).split('/').filter(Boolean);
  const to = toPath.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
}

export function relsPathFor(part: string): string {
  return `${dirOf(part)}_rels/${part.slice(part.lastIndexOf('/') + 1)}.rels`;
}

/**
 * An opened .docx package. Parts are kept as raw bytes; XML parts that are
 * read are parsed once and, if modified, serialized again on save.
 */
export class DocxPackage {
  readonly uid = `pkg${++pkgCounter}`;
  readonly files: Map<string, Uint8Array>;
  private xmlParts = new Map<string, XMLDocument>();
  private dirty = new Set<string>();
  private relsCache = new Map<string, Map<string, Rel>>();
  private imageUrls = new Map<string, string>();
  private hashes = new Map<string, string>();
  private docPrNext = 0;
  readonly mainPath: string;
  readonly main: XMLDocument;
  readonly body: Element;
  readonly finalSectPr: Element | null;
  styles: StyleIndex;
  numbering: NumberingIndex;
  /** Map of objects owned by importers (per source package). */
  readonly importers = new Map<string, unknown>();

  constructor(files: Map<string, Uint8Array>) {
    this.files = files;
    const rootRels = this.rels('');
    const office = [...rootRels.values()].find((r) => r.type === REL.officeDocument || r.type.endsWith('/officeDocument'));
    const mainPath = office ? resolveTarget('', office.target) : 'word/document.xml';
    if (!this.files.has(mainPath)) throw new Error('This file is not a Word document (word/document.xml is missing).');
    this.mainPath = mainPath;
    this.main = this.xml(mainPath)!;
    const root = this.main.documentElement;
    if (root.namespaceURI === STRICT_W)
      throw new Error('This document uses the "Strict Open XML" format. Open it in Word and save it as a regular Word Document (.docx).');
    const body = wChild(root, 'body');
    if (!body) throw new Error('The document has no body.');
    this.body = body;
    const last = body.lastElementChild;
    this.finalSectPr = isW(last, 'sectPr') ? last : null;
    const stylesPath = this.partByRel(mainPath, REL.styles);
    this.styles = new StyleIndex(stylesPath ? this.xml(stylesPath) : null);
    const numPath = this.partByRel(mainPath, REL.numbering);
    this.numbering = new NumberingIndex(numPath ? this.xml(numPath) : null);
  }

  static open(data: ArrayBuffer | Uint8Array): DocxPackage {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
    } catch {
      throw new Error('This file is not a valid .docx (it could not be unzipped).');
    }
    const files = new Map<string, Uint8Array>();
    for (const [k, v] of Object.entries(entries)) {
      if (k.endsWith('/')) continue;
      files.set(k.replace(/^\/+/, ''), v);
    }
    if (!files.has('[Content_Types].xml')) throw new Error('This file is not a Word document (no [Content_Types].xml).');
    return new DocxPackage(files);
  }

  /* ------------------------------------------------------------ parts */

  has(path: string): boolean {
    return this.files.has(path) || this.xmlParts.has(path);
  }

  /** Parsed XML of a part (cached), or null if the part does not exist. */
  xml(path: string): XMLDocument | null {
    const hit = this.xmlParts.get(path);
    if (hit) return hit;
    const bytes = this.files.get(path);
    if (!bytes) return null;
    const doc = parseXml(bytesToText(bytes));
    this.xmlParts.set(path, doc);
    return doc;
  }

  setXml(path: string, doc: XMLDocument): void {
    this.xmlParts.set(path, doc);
    this.dirty.add(path);
  }

  markDirty(path: string): void {
    this.dirty.add(path);
  }

  bytes(path: string): Uint8Array | undefined {
    const doc = this.xmlParts.get(path);
    if (doc && this.dirty.has(path)) return textToBytes(serializeXml(doc));
    return this.files.get(path);
  }

  hashOf(path: string): string | undefined {
    let h = this.hashes.get(path);
    if (h) return h;
    const b = this.files.get(path);
    if (!b) return undefined;
    h = hashBytes(b);
    this.hashes.set(path, h);
    return h;
  }

  addBinaryPart(path: string, data: Uint8Array, contentType: string | undefined): void {
    this.files.set(path, data);
    this.hashes.delete(path);
    if (contentType) this.ensureContentType(path, contentType);
  }

  /** A part path that is not taken yet, based on `path`. */
  uniquePath(path: string): string {
    if (!this.has(path)) return path;
    const dir = dirOf(path);
    const base = path.slice(dir.length);
    const dot = base.lastIndexOf('.');
    const stem = dot < 0 ? base : base.slice(0, dot);
    const ext = dot < 0 ? '' : base.slice(dot);
    for (let i = 2; ; i++) {
      const candidate = `${dir}${stem}_${i}${ext}`;
      if (!this.has(candidate)) return candidate;
    }
  }

  /* ---------------------------------------------------- relationships */

  rels(part: string): Map<string, Rel> {
    const hit = this.relsCache.get(part);
    if (hit) return hit;
    const map = new Map<string, Rel>();
    const doc = this.xml(part === '' ? '_rels/.rels' : relsPathFor(part));
    if (doc) {
      for (const el of Array.from(doc.getElementsByTagNameNS(NS.rels, 'Relationship'))) {
        const id = el.getAttribute('Id');
        if (!id) continue;
        map.set(id, {
          id,
          type: el.getAttribute('Type') ?? '',
          target: el.getAttribute('Target') ?? '',
          external: el.getAttribute('TargetMode') === 'External',
        });
      }
    }
    this.relsCache.set(part, map);
    return map;
  }

  /** First part related to `part` with the given relationship type. */
  partByRel(part: string, type: string): string | undefined {
    for (const r of this.rels(part).values()) if (r.type === type && !r.external) return resolveTarget(part, r.target);
    return undefined;
  }

  addRel(part: string, type: string, target: string, external = false): string {
    const rels = this.rels(part);
    for (const r of rels.values()) if (r.type === type && r.target === target && r.external === external) return r.id;
    const relsPath = part === '' ? '_rels/.rels' : relsPathFor(part);
    let doc = this.xml(relsPath);
    if (!doc) {
      doc = parseXml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rels}"></Relationships>`);
      this.ensureContentType(relsPath, CT.rels);
    }
    let n = rels.size + 1;
    for (const id of rels.keys()) {
      const m = /^rId(\d+)$/.exec(id);
      if (m) n = Math.max(n, parseInt(m[1]!, 10) + 1);
    }
    let id = `rId${n}`;
    while (rels.has(id)) id = `rId${++n}`;
    const el = doc.createElementNS(NS.rels, 'Relationship');
    el.setAttribute('Id', id);
    el.setAttribute('Type', type);
    el.setAttribute('Target', target);
    if (external) el.setAttribute('TargetMode', 'External');
    doc.documentElement.appendChild(el);
    this.setXml(relsPath, doc);
    rels.set(id, { id, type, target, external });
    return id;
  }

  /* ---------------------------------------------------- content types */

  private get types(): XMLDocument {
    return this.xml('[Content_Types].xml')!;
  }

  contentType(path: string): string | undefined {
    const name = '/' + path;
    let def: string | undefined;
    const ext = extOf(path);
    for (const el of elements(this.types.documentElement)) {
      if (el.localName === 'Override' && (el.getAttribute('PartName') ?? '').toLowerCase() === name.toLowerCase())
        return el.getAttribute('ContentType') ?? undefined;
      if (el.localName === 'Default' && (el.getAttribute('Extension') ?? '').toLowerCase() === ext)
        def = el.getAttribute('ContentType') ?? undefined;
    }
    return def ?? IMAGE_TYPES[ext];
  }

  ensureContentType(path: string, contentType: string): void {
    const ext = extOf(path);
    const root = this.types.documentElement;
    const name = '/' + path;
    for (const el of elements(root)) {
      if (el.localName === 'Override' && (el.getAttribute('PartName') ?? '').toLowerCase() === name.toLowerCase()) return;
      if (el.localName === 'Default' && (el.getAttribute('Extension') ?? '').toLowerCase() === ext) {
        if (el.getAttribute('ContentType') === contentType) return;
        break;
      }
    }
    const isDefaultable = !!IMAGE_TYPES[ext] || ext === 'bin' || ext === 'xlsx' || ext === 'rels';
    const hasDefault = elements(root).some((el) => el.localName === 'Default' && (el.getAttribute('Extension') ?? '').toLowerCase() === ext);
    let el: Element;
    if (isDefaultable && !hasDefault) {
      el = this.types.createElementNS(NS.ct, 'Default');
      el.setAttribute('Extension', ext);
      el.setAttribute('ContentType', contentType);
      // Defaults conventionally come before overrides.
      const firstOverride = elements(root).find((e) => e.localName === 'Override');
      root.insertBefore(el, firstOverride ?? null);
    } else {
      el = this.types.createElementNS(NS.ct, 'Override');
      el.setAttribute('PartName', name);
      el.setAttribute('ContentType', contentType);
      root.appendChild(el);
    }
    this.markDirty('[Content_Types].xml');
  }

  /* ------------------------------------------------------------ parts */

  stylesPath(create = false): string | undefined {
    let p = this.partByRel(this.mainPath, REL.styles);
    if (!p && create) {
      p = this.uniquePath(dirOf(this.mainPath) + 'styles.xml');
      const doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS.w}" xmlns:r="${NS.r}"></w:styles>`,
      );
      this.setXml(p, doc);
      this.ensureContentType(p, CT.styles);
      this.addRel(this.mainPath, REL.styles, relativeTarget(this.mainPath, p));
      this.styles = new StyleIndex(doc);
    }
    return p;
  }

  numberingPath(create = false): string | undefined {
    let p = this.partByRel(this.mainPath, REL.numbering);
    if (!p && create) {
      p = this.uniquePath(dirOf(this.mainPath) + 'numbering.xml');
      const doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS.w}" xmlns:r="${NS.r}"></w:numbering>`,
      );
      this.setXml(p, doc);
      this.ensureContentType(p, CT.numbering);
      this.addRel(this.mainPath, REL.numbering, relativeTarget(this.mainPath, p));
      this.numbering = new NumberingIndex(doc);
    }
    return p;
  }

  notesPath(kind: 'footnote' | 'endnote', create = false): string | undefined {
    const relType = kind === 'footnote' ? REL.footnotes : REL.endnotes;
    let p = this.partByRel(this.mainPath, relType);
    if (!p && create) {
      const rootName = kind === 'footnote' ? 'footnotes' : 'endnotes';
      p = this.uniquePath(dirOf(this.mainPath) + rootName + '.xml');
      const sep = (type: string, id: string, inner: string) =>
        `<w:${kind} w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${inner}/></w:r></w:p></w:${kind}>`;
      const doc = parseXml(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${rootName} xmlns:w="${NS.w}" xmlns:r="${NS.r}">` +
          sep('separator', '-1', 'separator') +
          sep('continuationSeparator', '0', 'continuationSeparator') +
          `</w:${rootName}>`,
      );
      this.setXml(p, doc);
      this.ensureContentType(p, kind === 'footnote' ? CT.footnotes : CT.endnotes);
      this.addRel(this.mainPath, relType, relativeTarget(this.mainPath, p));
    }
    return p;
  }

  /** Plain-text content of every footnote or endnote, by id. */
  noteTexts(kind: 'footnote' | 'endnote'): Map<string, Element> {
    const out = new Map<string, Element>();
    const p = this.notesPath(kind);
    const doc = p ? this.xml(p) : null;
    if (!doc) return out;
    for (const el of elements(doc.documentElement)) if (isW(el, kind)) out.set(wAttr(el, 'id') ?? '', el);
    return out;
  }

  /** Next free id for drawing objects (wp:docPr/@id must be unique in the document). */
  nextDocPrId(): number {
    if (!this.docPrNext) {
      let max = 0;
      for (const [path, bytes] of this.files) {
        if (!path.endsWith('.xml') || !path.startsWith(dirOf(this.mainPath))) continue;
        const text = this.xmlParts.has(path) ? serializeXml(this.xmlParts.get(path)!) : bytesToText(bytes);
        for (const m of text.matchAll(/<wp:docPr\b[^>]*?\sid="(\d+)"/g)) max = Math.max(max, parseInt(m[1]!, 10));
      }
      this.docPrNext = max + 1;
    }
    return this.docPrNext++;
  }

  /** A blob: URL for an image part, for display. */
  imageUrl(path: string): string | undefined {
    const hit = this.imageUrls.get(path);
    if (hit) return hit;
    const bytes = this.files.get(path);
    if (!bytes || typeof URL.createObjectURL !== 'function') return undefined;
    const type = this.contentType(path) ?? IMAGE_TYPES[extOf(path)] ?? 'application/octet-stream';
    if (!/^image\/(png|jpeg|gif|bmp|svg\+xml|webp)$/.test(type)) return undefined;
    try {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
      this.imageUrls.set(path, url);
      return url;
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
    this.imageUrls.clear();
  }

  /* ------------------------------------------------------------- save */

  /**
   * Writes the package with a new body. `bodyNodes` are the top-level body
   * children (they are cloned; the originals are not touched).
   */
  save(bodyNodes: Node[]): Uint8Array {
    const src = this.main;
    const out = src.implementation.createDocument(null, null, null);
    const root = out.importNode(src.documentElement, false) as Element;
    out.appendChild(root);
    for (const child of Array.from(src.documentElement.childNodes)) {
      if (isW(child, 'body')) {
        const body = out.importNode(child, false) as Element;
        for (const n of bodyNodes) body.appendChild(out.importNode(n, true));
        if (this.finalSectPr) body.appendChild(out.importNode(this.finalSectPr, true));
        root.appendChild(body);
      } else {
        root.appendChild(out.importNode(child, true));
      }
    }

    const zip: Zippable = {};
    // [Content_Types].xml goes first by convention.
    zip['[Content_Types].xml'] = this.bytes('[Content_Types].xml')!;
    const names = new Set<string>([...this.files.keys(), ...this.xmlParts.keys()]);
    for (const name of names) {
      if (name === '[Content_Types].xml') continue;
      const data = name === this.mainPath ? textToBytes(serializeXml(out)) : this.bytes(name);
      if (!data) continue;
      const ext = extOf(name);
      // Media is already compressed; storing it is faster and no bigger.
      zip[name] = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? [data, { level: 0 }] : [data, { level: 6 }];
    }
    return zipSync(zip);
  }
}

/** Creates the root namespace declarations the target needs to hold content from `from`. */
export function mergeRootNamespaces(from: Element, to: Element): boolean {
  let changed = false;
  const declared = new Map<string, string>();
  for (const a of Array.from(to.attributes)) if (a.prefix === 'xmlns') declared.set(a.localName, a.value);
  for (const a of Array.from(from.attributes)) {
    if (a.prefix !== 'xmlns') continue;
    if (declared.has(a.localName)) continue;
    to.setAttributeNS(NS.xmlns, `xmlns:${a.localName}`, a.value);
    declared.set(a.localName, a.value);
    changed = true;
  }
  const ignFrom = (from.getAttributeNS(NS.mc, 'Ignorable') ?? '').split(/\s+/).filter(Boolean);
  if (ignFrom.length) {
    const ignTo = (to.getAttributeNS(NS.mc, 'Ignorable') ?? '').split(/\s+/).filter(Boolean);
    const add = ignFrom.filter((p) => !ignTo.includes(p) && declared.get(p) === from.lookupNamespaceURI(p));
    if (add.length && (declared.has('mc') || to.lookupNamespaceURI('mc') === NS.mc)) {
      to.setAttributeNS(NS.mc, 'mc:Ignorable', [...ignTo, ...add].join(' '));
      changed = true;
    }
  }
  return changed;
}

/** New empty w:sectPr for US Letter with 1" margins. */
export function defaultSectPr(doc: Document): Element {
  const s = createW(doc, 'sectPr');
  const pgSz = createW(doc, 'pgSz', { w: '12240', h: '15840' });
  const pgMar = createW(doc, 'pgMar', { top: '1440', right: '1440', bottom: '1440', left: '1440', header: '720', footer: '720', gutter: '0' });
  s.append(pgSz, pgMar);
  return s;
}

export { setWAttr };
