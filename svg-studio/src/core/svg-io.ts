import { fmt } from './path';
import { type Matrix, IDENTITY, isIdentity, meanScale, multiply, parseTransform, translate } from './matrix';
import { transformGeom } from './shapes';
import { type Doc, type Geometry, type Node, type Style, type StyleKey, SPEC_STYLE, uid } from './types';
import type { Pt } from './geometry';

export class SvgParseError extends Error {}

const STYLE_ATTRS: Array<[StyleKey, string]> = [
  ['fill', 'fill'],
  ['fillRule', 'fill-rule'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeMiterlimit', 'stroke-miterlimit'],
  ['opacity', 'opacity'],
];
export const STYLE_KEYS = STYLE_ATTRS.map(([k]) => k);

const NUMERIC: ReadonlySet<StyleKey> = new Set(['strokeWidth', 'strokeMiterlimit', 'opacity']);

function parseLength(v: string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  if (!t || t.endsWith('%')) return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function readStyle(el: Element): Style {
  const out: Record<string, string | number> = {};
  const decl = new Map<string, string>();
  for (const [, attr] of STYLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v != null) decl.set(attr, v.trim());
  }
  // Declarations in a style attribute win over presentation attributes.
  const inline = el.getAttribute('style');
  if (inline) {
    for (const part of inline.split(';')) {
      const at = part.indexOf(':');
      if (at > 0) decl.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
    }
  }
  for (const [key, attr] of STYLE_ATTRS) {
    const v = decl.get(attr);
    if (v === undefined || v === '' || v === 'inherit') continue;
    if (NUMERIC.has(key)) {
      const n = parseLength(v);
      if (n !== undefined) out[key] = n;
    } else if (key === 'fillRule') {
      if (v === 'evenodd' || v === 'nonzero') out[key] = v;
    } else if (key === 'strokeLinecap') {
      if (v === 'butt' || v === 'round' || v === 'square') out[key] = v;
    } else if (key === 'strokeLinejoin') {
      if (v === 'miter' || v === 'round' || v === 'bevel') out[key] = v;
    } else out[key] = v;
  }
  return out as Style;
}

function numbers(text: string | null): number[] {
  return (text?.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
}

function readPoints(text: string | null): Pt[] {
  const n = numbers(text);
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i]!, y: n[i + 1]! });
  return pts;
}

function readGeometry(el: Element): Geometry | null {
  const f = (name: string, def = 0) => parseLength(el.getAttribute(name)) ?? def;
  switch (el.localName) {
    case 'path': {
      const d = el.getAttribute('d');
      return d && d.trim() ? { kind: 'path', d } : null;
    }
    case 'line':
      return { kind: 'line', x1: f('x1'), y1: f('y1'), x2: f('x2'), y2: f('y2') };
    case 'rect': {
      const w = f('width');
      const h = f('height');
      if (w <= 0 || h <= 0) return null;
      const rxA = parseLength(el.getAttribute('rx'));
      const ryA = parseLength(el.getAttribute('ry'));
      const rx = rxA ?? ryA ?? 0;
      const ry = ryA ?? rxA ?? 0;
      return { kind: 'rect', x: f('x'), y: f('y'), width: w, height: h, rx: Math.min(Math.max(rx, 0), w / 2), ry: Math.min(Math.max(ry, 0), h / 2) };
    }
    case 'circle': {
      const r = f('r');
      return r > 0 ? { kind: 'circle', cx: f('cx'), cy: f('cy'), r } : null;
    }
    case 'ellipse': {
      const rx = f('rx');
      const ry = f('ry');
      return rx > 0 && ry > 0 ? { kind: 'ellipse', cx: f('cx'), cy: f('cy'), rx, ry } : null;
    }
    case 'polyline':
    case 'polygon': {
      const points = readPoints(el.getAttribute('points'));
      return points.length > 1 ? { kind: el.localName, points } : null;
    }
    default:
      return null;
  }
}

const IGNORED = new Set(['title', 'desc', 'metadata', 'namedview', 'sodipodi:namedview']);

function hasStroke(style: Style): boolean {
  return style.stroke !== undefined && style.stroke !== 'none' && style.stroke !== 'transparent';
}

