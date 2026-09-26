import { mergeRootNamespaces } from '../docx/package';
import { ODF, attr, child, create, is, kids, setAttr } from './ns';
import type { OdtPackage } from './package';
import { bytesToBase64 } from './package';

const NUMBER_NS = 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0';

/** Elements that only make sense in their original document (annotations, tracked-change marks, bookmarks). */
const STRIP_TEXT = new Set([
  'bookmark',
  'bookmark-start',
  'bookmark-end',
  'reference-mark',
  'reference-mark-start',
  'reference-mark-end',
  'change',
  'change-start',
  'change-end',
  'soft-page-break',
  'toc-mark',
  'toc-mark-start',
  'toc-mark-end',
  'alphabetical-index-mark',
  'alphabetical-index-mark-start',
  'alphabetical-index-mark-end',
  'user-index-mark',
  'user-index-mark-start',
  'user-index-mark-end',
]);

/** Style family referenced by `text:style-name` on each element. */
const TEXT_STYLE_FAMILY: Record<string, string> = {
  p: 'paragraph',
  h: 'paragraph',
  span: 'text',
  a: 'text',
  list: 'list',
  'numbered-paragraph': 'list',
  section: 'section',
  ruby: 'ruby',
  'list-level-style-number': 'text',
  'list-level-style-bullet': 'text',
};

const TABLE_STYLE_FAMILY: Record<string, string> = {
  table: 'table',
  'table-column': 'table-column',
  'table-row': 'table-row',
  'table-cell': 'table-cell',
  'covered-table-cell': 'table-cell',
};

const FRESH_BASE: Record<string, string> = {
  paragraph: 'P',
  text: 'T',
  table: 'Tbl',
  'table-column': 'TblCol',
  'table-row': 'TblRow',
  'table-cell': 'TblCell',
  graphic: 'fr',
  section: 'Sect',
  ruby: 'Ru',
  list: 'L',
  data: 'N',
};

let noteCounter = 0;

/**
 * Copies OpenDocument content from one package into another, bringing the
 * styles, list styles, fonts and pictures it references. One importer
 * exists per (source, target) pair so repeated copies share mappings.
 */
export class OdtImporter {
  private auto = new Map<string, string | null>();
  private named = new Map<string, string | null>();
  private lists = new Map<string, string | null>();
  private data = new Map<string, string | null>();
  private pictures = new Map<string, string>();
  private files = new Map<string, string>();
  private sigs: Map<string, string> | null = null;
  private nsDone = new Set<Document>();

  private constructor(
    readonly src: OdtPackage,
    readonly tgt: OdtPackage,
  ) {}

  static between(src: OdtPackage, tgt: OdtPackage): OdtImporter {
    let imp = tgt.importers.get(src.uid) as OdtImporter | undefined;
    if (!imp) {
      imp = new OdtImporter(src, tgt);
      tgt.importers.set(src.uid, imp);
    }
    return imp;
  }

  /** Imports body nodes of the source into the target's content document. */
  importNodes(nodes: readonly Node[]): Node[] {
    this.mergeNamespaces(this.src.content, this.tgt.content);
    const out: Node[] = [];
    for (const n of nodes) {
      const copy = this.tgt.content.importNode(n, true);
      if (copy.nodeType !== 1 || this.fixTree(copy as Element)) out.push(copy);
    }
    return out;
  }

  private mergeNamespaces(from: Document, to: Document): void {
    if (this.nsDone.has(to)) return;
    this.nsDone.add(to);
    if (mergeRootNamespaces(from.documentElement, to.documentElement) && to === this.tgt.stylesDoc) this.tgt.markStylesDirty();
  }

