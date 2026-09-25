import type { DocxPackage } from './package';
import { dirOf, extOf, mergeRootNamespaces, relativeTarget, relsPathFor, resolveTarget } from './package';
import { NS, elements, isW, setWAttr, wAttr, wChild } from './xml';

/** Elements that only make sense in their original document (annotations, proofing marks). */
const STRIP = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
  'annotationRef',
  'permStart',
  'permEnd',
  'proofErr',
]);

/** Revision marks whose w:id must be unique within the document. */
const REVISIONS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
  'cellMerge',
]);

function randomInt31(): number {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}

function randomHex8(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .toUpperCase()
    .padStart(8, '0');
}

let revisionCounter = 0;

/**
 * Copies XML content from one package into another. Relationship ids,
 * media, styles, numbering definitions and footnotes referenced by the
 * copied content are brought along; ids that must be unique are renewed.
 * One importer exists per (source, target) pair so repeated copies share
 * mappings (the same list keeps numbering, an image is copied once).
 */
export class Importer {
  private rids = new Map<string, string | null>();
  private parts = new Map<string, string>();
  private styleIds = new Map<string, string | null>();
  private numIds = new Map<string, string | null>();
  private noteIds = new Map<string, string | null>();
  private nsDone = new Set<string>();

  private constructor(
    readonly src: DocxPackage,
    readonly tgt: DocxPackage,
  ) {}

  static between(src: DocxPackage, tgt: DocxPackage): Importer {
    let imp = tgt.importers.get(src.uid) as Importer | undefined;
    if (!imp) {
      imp = new Importer(src, tgt);
      tgt.importers.set(src.uid, imp);
    }
    return imp;
  }

  /**
   * Imports nodes from `srcPart` of the source package into the XML document
   * of `tgtPart`. Returned nodes are detached and owned by the target document.
   */
  importNodes(nodes: readonly Node[], srcPart: string, tgtPart: string): Node[] {
    const tgtDoc = this.tgt.xml(tgtPart);
    const srcDoc = this.src.xml(srcPart);
    if (!tgtDoc || !srcDoc) throw new Error(`Missing part ${tgtDoc ? srcPart : tgtPart}`);
    this.mergeNamespaces(srcDoc, tgtDoc, tgtPart);
    const out: Node[] = [];
    for (const n of nodes) {
      const copy = tgtDoc.importNode(n, true);
      if (copy.nodeType !== 1 || this.fixTree(copy as Element, srcPart, tgtPart)) out.push(copy);
    }
    return out;
  }

  private mergeNamespaces(srcDoc: Document, tgtDoc: Document, tgtPart: string): void {
    const key = tgtPart;
    if (this.nsDone.has(key)) return;
    this.nsDone.add(key);
    if (mergeRootNamespaces(srcDoc.documentElement, tgtDoc.documentElement)) this.tgt.markDirty(tgtPart);
  }

  /** Fixes references in an imported subtree. Returns false if the root itself must be dropped. */
  private fixTree(root: Element, srcPart: string, tgtPart: string): boolean {
    const stack: Element[] = [root];
    while (stack.length) {
      const el = stack.pop()!;
      if (el.namespaceURI === NS.w && STRIP.has(el.localName)) {
        if (el === root) return false;
        el.parentNode?.removeChild(el);
        continue;
      }
      this.fixAttributes(el, srcPart, tgtPart);
      if (el.namespaceURI === NS.w) {
        const n = el.localName;
        if (n === 'pStyle' || n === 'rStyle' || n === 'tblStyle') {
          const mapped = this.mapStyle(wAttr(el, 'val') ?? '');
          if (mapped) setWAttr(el, 'val', mapped);
          else el.parentNode?.removeChild(el);
          continue;
        }
        if (n === 'numId' && isW(el.parentNode as Element, 'numPr')) {
          const mapped = this.mapNum(wAttr(el, 'val') ?? '0');
          if (mapped) setWAttr(el, 'val', mapped);
          else el.parentNode?.parentNode?.removeChild(el.parentNode);
          continue;
        }
        if (n === 'footnoteReference' || n === 'endnoteReference') {
          const kind = n === 'footnoteReference' ? 'footnote' : 'endnote';
          const mapped = this.mapNote(kind, wAttr(el, 'id') ?? '');
          if (mapped) setWAttr(el, 'id', mapped);
          else el.parentNode?.removeChild(el);
          continue;
        }
        if (n === 'sectPr' && el !== root) {
          // Section breaks carry header/footer references into the source document.
          el.parentNode?.removeChild(el);
          continue;
        }
        if (n === 'id' && isW(el.parentNode as Element, 'sdtPr')) setWAttr(el, 'val', String(randomInt31() - 0x40000000));
        if (REVISIONS.has(n) && wAttr(el, 'id') !== null) setWAttr(el, 'id', String(900000 + ++revisionCounter));
      } else if (el.namespaceURI === NS.wp && el.localName === 'docPr') {
        el.setAttribute('id', String(this.tgt.nextDocPrId()));
      }
      for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
    }
    // Runs emptied by stripping (e.g. a comment reference) are dropped.
    for (const r of Array.from(root.getElementsByTagNameNS(NS.w, 'r'))) {
      if (elements(r).every((c) => isW(c, 'rPr'))) r.parentNode?.removeChild(r);
    }
    if (isW(root, 'r') && elements(root).every((c) => isW(c, 'rPr'))) return false;
    return true;
  }

