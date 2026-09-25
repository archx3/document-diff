/** Namespace-aware XML helpers for WordprocessingML. */

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;

export const STRICT_W = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  footnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  endnotes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
  hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  comments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
} as const;

export const CT = {
  main: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  endnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const;

export function parseXml(text: string): XMLDocument {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('The file contains malformed XML: ' + (err.textContent ?? '').slice(0, 200));
  return doc;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function serializeXml(doc: Document): string {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : XML_DECL + s;
}

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

export function bytesToText(bytes: Uint8Array): string {
  // Strip a UTF-8 byte order mark if present.
  const text = decoder.decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function textToBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

declare const matched: unique symbol;
/**
 * An element that passed an isW / isEl check. The brand keeps TypeScript from
 * narrowing an `Element` to `never` when the check fails.
 */
export type Matched = Element & { readonly [matched]: true };

export function isW(node: Node | null | undefined, local?: string): node is Matched {
  return !!node && node.nodeType === 1 && (node as Element).namespaceURI === NS.w && (!local || (node as Element).localName === local);
}

export function isEl(node: Node | null | undefined, ns: string, local?: string): node is Matched {
  return !!node && node.nodeType === 1 && (node as Element).namespaceURI === ns && (!local || (node as Element).localName === local);
}

export function elements(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

export function wChild(el: Element | null | undefined, local: string): Element | null {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) if (isW(c, local)) return c;
  return null;
}

export function wChildren(el: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (isW(c, local)) out.push(c);
  return out;
}

export function wAttr(el: Element | null | undefined, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(NS.w, local);
}

export function setWAttr(el: Element, local: string, value: string): void {
  el.setAttributeNS(NS.w, 'w:' + local, value);
}

/** Value of <w:x w:val="..."/> under `el`. */
export function wVal(el: Element | null | undefined, local: string): string | null {
  return wAttr(wChild(el, local), 'val');
}

/** OOXML on/off property: present without val, or val true/1/on. */
export function onOff(el: Element | null | undefined, local: string): boolean | undefined {
  const c = wChild(el, local);
  if (!c) return undefined;
  const v = wAttr(c, 'val');
  if (v === null) return true;
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

/** Descendants in document order with the given namespace and local name. */
export function descendants(el: Element | Document, ns: string, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(ns, local));
}

export function createW(doc: Document, local: string, attrs?: Record<string, string>): Element {
  const el = doc.createElementNS(NS.w, 'w:' + local);
  if (attrs) for (const [k, v] of Object.entries(attrs)) setWAttr(el, k, v);
  return el;
}

export function removeNode(n: Node): void {
  n.parentNode?.removeChild(n);
}

/** Removes <w:x/> children with the given local names. */
export function removeWChildren(el: Element, ...locals: string[]): void {
  for (const c of elements(el)) if (c.namespaceURI === NS.w && locals.includes(c.localName)) el.removeChild(c);
}

/** Visible text inside an element (w:t, tabs, breaks), ignoring deleted text and field codes. */
export function plainText(el: Element): string {
  let out = '';
  const walk = (n: Element) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (e.namespaceURI === NS.w) {
        switch (e.localName) {
          case 't':
            out += e.textContent ?? '';
            continue;
          case 'tab':
            out += '\t';
            continue;
          case 'br':
          case 'cr':
            out += '\n';
            continue;
          case 'p':
            if (out && !out.endsWith('\n')) out += '\n';
            walk(e);
            continue;
          case 'del':
          case 'moveFrom':
          case 'instrText':
          case 'delText':
          case 'rPr':
          case 'pPr':
            continue;
        }
      } else if (e.namespaceURI === NS.m && e.localName === 't') {
        out += e.textContent ?? '';
        continue;
      }
      walk(e);
    }
  };
  walk(el);
  return out;
}

export { hashBytes } from '../../core/model';