/** Reads SVG markup into a document. Transforms are baked into the shapes. Throws SvgParseError when there is nothing to read. */
export function parseSvg(input: string): { doc: Doc; warnings: string[] } {
  let text = input.trim();
  if (!text) throw new SvgParseError('Nothing to import: the text is empty.');
  // Bare path data, or bare elements without the <svg> around them.
  if (!text.includes('<') && /^[Mm]/.test(text)) text = `<path d="${text.replace(/"/g, '')}"/>`;
  if (!/<svg[\s>]/i.test(text)) text = `<svg xmlns="http://www.w3.org/2000/svg">${text}</svg>`;

  const parser = new DOMParser();
  let svg: Element | null = null;
  const xml = parser.parseFromString(text, 'image/svg+xml');
  if (!xml.getElementsByTagName('parsererror').length && xml.documentElement?.localName === 'svg') svg = xml.documentElement;
  else svg = parser.parseFromString(text, 'text/html').querySelector('svg');
  if (!svg) throw new SvgParseError('That does not look like an SVG: no <svg> element was found.');

  const warnings: string[] = [];
  const skipped = new Map<string, number>();

  // Size: the viewBox wins; its origin is moved to (0, 0).
  let width = parseLength(svg.getAttribute('width')) ?? 24;
  let height = parseLength(svg.getAttribute('height')) ?? 24;
  let origin: Matrix = IDENTITY;
  const vb = numbers(svg.getAttribute('viewBox'));
  if (vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) {
    width = vb[2]!;
    height = vb[3]!;
    origin = translate(-vb[0]!, -vb[1]!);
  }

  const defaults: Style = { ...SPEC_STYLE, ...readStyle(svg) };

  const read = (el: Element, m: Matrix, inherited: Style): Node | null => {
    const tag = el.localName;
    const own = readStyle(el);
    const t = parseTransform(el.getAttribute('transform'));
    if (!t) warnings.push(`Ignored an invalid transform on <${tag}>.`);
    const matrix = multiply(m, t ?? IDENTITY);
    const hidden = el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden' || /display\s*:\s*none/.test(el.getAttribute('style') ?? '') || undefined;
    if (tag === 'g' || tag === 'a') {
      const style = own;
      const below = { ...inherited, ...style };
      const children = [...el.children].map((c) => read(c, matrix, below)).filter((n): n is Node => !!n);
      if (!children.length) return null;
      return { type: 'group', id: uid(), style, children, hidden };
    }
    const geom = readGeometry(el);
    if (!geom) {
      if (!IGNORED.has(tag) && !IGNORED.has(el.nodeName)) skipped.set(tag, (skipped.get(tag) ?? 0) + 1);
      return null;
    }
    const style = own;
    if (isIdentity(matrix)) return { type: 'shape', id: uid(), geom, style, hidden };
    // A stretched stroke can't be baked; keep its weight in proportion on average.
    const k = meanScale(matrix);
    const eff = { ...inherited, ...style };
    if (hasStroke(eff) && Math.abs(k - 1) > 1e-6) style.strokeWidth = (eff.strokeWidth ?? 1) * k;
    return { type: 'shape', id: uid(), geom: transformGeom(geom, matrix), style, hidden };
  };

  const children = [...svg.children].map((c) => read(c, origin, defaults)).filter((n): n is Node => !!n);

  if (skipped.size) {
    const list = [...skipped].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ');
    warnings.push(`Left out what this editor can't draw: ${list}.`);
  }
  if (/url\(#/.test(text)) warnings.push('Gradients, patterns and other references are not supported; those fills may look different.');
  if (!children.length) warnings.push('The SVG has no shapes to edit.');
  return { doc: { width, height, defaults, children }, warnings };
}

/* ------------------------------------------------------------------------------------------ */

export interface SerializeOptions {
  /** Hidden layers are written with display="none" (for the code view); otherwise they are left out (for export). */
  includeHidden?: boolean;
  /** React: camelCase attribute names and props spread onto the root. */
  jsx?: boolean;
  /** Write the root's size as `width`/`height` (default true). */
  size?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

function styleAttrs(style: Style): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, attr] of STYLE_ATTRS) {
    const v = style[key];
    if (v !== undefined) out.push([attr, typeof v === 'number' ? fmt(v) : String(v)]);
  }
  return out;
}

function geometryAttrs(g: Geometry): { tag: string; attrs: Array<[string, string]> } {
  const n = (v: number) => fmt(v);
  switch (g.kind) {
    case 'path':
      return { tag: 'path', attrs: [['d', g.d]] };
    case 'line':
      return { tag: 'line', attrs: [['x1', n(g.x1)], ['y1', n(g.y1)], ['x2', n(g.x2)], ['y2', n(g.y2)]] };
    case 'rect': {
      const a: Array<[string, string]> = [['x', n(g.x)], ['y', n(g.y)], ['width', n(g.width)], ['height', n(g.height)]];
      if (g.rx > 0 || g.ry > 0) {
        a.push(['rx', n(g.rx)]);
        if (Math.abs(g.ry - g.rx) > 1e-6) a.push(['ry', n(g.ry)]);
      }
      return { tag: 'rect', attrs: a };
    }
    case 'circle':
      return { tag: 'circle', attrs: [['cx', n(g.cx)], ['cy', n(g.cy)], ['r', n(g.r)]] };
    case 'ellipse':
      return { tag: 'ellipse', attrs: [['cx', n(g.cx)], ['cy', n(g.cy)], ['rx', n(g.rx)], ['ry', n(g.ry)]] };
    default:
      return { tag: g.kind, attrs: [['points', g.points.map((p) => `${n(p.x)} ${n(p.y)}`).join(' ')]] };
  }
}