  /** Fixes references in an imported subtree. Returns false if the root itself must be dropped. */
  private fixTree(root: Element): boolean {
    const stack: Element[] = [root];
    while (stack.length) {
      const el = stack.pop()!;
      const ns = el.namespaceURI;
      const local = el.localName;
      if ((ns === ODF.text && STRIP_TEXT.has(local)) || (ns === ODF.office && (local === 'annotation' || local === 'annotation-end'))) {
        if (el === root) return false;
        el.parentNode?.removeChild(el);
        continue;
      }
      el.removeAttributeNS(ODF.xml, 'id');
      if (ns === ODF.text) {
        const fam = TEXT_STYLE_FAMILY[local];
        if (fam) this.remap(el, ODF.text, 'style-name', fam);
        if (local === 'p' || local === 'h') {
          this.remap(el, ODF.text, 'cond-style-name', 'paragraph');
          this.remap(el, ODF.loext, 'marker-style-name', 'text');
        } else if (local === 'a') {
          this.remap(el, ODF.text, 'visited-style-name', 'text');
        } else if (local === 'list') {
          el.removeAttributeNS(ODF.text, 'continue-list');
        } else if (local === 'list-item') {
          this.remap(el, ODF.text, 'style-override', 'list');
        } else if (local === 'note') {
          setAttr(el, ODF.text, 'id', `ftn_c${++noteCounter}`);
        } else if (local === 'section') {
          const name = attr(el, ODF.text, 'name') ?? 'Section';
          setAttr(el, ODF.text, 'name', this.tgt.uniqueName(ODF.text, 'section', ODF.text, 'name', name));
        }
        const dataStyle = attr(el, ODF.style, 'data-style-name');
        if (dataStyle) {
          const mapped = this.mapData(dataStyle);
          if (mapped) setAttr(el, ODF.style, 'data-style-name', mapped);
          else el.removeAttributeNS(ODF.style, 'data-style-name');
        }
      } else if (ns === ODF.table) {
        const fam = TABLE_STYLE_FAMILY[local];
        if (fam) this.remap(el, ODF.table, 'style-name', fam);
        if (local === 'table-column') this.remap(el, ODF.table, 'default-cell-style-name', 'table-cell');
        if (local === 'table') {
          const name = attr(el, ODF.table, 'name') ?? 'Table1';
          setAttr(el, ODF.table, 'name', this.tgt.uniqueName(ODF.table, 'table', ODF.table, 'name', name));
          el.removeAttributeNS(ODF.table, 'template-name');
        }
      } else if (ns === ODF.draw) {
        this.remap(el, ODF.draw, 'style-name', 'graphic');
        this.remap(el, ODF.draw, 'text-style-name', 'paragraph');
        if (local === 'frame') {
          const name = attr(el, ODF.draw, 'name');
          if (name) setAttr(el, ODF.draw, 'name', this.tgt.uniqueName(ODF.draw, 'frame', ODF.draw, 'name', name));
          el.removeAttributeNS(ODF.text, 'anchor-page-number');
        } else if (local === 'image') {
          this.fixImage(el);
        } else if (local === 'object' || local === 'object-ole') {
          if (!this.fixObject(el)) {
            el.parentNode?.removeChild(el);
            continue;
          }
        }
      }
      for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    }
    return true;
  }

  private remap(el: Element, ns: string, local: string, family: string): void {
    const v = attr(el, ns, local);
    if (!v) return;
    const mapped = family === 'list' ? this.mapList(v) : this.mapStyle(family, v);
    if (mapped) setAttr(el, ns, local, mapped);
    else el.removeAttributeNS(ns, local);
  }

  /* ------------------------------------------------------------ pictures */

  private fixImage(img: Element): void {
    const data = this.src.imageData(img);
    if (!data) return;
    const bin = child(img, ODF.office, 'binary-data');
    if (this.tgt.flat) {
      if (bin) return;
      img.removeAttributeNS(ODF.xlink, 'href');
      img.removeAttributeNS(ODF.xlink, 'type');
      img.removeAttributeNS(ODF.xlink, 'show');
      img.removeAttributeNS(ODF.xlink, 'actuate');
      const b = create(img.ownerDocument, ODF.office, 'binary-data');
      b.textContent = bytesToBase64(data.data);
      img.appendChild(b);
      return;
    }
    let href = this.pictures.get(data.hash);
    if (!href) {
      href = this.tgt.addPicture(data.data, data.mime)!;
      this.pictures.set(data.hash, href);
    }
    if (bin) img.removeChild(bin);
    setAttr(img, ODF.xlink, 'href', href);
    setAttr(img, ODF.xlink, 'type', 'simple');
    setAttr(img, ODF.xlink, 'show', 'embed');
    setAttr(img, ODF.xlink, 'actuate', 'onLoad');
  }

