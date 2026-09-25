import type { Fmt, Role } from '../../core/model';
import { NS, elements, onOff, wAttr, wChild, wVal } from './xml';

export interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  el: Element;
  isDefault: boolean;
}

export interface ParaStyleInfo {
  role: Role;
  level?: number;
  numId?: string;
  ilvl?: number;
  name: string;
}

/** Index over styles.xml with inheritance resolution. */
export class StyleIndex {
  readonly byId = new Map<string, StyleDef>();
  private byName = new Map<string, StyleDef>();
  defaultPara?: StyleDef;
  private paraCache = new Map<string, ParaStyleInfo>();
  private charCache = new Map<string, Fmt>();

  constructor(public doc: XMLDocument | null) {
    if (doc) for (const el of elements(doc.documentElement)) if (el.namespaceURI === NS.w && el.localName === 'style') this.add(el);
  }

  add(el: Element): StyleDef | undefined {
    const id = wAttr(el, 'styleId');
    if (!id) return undefined;
    const def: StyleDef = {
      id,
      type: wAttr(el, 'type') ?? 'paragraph',
      name: wVal(el, 'name') ?? id,
      basedOn: wVal(el, 'basedOn') ?? undefined,
      el,
      isDefault: ['1', 'true', 'on'].includes(wAttr(el, 'default') ?? ''),
    };
    this.byId.set(id, def);
    const nameKey = `${def.type}:${def.name.toLowerCase()}`;
    if (!this.byName.has(nameKey)) this.byName.set(nameKey, def);
    if (def.type === 'paragraph' && def.isDefault) this.defaultPara = def;
    this.paraCache.clear();
    this.charCache.clear();
    return def;
  }

  findByName(type: string, name: string): StyleDef | undefined {
    return this.byName.get(`${type}:${name.toLowerCase()}`);
  }

  /** Style chain from the given style up through basedOn (guarding against cycles). */
  chain(id: string | null | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = id ? this.byId.get(id) : undefined;
    while (cur && !seen.has(cur.id) && out.length < 32) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.basedOn ? this.byId.get(cur.basedOn) : undefined;
    }
    return out;
  }

  /** Semantic role, heading level and inherited numbering of a paragraph style. */
  para(id: string | null | undefined): ParaStyleInfo {
    const key = id ?? '';
    const hit = this.paraCache.get(key);
    if (hit) return hit;
    const chain = this.chain(id ?? this.defaultPara?.id);
    const info: ParaStyleInfo = { role: 'p', name: chain[0]?.name ?? 'Normal' };
    let roleSet = false;
    for (const st of chain) {
      const pPr = wChild(st.el, 'pPr');
      if (info.numId === undefined) {
        const numPr = wChild(pPr, 'numPr');
        const numId = wVal(numPr, 'numId');
        if (numId !== null) {
          info.numId = numId;
          const ilvl = wVal(numPr, 'ilvl');
          info.ilvl = ilvl ? parseInt(ilvl, 10) || 0 : 0;
        }
      }
      if (roleSet) continue;
      const r = roleFromName(st.name);
      if (r) {
        info.role = r.role;
        info.level = r.level;
        roleSet = true;
        continue;
      }
      const outline = wVal(pPr, 'outlineLvl');
      if (outline !== null) {
        const n = parseInt(outline, 10);
        if (n >= 0 && n < 9) {
          info.role = 'h';
          info.level = n + 1;
        }
        roleSet = true;
      }
    }
    this.paraCache.set(key, info);
    return info;
  }

  /** Character formatting contributed by a character style chain. */
  charFmt(id: string | null | undefined): Fmt {
    if (!id) return {};
    const hit = this.charCache.get(id);
    if (hit) return hit;
    const fmt: Fmt = {};
    // Walk from the base style down so nearer styles win.
    for (const st of this.chain(id).reverse()) Object.assign(fmt, runFmt(wChild(st.el, 'rPr'), true));
    this.charCache.set(id, fmt);
    return fmt;
  }
}

export function roleFromName(name: string): { role: Role; level?: number } | undefined {
  const n = name.trim().toLowerCase();
  let m = /^heading\s*(\d)$/.exec(n);
  if (m) return { role: 'h', level: Math.min(9, parseInt(m[1]!, 10)) };
  m = /^toc\s*(\d)$/.exec(n);
  if (m) return { role: 'toc', level: parseInt(m[1]!, 10) };
  if (n === 'title') return { role: 'title' };
  if (n === 'subtitle') return { role: 'subtitle' };
  if (n === 'quote' || n === 'intense quote' || n === 'block text') return { role: 'quote' };
  if (n === 'caption') return { role: 'caption' };
  if (n === 'html preformatted' || n === 'plain text' || n === 'code' || n === 'source code') return { role: 'code' };
  return undefined;
}

const MONO = /courier|consolas|mono|menlo|lucida console|source code/i;

/**
 * Formatting set directly in a w:rPr. With `explicitOnly`, properties that are
 * absent stay undefined (so they can be layered over a style).
 */
export function runFmt(rPr: Element | null, explicitOnly = false): Fmt {
  const f: Fmt = {};
  if (!rPr) return f;
  const set = <K extends keyof Fmt>(k: K, v: Fmt[K] | undefined) => {
    if (v !== undefined) f[k] = v;
    else if (!explicitOnly) delete f[k];
  };
  set('b', onOff(rPr, 'b'));
  set('i', onOff(rPr, 'i'));
  const u = wChild(rPr, 'u');
  if (u) set('u', (wAttr(u, 'val') ?? 'single') !== 'none');
  const strike = onOff(rPr, 'strike');
  const dstrike = onOff(rPr, 'dstrike');
  if (strike !== undefined || dstrike !== undefined) set('s', !!(strike || dstrike));
  const va = wVal(rPr, 'vertAlign');
  if (va === 'superscript') set('sup', true);
  else if (va === 'subscript') set('sub', true);
  else if (va === 'baseline') {
    set('sup', false);
    set('sub', false);
  }
  const fonts = wChild(rPr, 'rFonts');
  if (fonts && MONO.test(wAttr(fonts, 'ascii') ?? wAttr(fonts, 'hAnsi') ?? '')) set('code', true);
  const hl = wVal(rPr, 'highlight');
  if (hl && hl !== 'none') set('hl', hl);
  return f;
}