function writeNodes(nodes: readonly Node[], depth: number, o: SerializeOptions, lines: string[]): void {
  const pad = '  '.repeat(depth);
  const name = (a: string) => (o.jsx ? camel(a) : a);
  for (const node of nodes) {
    if (node.hidden && !o.includeHidden) continue;
    const extra: Array<[string, string]> = node.hidden ? [['display', 'none']] : [];
    const style = styleAttrs(node.style).map(([k, v]): [string, string] => [name(k), v]);
    if (node.type === 'group') {
      const attrs = [...style, ...extra].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      const inner: string[] = [];
      writeNodes(node.children, depth + 1, o, inner);
      if (!inner.length) continue;
      lines.push(`${pad}<g${attrs}>`, ...inner, `${pad}</g>`);
    } else {
      const { tag, attrs } = geometryAttrs(node.geom);
      const all = [...attrs, ...style, ...extra].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      lines.push(`${pad}<${tag}${all} />`);
    }
  }
}

function rootAttrs(doc: Doc, o: SerializeOptions): Array<[string, string]> {
  const attrs: Array<[string, string]> = [['xmlns', 'http://www.w3.org/2000/svg']];
  if (o.size !== false) attrs.push(['width', fmt(doc.width)], ['height', fmt(doc.height)]);
  attrs.push(['viewBox', `0 0 ${fmt(doc.width)} ${fmt(doc.height)}`]);
  for (const [key, attr] of STYLE_ATTRS) {
    const v = doc.defaults[key];
    if (v === undefined || v === SPEC_STYLE[key as keyof typeof SPEC_STYLE]) continue;
    attrs.push([attr, typeof v === 'number' ? fmt(v) : String(v)]);
  }
  return attrs;
}

/** The document as SVG markup in the layout Lucide's own icon files use. */
export function serializeSvg(doc: Doc, o: SerializeOptions = {}): string {
  const lines: string[] = [];
  writeNodes(doc.children, 1, o, lines);
  const attrs = rootAttrs(doc, o).map(([k, v]) => `  ${o.jsx && k !== 'xmlns' ? camel(k) : k}="${esc(v)}"`);
  if (o.jsx) attrs.push('  {...props}');
  return [`<svg`, ...attrs, `>`, ...lines, `</svg>`].join('\n');
}

/** A React component for the icon. */
export function serializeJsx(doc: Doc, componentName = 'Icon'): string {
  const body = serializeSvg(doc, { jsx: true, includeHidden: false })
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
  return `export function ${componentName}(props) {\n  return (\n${body}\n  );\n}\n`;
}

/** Shapes with the style they end up with, as flat `[tag, attributes]` pairs (the format Lucide's icon nodes use). */
export function flattenForIconNode(doc: Doc): Array<[string, Record<string, string>]> {
  const out: Array<[string, Record<string, string>]> = [];
  const go = (nodes: readonly Node[], inherited: Style) => {
    for (const n of nodes) {
      if (n.hidden) continue;
      const here = { ...inherited, ...n.style };
      if (n.type === 'group') {
        go(n.children, here);
        continue;
      }
      const { tag, attrs } = geometryAttrs(n.geom);
      const style: Record<string, string> = {};
      // Only what differs from the icon's root style is written.
      for (const [key, attr] of STYLE_ATTRS) {
        const v = here[key];
        if (v !== undefined && v !== doc.defaults[key]) style[attr] = typeof v === 'number' ? fmt(v) : String(v);
      }
      out.push([tag, { ...Object.fromEntries(attrs), ...style }]);
    }
  };
  go(doc.children, {});
  return out;
}

export function serializeIconNode(doc: Doc): string {
  const rows = flattenForIconNode(doc).map(([tag, attrs]) => {
    const body = Object.entries(attrs)
      .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(', ');
    return `  [${JSON.stringify(tag)}, { ${body} }],`;
  });
  return `[\n${rows.join('\n')}\n]`;
}

/** Re-expresses the nodes' styles so they look the same under another document's defaults. */
export function rebaseStyle(nodes: readonly Node[], from: Style, to: Style): Node[] {
  const diff: Record<string, unknown> = {};
  for (const [key] of STYLE_ATTRS) {
    const a = from[key] ?? SPEC_STYLE[key as keyof typeof SPEC_STYLE];
    const b = to[key] ?? SPEC_STYLE[key as keyof typeof SPEC_STYLE];
    if (a !== b) diff[key] = a;
  }
  if (!Object.keys(diff).length) return [...nodes];
  return nodes.map((n) => ({ ...n, style: { ...diff, ...n.style } }));
}
