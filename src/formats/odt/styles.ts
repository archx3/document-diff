import type { Fmt, ParaProps, Role } from '../../core/model';
import { roleFromName } from '../../core/model';
import { ODF, attr, child, decodeStyleName, is, kids } from './ns';

export interface OStyle {
  name: string;
  family: string;
  /** Name as the author sees it ("Heading 1"). */
  display: string;
  parent?: string;
  listStyle?: string;
  el: Element;
  auto: boolean;
  fmt: Fmt;
  align?: ParaProps['align'];
  outline?: number;
}

const MONO = /courier|consolas|mono|menlo|lucida console|source code/i;

/** Formatting set explicitly in a style:text-properties element. */
export function textProps(el: Element | null): Fmt {
  const f: Fmt = {};
  if (!el) return f;
  const weight = attr(el, ODF.fo, 'font-weight');
  if (weight) {
    const n = parseInt(weight, 10);
    f.b = weight === 'bold' || weight === 'bolder' || n >= 600;
  }
  const style = attr(el, ODF.fo, 'font-style');
  if (style) f.i = style === 'italic' || style === 'oblique';
  const ul = attr(el, ODF.style, 'text-underline-style');
  if (ul) f.u = ul !== 'none';
  const lt = attr(el, ODF.style, 'text-line-through-style');
  if (lt) f.s = lt !== 'none';
  const pos = attr(el, ODF.style, 'text-position');
  if (pos) {
    const first = pos.trim().split(/\s+/)[0]!;
    if (first === 'super' || (first.endsWith('%') && parseFloat(first) > 0)) {
      f.sup = true;
      f.sub = false;
    } else if (first === 'sub' || (first.endsWith('%') && parseFloat(first) < 0)) {
      f.sub = true;
      f.sup = false;
    } else {
      f.sup = false;
      f.sub = false;
    }
  }
  const font = attr(el, ODF.style, 'font-name') ?? attr(el, ODF.fo, 'font-family');
  if (font && MONO.test(font)) f.code = true;
  const bg = attr(el, ODF.fo, 'background-color');
  if (bg && bg !== 'transparent') f.hl = 'yellow';
  return f;
}

function alignOf(el: Element | null): ParaProps['align'] {
  const a = attr(el, ODF.fo, 'text-align');
  if (a === 'center') return 'center';
  if (a === 'end' || a === 'right') return 'right';
  if (a === 'justify') return 'justify';
  return undefined;
}

/**
 * Index over a document's styles: named styles (styles.xml) and automatic
 * styles (content.xml, and styles.xml for headers and footers).
 */
export class OdtStyles {
  private map = new Map<string, OStyle>();
  private listStyles = new Map<string, { el: Element; auto: boolean }>();

  constructor(named: Element | null, autos: Array<Element | null>) {
    for (const root of autos) if (root) for (const el of kids(root)) this.add(el, true);
    if (named) for (const el of kids(named)) this.add(el, false);
  }

  add(el: Element, auto: boolean): void {
    if (is(el, ODF.text, 'list-style')) {
      const name = attr(el, ODF.style, 'name');
      if (name && !this.listStyles.has(name)) this.listStyles.set(name, { el, auto });
      return;
    }
    if (!is(el, ODF.style, 'style')) return;
    const name = attr(el, ODF.style, 'name');
    const family = attr(el, ODF.style, 'family');
    if (!name || !family) return;
    const key = `${auto ? 'a' : 'n'}:${family}:${name}`;
    if (this.map.has(key)) return;
    const outline = attr(el, ODF.style, 'default-outline-level');
    this.map.set(key, {
      name,
      family,
      display: attr(el, ODF.style, 'display-name') ?? decodeStyleName(name),
      parent: attr(el, ODF.style, 'parent-style-name') ?? undefined,
      listStyle: attr(el, ODF.style, 'list-style-name') || undefined,
      el,
      auto,
      fmt: textProps(child(el, ODF.style, 'text-properties')),
      align: alignOf(child(el, ODF.style, 'paragraph-properties')),
      outline: outline ? parseInt(outline, 10) || undefined : undefined,
    });
  }

  /** Automatic style first, then named style (automatic styles shadow named ones). */
  get(family: string, name: string | null | undefined): OStyle | undefined {
    if (!name) return undefined;
    return this.map.get(`a:${family}:${name}`) ?? this.map.get(`n:${family}:${name}`);
  }

  named(family: string, name: string): OStyle | undefined {
    return this.map.get(`n:${family}:${name}`);
  }

  namedByDisplay(family: string, display: string): OStyle | undefined {
    const d = display.toLowerCase();
    for (const s of this.map.values()) if (!s.auto && s.family === family && s.display.toLowerCase() === d) return s;
    return undefined;
  }

  hasName(family: string, name: string, auto: boolean): boolean {
    return this.map.has(`${auto ? 'a' : 'n'}:${family}:${name}`);
  }

  chain(family: string, name: string | null | undefined): OStyle[] {
    const out: OStyle[] = [];
    const seen = new Set<string>();
    let cur = this.get(family, name);
    while (cur && !seen.has(`${cur.auto}:${cur.name}`) && out.length < 32) {
      seen.add(`${cur.auto}:${cur.name}`);
      out.push(cur);
      // A parent is always a named style.
      cur = cur.parent ? this.named(family, cur.parent) : undefined;
    }
    return out;
  }

  listStyle(name: string | null | undefined): { el: Element; auto: boolean } | undefined {
    return name ? this.listStyles.get(name) : undefined;
  }

  hasListStyle(name: string): boolean {
    return this.listStyles.has(name);
  }

  /** Role, heading level and list style of a paragraph style. */
  para(name: string | null | undefined): { role: Role; level?: number; display: string; listStyle?: string } {
    const chain = this.chain('paragraph', name);
    const out: { role: Role; level?: number; display: string; listStyle?: string } = { role: 'p', display: chain[0]?.display ?? 'Default Paragraph Style' };
    let roleSet = false;
    for (const st of chain) {
      if (!out.listStyle && st.listStyle) out.listStyle = st.listStyle;
      if (roleSet || st.auto) continue;
      const r = roleFromName(st.display);
      if (r) {
        out.role = r.role;
        out.level = r.level;
        out.display = st.display;
        roleSet = true;
      } else if (st.outline) {
        out.role = 'h';
        out.level = st.outline;
        roleSet = true;
      }
    }
    return out;
  }

  /** Direct formatting of a paragraph: only what its automatic style sets. */
  paraDirect(name: string | null | undefined): { fmt: Fmt; align?: ParaProps['align'] } {
    const st = this.get('paragraph', name);
    if (!st || !st.auto) return { fmt: {} };
    return { fmt: st.fmt, align: st.align };
  }

  /** Formatting a text style applies (automatic and character styles, nearest wins). */
  spanFmt(name: string | null | undefined): Fmt {
    const fmt: Fmt = {};
    for (const st of this.chain('text', name).reverse()) Object.assign(fmt, st.fmt);
    return fmt;
  }
}