  private fixAttributes(el: Element, srcPart: string, tgtPart: string): void {
    for (const a of Array.from(el.attributes)) {
      const ns = a.namespaceURI;
      if (ns === NS.r || (ns === NS.o && a.localName === 'relid')) {
        const mapped = this.mapRel(a.value, srcPart, tgtPart);
        if (mapped) el.setAttributeNS(ns, a.name, mapped);
        else el.removeAttributeNS(ns, a.localName);
      } else if (
        (ns === NS.w14 && (a.localName === 'paraId' || a.localName === 'textId')) ||
        (ns === NS.wp14 && (a.localName === 'anchorId' || a.localName === 'editId')) ||
        (ns === NS.w && a.localName.startsWith('rsid'))
      ) {
        el.removeAttributeNS(ns, a.localName);
      }
    }
  }

  /* ----------------------------------------------------- relationships */

  mapRel(rid: string, srcPart: string, tgtPart: string): string | null {
    const key = `${srcPart}\u0000${rid}\u0000${tgtPart}`;
    const hit = this.rids.get(key);
    if (hit !== undefined) return hit;
    const rel = this.src.rels(srcPart).get(rid);
    let result: string | null = null;
    if (rel) {
      if (rel.external) {
        result = this.tgt.addRel(tgtPart, rel.type, rel.target, true);
      } else {
        const path = this.copyPart(resolveTarget(srcPart, rel.target));
        if (path) result = this.tgt.addRel(tgtPart, rel.type, relativeTarget(tgtPart, path));
      }
    }
    this.rids.set(key, result);
    return result;
  }

  /** Copies a part (and the parts it relates to) into the target. Returns its new path. */
  copyPart(srcPath: string): string | undefined {
    const hit = this.parts.get(srcPath);
    if (hit) return hit;
    const bytes = this.src.bytes(srcPath);
    if (!bytes) return undefined;
    const srcRels = this.src.rels(srcPath);
    if (!srcRels.size) {
      // Identical media already in the target is reused.
      const hash = this.src.hashOf(srcPath);
      for (const path of this.tgt.files.keys()) {
        if (dirOf(path) === dirOf(srcPath) && extOf(path) === extOf(srcPath) && this.tgt.hashOf(path) === hash) {
          this.parts.set(srcPath, path);
          return path;
        }
      }
    }
    const tgtPath = this.tgt.uniquePath(srcPath);
    this.parts.set(srcPath, tgtPath);
    this.tgt.addBinaryPart(tgtPath, bytes, this.src.contentType(srcPath));
    if (srcRels.size) {
      // Keep relationship ids (the part's XML refers to them) but point at copied parts.
      const relsDoc = this.src.xml(relsPathFor(srcPath));
      if (relsDoc) {
        const copy = relsDoc.cloneNode(true) as XMLDocument;
        for (const el of Array.from(copy.getElementsByTagNameNS(NS.rels, 'Relationship'))) {
          if (el.getAttribute('TargetMode') === 'External') continue;
          const target = el.getAttribute('Target') ?? '';
          const copied = this.copyPart(resolveTarget(srcPath, target));
          if (copied) el.setAttribute('Target', relativeTarget(tgtPath, copied));
        }
        this.tgt.setXml(relsPathFor(tgtPath), copy);
      }
    }
    return tgtPath;
  }

  /* ------------------------------------------------------------ styles */

  mapStyle(id: string): string | null {
    const hit = this.styleIds.get(id);
    if (hit !== undefined) return hit;
    const def = this.src.styles.byId.get(id);
    if (!def) {
      this.styleIds.set(id, null);
      return null;
    }
    const same = this.tgt.styles.findByName(def.type, def.name);
    if (same) {
      this.styleIds.set(id, same.id);
      return same.id;
    }
    const stylesPath = this.tgt.stylesPath(true)!;
    const tdoc = this.tgt.xml(stylesPath)!;
    const sdocPath = this.src.stylesPath();
    if (sdocPath) this.mergeNamespaces(this.src.xml(sdocPath)!, tdoc, stylesPath);
    let newId = id;
    for (let i = 2; this.tgt.styles.byId.has(newId); i++) newId = `${id}${i}`;
    this.styleIds.set(id, newId);
    const el = tdoc.importNode(def.el, true) as Element;
    setWAttr(el, 'styleId', newId);
    el.removeAttributeNS(NS.w, 'default');
    for (const c of elements(el)) {
      if (!isW(c)) continue;
      if (c.localName === 'basedOn' || c.localName === 'next' || c.localName === 'link') {
        const mapped = this.mapStyle(wAttr(c, 'val') ?? '');
        if (mapped) setWAttr(c, 'val', mapped);
        else el.removeChild(c);
      } else if (c.localName === 'rsid') {
        el.removeChild(c);
      } else if (c.localName === 'pPr') {
        const numId = wChild(wChild(c, 'numPr'), 'numId');
        if (numId) {
          const mapped = this.mapNum(wAttr(numId, 'val') ?? '0');
          if (mapped) setWAttr(numId, 'val', mapped);
          else c.removeChild(numId.parentNode!);
        }
      }
    }
    tdoc.documentElement.appendChild(el);
    this.tgt.markDirty(stylesPath);
    this.tgt.styles.add(el);
    return newId;
  }

