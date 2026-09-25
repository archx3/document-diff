import type { ListInfo } from '../../core/model';
import { NS, elements, wAttr, wChild, wChildren, wVal } from './xml';

export interface LevelDef {
  start: number;
  format: string;
  text: string;
}

interface AbstractDef {
  id: string;
  el: Element;
  levels: Map<number, LevelDef>;
  numStyleLink?: string;
}

interface NumDef {
  id: string;
  abstractId: string;
  el: Element;
  overrides: Map<number, { start?: number; level?: LevelDef }>;
}

function readLevel(lvl: Element): LevelDef {
  return {
    start: parseInt(wVal(lvl, 'start') ?? '1', 10) || 0,
    format: wVal(lvl, 'numFmt') ?? 'decimal',
    text: wVal(lvl, 'lvlText') ?? '',
  };
}

/** Index over numbering.xml. */
export class NumberingIndex {
  readonly abstracts = new Map<string, AbstractDef>();
  readonly nums = new Map<string, NumDef>();

  constructor(public doc: XMLDocument | null) {
    if (!doc) return;
    for (const el of elements(doc.documentElement)) {
      if (el.namespaceURI !== NS.w) continue;
      if (el.localName === 'abstractNum') this.addAbstract(el);
      else if (el.localName === 'num') this.addNum(el);
    }
  }

  addAbstract(el: Element): void {
    const id = wAttr(el, 'abstractNumId');
    if (id === null) return;
    const levels = new Map<number, LevelDef>();
    for (const lvl of wChildren(el, 'lvl')) levels.set(parseInt(wAttr(lvl, 'ilvl') ?? '0', 10) || 0, readLevel(lvl));
    this.abstracts.set(id, { id, el, levels, numStyleLink: wVal(el, 'numStyleLink') ?? undefined });
  }

  addNum(el: Element): void {
    const id = wAttr(el, 'numId');
    const abstractId = wVal(el, 'abstractNumId');
    if (id === null || abstractId === null) return;
    const overrides = new Map<number, { start?: number; level?: LevelDef }>();
    for (const o of wChildren(el, 'lvlOverride')) {
      const ilvl = parseInt(wAttr(o, 'ilvl') ?? '0', 10) || 0;
      const so = wVal(o, 'startOverride');
      const lvl = wChild(o, 'lvl');
      overrides.set(ilvl, { start: so !== null ? parseInt(so, 10) || 0 : undefined, level: lvl ? readLevel(lvl) : undefined });
    }
    this.nums.set(id, { id, abstractId, el, overrides });
  }

  maxAbstractId(): number {
    let m = -1;
    for (const k of this.abstracts.keys()) m = Math.max(m, parseInt(k, 10) || 0);
    return m;
  }

  maxNumId(): number {
    let m = 0;
    for (const k of this.nums.keys()) m = Math.max(m, parseInt(k, 10) || 0);
    return m;
  }

  private abstractFor(num: NumDef, resolveLink: (styleId: string) => string | undefined): AbstractDef | undefined {
    let abs = this.abstracts.get(num.abstractId);
    // A numStyleLink points at a numbering style whose numId holds the real definition.
    for (let hops = 0; abs?.numStyleLink && hops < 4; hops++) {
      const linkedNum = resolveLink(abs.numStyleLink);
      const n = linkedNum ? this.nums.get(linkedNum) : undefined;
      if (!n) break;
      abs = this.abstracts.get(n.abstractId);
    }
    return abs;
  }

  /** List description for a paragraph with the given numbering, or undefined for "no list". */
  list(numId: string, ilvl: number, resolveLink: (styleId: string) => string | undefined = () => undefined): ListInfo | undefined {
    if (numId === '0') return undefined;
    const num = this.nums.get(numId);
    if (!num) return undefined;
    const abs = this.abstractFor(num, resolveLink);
    const levelAt = (l: number): LevelDef => {
      const o = num.overrides.get(l);
      return o?.level ?? abs?.levels.get(l) ?? { start: 1, format: l % 3 === 0 ? 'decimal' : l % 3 === 1 ? 'lowerLetter' : 'lowerRoman', text: `%${l + 1}.` };
    };
    const lvl = levelAt(ilvl);
    const formats: string[] = [];
    const starts: number[] = [];
    for (let l = 0; l <= ilvl; l++) {
      const d = levelAt(l);
      formats.push(d.format);
      starts.push(num.overrides.get(l)?.start ?? d.start);
    }
    const hasStartOverride = [...num.overrides.values()].some((o) => o.start !== undefined);
    return {
      ordered: lvl.format !== 'bullet' && lvl.format !== 'none',
      level: ilvl,
      key: `a${abs?.id ?? num.abstractId}`,
      overrideKey: hasStartOverride ? `n${numId}` : undefined,
      formats,
      starts,
      template: lvl.text,
    };
  }
}