  /** Copies an embedded object (chart, formula …) and its files. Returns false when it cannot be carried over. */
  private fixObject(obj: Element): boolean {
    if (!obj.hasAttributeNS(ODF.xlink, 'href')) return !this.src.flat || this.tgt.flat;
    if (this.tgt.flat || this.src.flat) return false;
    const href = (attr(obj, ODF.xlink, 'href') ?? '').replace(/^\.\//, '').replace(/\/$/, '');
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return true;
    let mapped = this.files.get(href);
    if (!mapped) {
      let n = 1;
      mapped = href;
      const taken = (p: string) => [...this.tgt.files.keys()].some((k) => k === p || k.startsWith(p + '/'));
      while (taken(mapped)) mapped = `${href.replace(/\s*\d+$/, '')} ${++n + 1000}`;
      for (const [path, bytes] of this.src.files) {
        if (path !== href && !path.startsWith(href + '/')) continue;
        this.tgt.addFile(mapped + path.slice(href.length), bytes, this.src.fileType(path) ?? 'text/xml');
      }
      this.tgt.addFile(mapped + '/', undefined, this.src.fileType(href + '/') ?? 'application/vnd.oasis.opendocument.formula');
      this.files.set(href, mapped);
    }
    setAttr(obj, ODF.xlink, 'href', `./${mapped}`);
    return true;
  }

  /* -------------------------------------------------------------- styles */

  /** Target name for a style of the source (automatic styles are copied, named ones matched by name). */
  mapStyle(family: string, name: string): string | null {
    const st = this.src.styles.get(family, name);
    if (!st) return this.tgt.styles.get(family, name) && !this.tgt.styles.get(family, name)!.auto ? name : null;
    return st.auto ? this.mapAuto(family, name, st.el) : this.mapNamed(family, name);
  }

  private autoSigs(): Map<string, string> {
    if (!this.sigs) {
      this.sigs = new Map();
      for (const el of kids(this.tgt.autoStyles())) {
        const name = attr(el, ODF.style, 'name');
        if (name) this.sigs.set(signature(el), name);
      }
    }
    return this.sigs;
  }

  private mapAuto(family: string, name: string, el: Element): string | null {
    const key = `${family}:${name}`;
    const hit = this.auto.get(key);
    if (hit !== undefined) return hit;
    this.mergeNamespaces(this.src.content, this.tgt.content);
    const copy = this.tgt.content.importNode(el, true) as Element;
    this.fixStyle(copy, family);
    const sig = signature(copy);
    const same = this.autoSigs().get(sig);
    if (same) {
      this.auto.set(key, same);
      return same;
    }
    const fresh = this.tgt.freshStyleName(family, FRESH_BASE[family] ?? 'S', true);
    setAttr(copy, ODF.style, 'name', fresh);
    this.auto.set(key, fresh);
    this.tgt.addStyle(copy, true);
    this.autoSigs().set(sig, fresh);
    return fresh;
  }

  private mapNamed(family: string, name: string): string | null {
    const key = `${family}:${name}`;
    const hit = this.named.get(key);
    if (hit !== undefined) return hit;
    if (this.tgt.styles.named(family, name)) {
      this.named.set(key, name);
      return name;
    }
    const st = this.src.styles.named(family, name);
    if (!st) {
      this.named.set(key, null);
      return null;
    }
    const byDisplay = this.tgt.styles.namedByDisplay(family, st.display);
    if (byDisplay) {
      this.named.set(key, byDisplay.name);
      return byDisplay.name;
    }
    this.named.set(key, name);
    this.mergeNamespaces(this.src.stylesDoc, this.tgt.stylesDoc);
    const copy = this.tgt.stylesDoc.importNode(st.el, true) as Element;
    this.fixStyle(copy, family);
    this.tgt.addStyle(copy, false);
    return name;
  }

  /** Fixes the references inside a copied style element. */
  private fixStyle(el: Element, family: string): void {
    el.removeAttributeNS(ODF.style, 'master-page-name');
    for (const [local, fam] of [
      ['parent-style-name', family],
      ['next-style-name', family],
    ] as const) {
      const v = attr(el, ODF.style, local);
      if (!v) continue;
      const mapped = this.mapNamed(fam, v);
      if (mapped) setAttr(el, ODF.style, local, mapped);
      else el.removeAttributeNS(ODF.style, local);
    }
    const list = attr(el, ODF.style, 'list-style-name');
    if (list) {
      const mapped = this.mapList(list);
      if (mapped) setAttr(el, ODF.style, 'list-style-name', mapped);
      else el.removeAttributeNS(ODF.style, 'list-style-name');
    }
    const data = attr(el, ODF.style, 'data-style-name');
    if (data) {
      const mapped = this.mapData(data);
      if (mapped) setAttr(el, ODF.style, 'data-style-name', mapped);
      else el.removeAttributeNS(ODF.style, 'data-style-name');
    }
    el.removeAttributeNS(ODF.loext, 'linked-style-name');
    for (const d of Array.from(el.getElementsByTagNameNS('*', '*'))) {
      for (const local of ['font-name', 'font-name-asian', 'font-name-complex']) {
        const font = attr(d, ODF.style, local);
        if (font) this.ensureFont(font);
      }
      if (is(d, ODF.style, 'background-image') || is(d, ODF.draw, 'image')) this.fixImage(d);
      if (d.namespaceURI === ODF.text && (d.localName === 'list-level-style-number' || d.localName === 'list-level-style-bullet')) {
        const v = attr(d, ODF.text, 'style-name');
        if (v) {
          const mapped = this.mapStyle('text', v);
          if (mapped) setAttr(d, ODF.text, 'style-name', mapped);
          else d.removeAttributeNS(ODF.text, 'style-name');
        }
      }
    }
  }

  mapList(name: string): string | null {
    const hit = this.lists.get(name);
    if (hit !== undefined) return hit;
    const ls = this.src.styles.listStyle(name);
    if (!ls) {
      const r = this.tgt.styles.hasListStyle(name) ? name : null;
      this.lists.set(name, r);
      return r;
    }
    if (!ls.auto && this.tgt.styles.hasListStyle(name)) {
      this.lists.set(name, name);
      return name;
    }
    const doc = ls.auto ? this.tgt.content : this.tgt.stylesDoc;
    this.mergeNamespaces(ls.auto ? this.src.content : this.src.stylesDoc, doc);
    const copy = doc.importNode(ls.el, true) as Element;
    const fresh = ls.auto ? this.tgt.freshStyleName('list', 'L', true) : name;
    this.lists.set(name, fresh);
    setAttr(copy, ODF.style, 'name', fresh);
    this.fixStyle(copy, 'list');
    this.tgt.addStyle(copy, ls.auto);
    return fresh;
  }

  private mapData(name: string): string | null {
    const hit = this.data.get(name);
    if (hit !== undefined) return hit;
    const find = (root: Element | null) => (root ? kids(root).find((e) => e.namespaceURI === NUMBER_NS && attr(e, ODF.style, 'name') === name) : undefined);
    const auto = find(child(this.src.content.documentElement, ODF.office, 'automatic-styles'));
    const named = auto ? undefined : find(child(this.src.stylesDoc.documentElement, ODF.office, 'styles'));
    const el = auto ?? named;
    if (!el) {
      this.data.set(name, null);
      return null;
    }
    this.mergeNamespaces(this.src.content, this.tgt.content);
    const copy = this.tgt.content.importNode(el, true) as Element;
    const fresh = this.tgt.freshStyleName('data', 'N', true);
    setAttr(copy, ODF.style, 'name', fresh);
    this.tgt.autoStyles().appendChild(copy);
    this.data.set(name, fresh);
    return fresh;
  }

  private ensureFont(name: string): void {
    if (this.tgt.hasFont(name)) return;
    for (const doc of [this.src.content, this.src.stylesDoc]) {
      const decls = child(doc.documentElement, ODF.office, 'font-face-decls');
      const decl = decls ? kids(decls).find((f) => attr(f, ODF.style, 'name') === name) : undefined;
      if (decl) {
        this.tgt.addFont(decl);
        return;
      }
    }
  }
}

/** Serialized form of a style without its name, to find identical automatic styles. */
function signature(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.removeAttributeNS(ODF.style, 'name');
  return new XMLSerializer().serializeToString(copy);
}