  /* --------------------------------------------------------- numbering */

  mapNum(numId: string): string | null {
    if (numId === '0') return '0';
    const hit = this.numIds.get(numId);
    if (hit !== undefined) return hit;
    const num = this.src.numbering.nums.get(numId);
    if (!num) {
      this.numIds.set(numId, null);
      return null;
    }
    const abs = this.src.numbering.abstracts.get(num.abstractId);
    const numPath = this.tgt.numberingPath(true)!;
    const ndoc = this.tgt.xml(numPath)!;
    const srcNumPath = this.src.numberingPath();
    if (srcNumPath) this.mergeNamespaces(this.src.xml(srcNumPath)!, ndoc, numPath);
    const root = ndoc.documentElement;
    const newNumId = String(this.tgt.numbering.maxNumId() + 1);
    this.numIds.set(numId, newNumId);
    const newAbsId = String(this.tgt.numbering.maxAbstractId() + 1);
    if (abs) {
      const absEl = ndoc.importNode(abs.el, true) as Element;
      setWAttr(absEl, 'abstractNumId', newAbsId);
      const nsid = wChild(absEl, 'nsid');
      if (nsid) setWAttr(nsid, 'val', randomHex8());
      for (const lvl of elements(absEl)) {
        if (!isW(lvl, 'lvl')) {
          if (isW(lvl, 'numStyleLink') || isW(lvl, 'styleLink')) {
            const mapped = this.mapStyle(wAttr(lvl, 'val') ?? '');
            if (mapped) setWAttr(lvl, 'val', mapped);
            else absEl.removeChild(lvl);
          }
          continue;
        }
        lvl.removeAttributeNS(NS.w, 'tplc');
        for (const c of elements(lvl)) {
          if (isW(c, 'pStyle')) {
            const mapped = this.mapStyle(wAttr(c, 'val') ?? '');
            if (mapped) setWAttr(c, 'val', mapped);
            else lvl.removeChild(c);
          } else if (isW(c, 'lvlPicBulletId')) {
            lvl.removeChild(c);
          }
        }
      }
      const firstNum = elements(root).find((e) => isW(e, 'num') || isW(e, 'numIdMacAtCleanup'));
      root.insertBefore(absEl, firstNum ?? null);
      this.tgt.numbering.addAbstract(absEl);
    }
    const numEl = ndoc.importNode(num.el, true) as Element;
    setWAttr(numEl, 'numId', newNumId);
    const ref = wChild(numEl, 'abstractNumId');
    if (ref && abs) setWAttr(ref, 'val', newAbsId);
    const cleanup = elements(root).find((e) => isW(e, 'numIdMacAtCleanup'));
    root.insertBefore(numEl, cleanup ?? null);
    this.tgt.numbering.addNum(numEl);
    this.tgt.markDirty(numPath);
    return newNumId;
  }

  /* --------------------------------------------------------- footnotes */

  mapNote(kind: 'footnote' | 'endnote', id: string): string | null {
    const key = `${kind}:${id}`;
    const hit = this.noteIds.get(key);
    if (hit !== undefined) return hit;
    const srcPath = this.src.notesPath(kind);
    const srcEl = srcPath ? this.src.noteTexts(kind).get(id) : undefined;
    if (!srcPath || !srcEl) {
      this.noteIds.set(key, null);
      return null;
    }
    const tgtPath = this.tgt.notesPath(kind, true)!;
    const tdoc = this.tgt.xml(tgtPath)!;
    let max = 0;
    for (const el of elements(tdoc.documentElement)) max = Math.max(max, parseInt(wAttr(el, 'id') ?? '0', 10) || 0);
    const newId = String(max + 1);
    this.noteIds.set(key, newId);
    const [copy] = this.importNodes([srcEl], srcPath, tgtPath);
    if (!copy) return null;
    setWAttr(copy as Element, 'id', newId);
    tdoc.documentElement.appendChild(copy);
    this.tgt.markDirty(tgtPath);
    return newId;
  }
}
