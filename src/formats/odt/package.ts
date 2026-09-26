import { unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { hashBytes } from '../../core/model';
import { bytesToText, parseXml, serializeXml, textToBytes } from '../docx/xml';
import { ODF, ODT_MIME, attr, child, create, is, kids, setAttr } from './ns';
import { OdtStyles } from './styles';

let pkgCounter = 0;

export const IMAGE_MIME: Record<string, string> = {
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

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

const TEXT_MIMES = new Set([ODT_MIME, 'application/vnd.oasis.opendocument.text-template', 'application/vnd.oasis.opendocument.text-master']);

const OTHER_KINDS: Record<string, string> = {
  spreadsheet: 'an OpenDocument spreadsheet',
  presentation: 'an OpenDocument presentation',
  graphics: 'an OpenDocument drawing',
  formula: 'an OpenDocument formula',
};

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 || i < path.lastIndexOf('/') ? '' : path.slice(i + 1).toLowerCase();
}

function kindError(mime: string): Error {
  const kind = /opendocument\.(\w+)/.exec(mime)?.[1] ?? '';
  const what = OTHER_KINDS[kind] ?? `a "${mime}" file`;
  return new Error(`This is ${what}, not a text document.`);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface ImageData {
  data: Uint8Array;
  mime: string;
  hash: string;
}

/**
 * An opened OpenDocument text file: a zipped .odt (content.xml, styles.xml,
 * pictures …) or a flat .fodt (one XML document holding everything).
 */
export class OdtPackage {
  readonly uid = `odt${++pkgCounter}`;
  readonly files: Map<string, Uint8Array>;
  readonly flat: boolean;
  readonly content: XMLDocument;
  readonly stylesDoc: XMLDocument;
  readonly body: Element;
  readonly mimetype: string;
  styles: OdtStyles;
  private manifest: XMLDocument | null;
  private stylesDirty = false;
  private manifestDirty = false;
  private imageUrls = new Map<string, string>();
  private hashes = new Map<string, string>();
  /** Objects owned by importers (one per source package). */
  readonly importers = new Map<string, unknown>();
  /** Numbering sequence of each list element (lists that continue each other share a key). */
  readonly listKeys = new WeakMap<Element, string>();
  private nameCounters = new Map<string, number>();
  private usedNames = new Map<string, Set<string>>();

  private constructor(files: Map<string, Uint8Array>, content: XMLDocument, stylesDoc: XMLDocument, flat: boolean, mimetype: string) {
    this.files = files;
    this.flat = flat;
    this.content = content;
    this.stylesDoc = stylesDoc;
    this.mimetype = mimetype;
    const office = child(content.documentElement, ODF.office, 'body');
    const text = child(office, ODF.office, 'text');
    if (!text) {
      const other = office ? office.firstElementChild?.localName : undefined;
      throw new Error(other ? `This OpenDocument file holds a ${other}, not a text document.` : 'The document has no body.');
    }
    this.body = text;
    this.manifest = flat ? null : files.has('META-INF/manifest.xml') ? parseXml(bytesToText(files.get('META-INF/manifest.xml')!)) : null;
    this.styles = this.buildStyles();
  }

  static open(data: Uint8Array): OdtPackage {
    const isZip = data[0] === 0x50 && data[1] === 0x4b;
    if (!isZip) {
      const doc = parseXml(bytesToText(data));
      const root = doc.documentElement;
      if (!is(root, ODF.office, 'document')) throw new Error('This file is not an OpenDocument text document.');
      const mime = attr(root, ODF.office, 'mimetype') ?? ODT_MIME;
      if (!TEXT_MIMES.has(mime)) throw kindError(mime);
      return new OdtPackage(new Map(), doc, doc, true, mime);
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data);
    } catch {
      throw new Error('The file could not be unzipped.');
    }
    const files = new Map<string, Uint8Array>();
    for (const [k, v] of Object.entries(entries)) if (!k.endsWith('/')) files.set(k.replace(/^\/+/, ''), v);
    const mime = files.has('mimetype') ? bytesToText(files.get('mimetype')!).trim() : ODT_MIME;
    if (!TEXT_MIMES.has(mime)) throw kindError(mime);
    const content = files.get('content.xml');
    if (!content) throw new Error('This file is not an OpenDocument text document (content.xml is missing).');
    const contentDoc = parseXml(bytesToText(content));
    const stylesBytes = files.get('styles.xml');
    const stylesDoc = stylesBytes
      ? parseXml(bytesToText(stylesBytes))
      : parseXml(`<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="${ODF.office}" xmlns:style="${ODF.style}" xmlns:text="${ODF.text}" xmlns:fo="${ODF.fo}" office:version="1.3"><office:styles/></office:document-styles>`);
    return new OdtPackage(files, contentDoc, stylesDoc, false, mime);
  }

  /** Wraps parts that were built in memory (new documents). */
  static fromParts(files: Map<string, Uint8Array>): OdtPackage {
    const content = parseXml(bytesToText(files.get('content.xml')!));
    const styles = parseXml(bytesToText(files.get('styles.xml')!));
    return new OdtPackage(files, content, styles, false, ODT_MIME);
  }

  private buildStyles(): OdtStyles {
    return new OdtStyles(child(this.stylesDoc.documentElement, ODF.office, 'styles'), [child(this.content.documentElement, ODF.office, 'automatic-styles')]);
  }

  /* ------------------------------------------------------------ styles */

  /** office:automatic-styles of the body (created when missing). */
  autoStyles(): Element {
    const root = this.content.documentElement;
    let el = child(root, ODF.office, 'automatic-styles');
    if (!el) {
      el = create(this.content, ODF.office, 'automatic-styles');
      root.insertBefore(el, child(root, ODF.office, 'master-styles') ?? child(root, ODF.office, 'body'));
    }
    return el;
  }

  /** office:styles, where named styles live (created when missing). */
  namedStyles(): Element {
    const root = this.stylesDoc.documentElement;
    let el = child(root, ODF.office, 'styles');
    if (!el) {
      el = create(this.stylesDoc, ODF.office, 'styles');
      const after = child(root, ODF.office, 'font-face-decls');
      root.insertBefore(el, after ? after.nextSibling : root.firstChild);
    }
    return el;
  }

  fontDecls(doc: Document): Element {
    const root = doc.documentElement;
    let el = child(root, ODF.office, 'font-face-decls');
    if (!el) {
      el = create(doc, ODF.office, 'font-face-decls');
      const before = child(root, ODF.office, 'styles') ?? child(root, ODF.office, 'automatic-styles') ?? child(root, ODF.office, 'master-styles') ?? child(root, ODF.office, 'body');
      root.insertBefore(el, before);
    }
    return el;
  }

  hasFont(name: string): boolean {
    for (const doc of this.flat ? [this.content] : [this.content, this.stylesDoc]) {
      const decls = child(doc.documentElement, ODF.office, 'font-face-decls');
      if (!decls || !kids(decls).some((f) => attr(f, ODF.style, 'name') === name)) return false;
    }
    return true;
  }

  /** Declares a font face in every part that uses fonts. */
  addFont(decl: Element): void {
    const name = attr(decl, ODF.style, 'name');
    if (!name) return;
    for (const doc of this.flat ? [this.content] : [this.content, this.stylesDoc]) {
      const decls = this.fontDecls(doc);
      if (kids(decls).some((f) => attr(f, ODF.style, 'name') === name)) continue;
      decls.appendChild(doc.importNode(decl, true));
      if (doc === this.stylesDoc) this.stylesDirty = true;
    }
  }

  markStylesDirty(): void {
    this.stylesDirty = true;
  }

  /** Adds a style element (already owned by the right document) and indexes it. */
  addStyle(el: Element, auto: boolean): void {
    if (auto) this.autoStyles().appendChild(el);
    else {
      this.namedStyles().appendChild(el);
      this.stylesDirty = true;
    }
    this.styles.add(el, auto);
  }

  /** A style name not used yet in the given family, based on `base` ("P" → "P12"). */
  freshStyleName(family: string, base: string, auto: boolean): string {
    const key = `${family}:${base}:${auto}`;
    let n = this.nameCounters.get(key) ?? 0;
    const taken = (name: string) =>
      family === 'list' ? this.styles.hasListStyle(name) : this.styles.hasName(family, name, true) || this.styles.hasName(family, name, false);
    let name: string;
    do {
      n++;
      name = `${base}${n}`;
    } while (taken(name));
    this.nameCounters.set(key, n);
    return name;
  }

  /**
   * A name unique among the document's elements carrying `attrLocal` (tables,
   * frames, sections …) and among names handed out before.
   */
  uniqueName(ns: string, local: string, attrNs: string, attrLocal: string, base: string): string {
    const key = `${local}:${attrLocal}`;
    let used = this.usedNames.get(key);
    if (!used) {
      used = new Set<string>();
      for (const el of Array.from(this.content.getElementsByTagNameNS(ns, local))) {
        const v = attr(el, attrNs, attrLocal);
        if (v) used.add(v);
      }
      this.usedNames.set(key, used);
    }
    let name = base;
    if (used.has(name)) {
      const stem = base.replace(/\d+$/, '');
      for (let i = 1; used.has((name = `${stem}${i}`)); i++);
    }
    used.add(name);
    return name;
  }

  /* ------------------------------------------------------------ images */

  /** Bytes of the picture shown by a draw:image element, from the package or inline base64. */
  imageData(img: Element): ImageData | undefined {
    const bin = child(img, ODF.office, 'binary-data');
    if (bin) {
      try {
        const data = base64ToBytes(bin.textContent ?? '');
        const mime = attr(img, ODF.draw, 'mime-type') ?? sniffMime(data) ?? 'application/octet-stream';
        return { data, mime, hash: hashBytes(data) };
      } catch {
        return undefined;
      }
    }
    const href = attr(img, ODF.xlink, 'href');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
    const path = href.replace(/^\.\//, '').replace(/^\/+/, '');
    const data = this.files.get(path);
    if (!data) return undefined;
    let hash = this.hashes.get(path);
    if (!hash) {
      hash = hashBytes(data);
      this.hashes.set(path, hash);
    }
    const mime = attr(img, ODF.draw, 'mime-type') ?? this.manifestType(path) ?? IMAGE_MIME[extOf(path)] ?? sniffMime(data) ?? 'application/octet-stream';
    return { data, mime, hash };
  }

  /** A blob: URL for displaying picture bytes. */
  imageUrl(image: ImageData): string | undefined {
    const hit = this.imageUrls.get(image.hash);
    if (hit) return hit;
    if (!/^image\/(png|jpeg|gif|bmp|svg\+xml|webp)$/.test(image.mime) || typeof URL.createObjectURL !== 'function') return undefined;
    try {
      const url = URL.createObjectURL(new Blob([image.data as BlobPart], { type: image.mime }));
      this.imageUrls.set(image.hash, url);
      return url;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores picture bytes in the package and returns the href for draw:image,
   * or undefined for flat files (which embed pictures as base64).
   */
  addPicture(data: Uint8Array, mime: string): string | undefined {
    if (this.flat) return undefined;
    const hash = hashBytes(data);
    for (const [path, bytes] of this.files) {
      if (!path.startsWith('Pictures/')) continue;
      let h = this.hashes.get(path);
      if (!h) {
        h = hashBytes(bytes);
        this.hashes.set(path, h);
      }
      if (h === hash) return path;
    }
    const ext = MIME_EXT[mime] ?? 'bin';
    let path = `Pictures/${hash.replace(/[^0-9a-f]/g, '')}.${ext}`;
    for (let i = 2; this.files.has(path); i++) path = `Pictures/${hash.replace(/[^0-9a-f]/g, '')}_${i}.${ext}`;
    this.files.set(path, data);
    this.hashes.set(path, hash);
    this.addManifestEntry(path, mime);
    return path;
  }

  /** Adds a file (or, with no data, a sub-document folder) to the package and its manifest. */
  addFile(path: string, data: Uint8Array | undefined, mime: string): void {
    if (this.flat) return;
    if (data) {
      this.files.set(path, data);
      this.hashes.delete(path);
    }
    this.addManifestEntry(path, mime);
  }

  /** Media type of a file, as listed in the manifest. */
  fileType(path: string): string | undefined {
    return this.manifestType(path);
  }

  private manifestType(path: string): string | undefined {
    if (!this.manifest) return undefined;
    for (const el of kids(this.manifest.documentElement)) if (attr(el, ODF.manifest, 'full-path') === path) return attr(el, ODF.manifest, 'media-type') ?? undefined;
    return undefined;
  }

  private addManifestEntry(path: string, mime: string): void {
    if (!this.manifest) return;
    const root = this.manifest.documentElement;
    if (kids(root).some((el) => attr(el, ODF.manifest, 'full-path') === path)) return;
    const el = this.manifest.createElementNS(ODF.manifest, 'manifest:file-entry');
    el.setAttributeNS(ODF.manifest, 'manifest:full-path', path);
    el.setAttributeNS(ODF.manifest, 'manifest:media-type', mime);
    root.appendChild(el);
    this.manifestDirty = true;
  }

  dispose(): void {
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
    this.imageUrls.clear();
  }

  /* -------------------------------------------------------------- save */

  /** Writes the file with a new body; `bodyNodes` belong to the content document and are cloned. */
  save(bodyNodes: Node[]): Uint8Array {
    const src = this.content;
    const out = src.implementation.createDocument(null, null, null);
    const root = out.importNode(src.documentElement, false) as Element;
    out.appendChild(root);
    for (const c of Array.from(src.documentElement.childNodes)) {
      if (is(c, ODF.office, 'body')) {
        const body = out.importNode(c, false) as Element;
        const text = out.importNode(this.body, false) as Element;
        for (const n of bodyNodes) text.appendChild(out.importNode(n, true));
        body.appendChild(text);
        root.appendChild(body);
      } else {
        root.appendChild(out.importNode(c, true));
      }
    }
    const xml = textToBytes(serializeXml(out));
    if (this.flat) return xml;

    const zip: Zippable = {};
    // The mimetype entry comes first and is stored uncompressed, so tools can sniff the file type.
    zip['mimetype'] = [textToBytes(this.mimetype), { level: 0 }];
    for (const [name, data] of this.files) {
      if (name === 'mimetype') continue;
      let bytes = data;
      if (name === 'content.xml') bytes = xml;
      else if (name === 'styles.xml' && this.stylesDirty) bytes = textToBytes(serializeXml(this.stylesDoc));
      else if (name === 'META-INF/manifest.xml' && this.manifestDirty && this.manifest) bytes = textToBytes(serializeXml(this.manifest));
      const ext = extOf(name);
      zip[name] = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? [bytes, { level: 0 }] : [bytes, { level: 6 }];
    }
    if (!this.files.has('styles.xml') && this.stylesDirty) zip['styles.xml'] = [textToBytes(serializeXml(this.stylesDoc)), { level: 6 }];
    return zipSync(zip);
  }
}

export function sniffMime(data: Uint8Array): string | undefined {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp';
  return undefined;
}

export { setAttr };
