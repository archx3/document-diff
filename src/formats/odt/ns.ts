/** OpenDocument namespaces and small DOM helpers. */

export const ODF = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  math: 'http://www.w3.org/1998/Math/MathML',
  dc: 'http://purl.org/dc/elements/1.1/',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
  xml: 'http://www.w3.org/XML/1998/namespace',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const;

export const ODT_MIME = 'application/vnd.oasis.opendocument.text';

const PREFIX: Record<string, string> = Object.fromEntries(Object.entries(ODF).map(([k, v]) => [v, k]));

declare const matched: unique symbol;
/** Element that passed an is() check (the brand avoids narrowing Element to never). */
export type OEl = Element & { readonly [matched]: true };

export function is(node: Node | null | undefined, ns: string, local?: string): node is OEl {
  return !!node && node.nodeType === 1 && (node as Element).namespaceURI === ns && (!local || (node as Element).localName === local);
}

export function kids(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
}

export function child(el: Element | null | undefined, ns: string, local: string): Element | null {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) if (is(c, ns, local)) return c;
  return null;
}

export function attr(el: Element | null | undefined, ns: string, local: string): string | null {
  return el ? el.getAttributeNS(ns, local) : null;
}

export function setAttr(el: Element, ns: string, local: string, value: string): void {
  el.setAttributeNS(ns, `${PREFIX[ns] ?? 'x'}:${local}`, value);
}

export function create(doc: Document, ns: string, local: string, attrs?: Array<[string, string, string]>): Element {
  const el = doc.createElementNS(ns, `${PREFIX[ns] ?? 'x'}:${local}`);
  if (attrs) for (const [ans, name, value] of attrs) setAttr(el, ans, name, value);
  return el;
}

/** Decodes ODF style names ("Heading_20_1" → "Heading 1"). */
export function decodeStyleName(name: string): string {
  return name.replace(/_([0-9a-fA-F]{2})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Encodes a display name as an ODF style name ("Heading 1" → "Heading_20_1"). */
export function encodeStyleName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, (c) => `_${c.charCodeAt(0).toString(16).padStart(2, '0')}_`);
}

/** Length in CSS pixels ("2.5in", "6.35cm", "12pt" …). */
export function lengthPx(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)\s*(in|cm|mm|pt|pc|px)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const unit = m[2] ?? 'px';
  const f = unit === 'in' ? 96 : unit === 'cm' ? 96 / 2.54 : unit === 'mm' ? 96 / 25.4 : unit === 'pt' ? 96 / 72 : unit === 'pc' ? 16 : 1;
  return Math.round(n * f);
}

/** Visible text of an element (text nodes, spaces, tabs, line breaks), skipping notes' citations. */
export function odfText(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        out += (c.nodeValue ?? '').replace(/[\t\r\n]+/g, ' ');
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (e.namespaceURI === ODF.text) {
        if (e.localName === 's') {
          out += ' '.repeat(parseInt(e.getAttributeNS(ODF.text, 'c') ?? '1', 10) || 1);
          continue;
        }
        if (e.localName === 'tab') {
          out += '\t';
          continue;
        }
        if (e.localName === 'line-break') {
          out += '\n';
          continue;
        }
        if (e.localName === 'note-citation' || e.localName === 'tracked-changes') continue;
        if ((e.localName === 'p' || e.localName === 'h') && out && !out.endsWith('\n')) out += '\n';
      }
      walk(e);
    }
  };
  walk(el);
  return out.replace(/ {2,}/g, ' ');
}
