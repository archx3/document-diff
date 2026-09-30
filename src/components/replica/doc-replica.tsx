'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bandPath } from '../../ui/elastic';
import type { IconName } from '../icons';
import { Icon } from '../icons';
import { Frame } from './frame';
import { Region, useRegions } from './region';
import styles from './replica.module.css';

/** Text, or words only in A (d) or only in B (i). */
type Seg = string | { d: string } | { i: string };
type Style = 'h1' | 'h2' | 'p' | 'li';
type Side = 'a' | 'b';

interface Para {
  id: string;
  style: Style;
  a: Seg[] | null;
  b: Seg[] | null;
}

type Kind = 'same' | 'mod' | 'ins' | 'del';
type Changed = Exclude<Kind, 'same'>;
type Decision = 'accept' | 'reject';
type Menu = 'copy' | 'export-a' | 'export-b';

/** A change, as the workspace counts them: a run of changed paragraphs, with nothing unchanged between. */
interface Hunk {
  ids: string[];
  /** Only in A, only in B, or changed (anything else). */
  kind: Changed;
}

const START: Para[] = [
  { id: 'title', style: 'h1', a: ['Website Services Agreement'], b: ['Website Services Agreement'] },
  { id: 'date', style: 'p', a: ['This agreement is made on ', { d: '12' }, ' May 2026 between Northwind Studio and Harbor & Pine LLC.'], b: ['This agreement is made on ', { i: '19' }, ' May 2026 between Northwind Studio and Harbor & Pine LLC.'] },
  { id: 'scope', style: 'h2', a: ['1. Scope of work'], b: ['1. Scope of work'] },
  { id: 'pages', style: 'p', a: ['A marketing website with up to ', { d: 'six' }, ' pages, a blog and a contact form.'], b: ['A marketing website with up to ', { i: 'eight' }, ' pages, a blog', { i: ', a newsletter sign-up' }, ' and a contact form.'] },
  { id: 'includes', style: 'p', a: ['Deliverables include:'], b: ['Deliverables include:'] },
  { id: 'design', style: 'li', a: ['Visual design for desktop and mobile'], b: ['Visual design for desktop', { i: ', tablet' }, ' and mobile'] },
  { id: 'cms', style: 'li', a: ['A content management system for the blog'], b: ['A content management system for the blog'] },
  { id: 'a11y', style: 'li', a: null, b: ['Accessibility review against WCAG 2.2 AA'] },
  { id: 'hosting', style: 'li', a: ['Hosting set-up on the Client’s account'], b: ['Hosting set-up on the Client’s account'] },
  { id: 'support', style: 'li', a: ['Launch support for 30 days'], b: null },
  { id: 'training', style: 'li', a: ['Training for ', { d: 'two' }, ' staff members'], b: ['Training for ', { i: 'three' }, ' staff members'] },
  { id: 'fees', style: 'h2', a: ['2. Fees and payment'], b: ['2. Fees and payment'] },
  { id: 'due', style: 'p', a: ['Invoices are due within ', { d: '30' }, ' days of receipt.'], b: ['Invoices are due within ', { i: '15' }, ' days of receipt.'] },
];

const FIRST = new Map(START.map((p) => [p.id, p]));
const FILE: Record<Side, string> = { a: 'agreement-draft-1.docx', b: 'agreement-draft-2.docx' };
const KIND_LABEL: Record<Changed, string> = { mod: 'Changed', del: 'Only in A', ins: 'Only in B' };
/** What A's » (to B) and B's « (to A) do, as the workspace names them. */
const ARROW_LABEL: Record<Changed, Record<Side, string>> = {
  mod: { b: 'Use A’s version in B', a: 'Use B’s version in A' },
  del: { b: 'Copy to B', a: 'Remove from A' },
  ins: { b: 'Remove from B', a: 'Copy to A' },
};
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

function kindOf(p: Para): Kind {
  if (!p.a) return 'ins';
  if (!p.b) return 'del';
  return [...p.a, ...p.b].some((s) => typeof s !== 'string') ? 'mod' : 'same';
}

/** The changes: each run of changed paragraphs. */
function hunksOf(paras: Para[]): Hunk[] {
  const out: Hunk[] = [];
  let run: Para[] = [];
  const flush = () => {
    if (!run.length) return;
    const kinds = new Set(run.map(kindOf));
    out.push({ ids: run.map((p) => p.id), kind: kinds.size === 1 && !kinds.has('mod') ? (kindOf(run[0]!) as Changed) : 'mod' });
    run = [];
  };
  for (const p of paras) {
    if (kindOf(p) === 'same') flush();
    else run.push(p);
  }
  flush();
  return out;
}

/** One side's text as it reads, without the marks. */
function plain(segs: Seg[] | null, side: Side): string {
  return (segs ?? []).map((s) => (typeof s === 'string' ? s : side === 'a' ? ('d' in s ? s.d : '') : 'i' in s ? s.i : '')).join('');
}

/** One side's own words and marks: A's text keeps the words only in A, B's the words only in B. */
function own(segs: Seg[], side: Side): Seg[] {
  return segs.filter((s) => typeof s === 'string' || (side === 'a' ? 'd' in s : 'i' in s));
}

function count(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** How many words are marked on one side: only in A (d) or only in B (i). */
function words(segs: Seg[] | null, key: 'd' | 'i'): number {
  return (segs ?? []).reduce((n, s) => n + (typeof s === 'string' ? 0 : 'd' in s ? (key === 'd' ? count(s.d) : 0) : key === 'i' ? count(s.i) : 0), 0);
}

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

function Text({ segs, style, onWord, wordRegion }: { segs: Seg[]; style: Style; onWord?: () => void; wordRegion?: boolean }) {
  let marked = false;
  const body = segs.map((s, i) => {
    if (typeof s === 'string') return <Fragment key={i}>{s}</Fragment>;
    const first = !marked;
    marked = true;
    const el = 'd' in s ? <del onClick={onWord}>{s.d}</del> : <ins onClick={onWord}>{s.i}</ins>;
    return wordRegion && first ? (
      <Region key={i} as="span" name="word">
        {el}
      </Region>
    ) : (
      <Fragment key={i}>{el}</Fragment>
    );
  });
  if (style === 'h1') return <span className={styles.h1}>{body}</span>;
  if (style === 'h2') return <span className={styles.h2}>{body}</span>;
  if (style === 'li')
    return (
      <span className={styles.li}>
        <span aria-hidden="true">•</span>
        <span>{body}</span>
      </span>
    );
  return <>{body}</>;
}

/** An icon button of the app bar or toolbar: no border until hovered, highlighted while pressed. */
function Tool({
  icon,
  label,
  tip,
  kbd,
  pressed,
  menu,
  expanded,
  disabled,
  className,
  onClick,
}: {
  icon: IconName;
  label: string;
  tip?: string;
  kbd?: string;
  pressed?: boolean;
  /** Opens a menu: a small chevron after the icon. */
  menu?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?(): void;
}) {
  return (
    <button
      type="button"
      className={[styles.tool, className].filter(Boolean).join(' ')}
      data-menu={menu || undefined}
      aria-label={label}
      title={kbd ? `${tip ?? label} (${kbd})` : (tip ?? label)}
      aria-pressed={pressed}
      aria-haspopup={menu || undefined}
      aria-expanded={menu ? !!expanded : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      {menu && <Icon name="chevron" size={10} />}
    </button>
  );
}

/** How many paragraphs changed, behind an icon, as in the workspace. */
function Stats({ counts, total }: { counts: Record<Changed, number>; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={styles.anchor} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button type="button" className={styles.tool} aria-label="Summary of the changes" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="info" size={14} />
      </button>
      {open && (
        <span className={styles.statsCard} role="tooltip">
          {total ? (
            <>
              <span className={styles.statsHead}>Paragraphs</span>
              <span className={styles.stat} data-k="mod">
                <b>{counts.mod}</b> changed
              </span>
              <span className={styles.stat} data-k="del">
                <b>{counts.del}</b> only in A
              </span>
              <span className={styles.stat} data-k="ins">
                <b>{counts.ins}</b> only in B
              </span>
            </>
          ) : (
            <span className={styles.stat} data-k="ok">
              A and B match
            </span>
          )}
        </span>
      )}
    </span>
  );
}

const EXPORTS: Array<[string, string]> = [
  ['Word document (.docx)', 'Keeps the original styles and layout'],
  ['Copy formatted text', 'Paste into Google Docs or Word'],
  ['PDF', 'For reading, printing and sharing'],
  ['OpenDocument, RTF, web page, Markdown', ''],
];

/**
 * The gutter between the documents, in pixels: each side's line numbers and
 * arrow, room for the bands to curve, and in the middle the ruler, with a
 * minimap each side of it (the workspace's, a little smaller).
 */
function gutter(compact: boolean, lines: boolean, map: boolean) {
  const num = lines ? (compact ? 14 : 18) : 0;
  const act = compact ? 20 : 24;
  const curve = compact ? 6 : 10;
  const mapW = map ? (compact ? 10 : 16) : 0;
  const mapGap = map ? 2 : 0;
  const rail = compact ? 8 : 10;
  // The level part of a band, beside the arrow.
  const side = num + act + 4;
  return { num, act, mapW, mapGap, rail, side, width: 2 * (side + curve + mapW + mapGap) + rail };
}

/** Where each paragraph is on each side, from the top of the documents. */
type Boxes = Record<string, Partial<Record<Side, readonly [number, number]>>>;

interface Geometry {
  boxes: Boxes;
  width: number;
  height: number;
}

function offsetIn(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  for (let e: HTMLElement | null = el; e && e !== root; e = e.offsetParent as HTMLElement | null) y += e.offsetTop;
  return y;
}

/**
 * Measures the paragraphs (the elements with data-pid and data-side) after
 * every render, and again when the text rewraps, for the bands, the ruler and
 * the arrows beside the paragraphs.
 */
function useGeometry(root: RefObject<HTMLDivElement | null>, layout: string): Geometry | null {
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const boxes: Boxes = {};
    for (const p of el.querySelectorAll<HTMLElement>('[data-pid]')) {
      const top = offsetIn(p, el);
      (boxes[p.dataset.pid!] ??= {})[p.dataset.side as Side] = [top, top + p.offsetHeight];
    }
    const next = { boxes, width: el.offsetWidth, height: el.offsetHeight };
    setGeo((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => redraw((n) => n + 1));
    ro.observe(el);
    for (const col of el.querySelectorAll('[data-col]')) ro.observe(col);
    return () => ro.disconnect();
  }, [root, layout]);
  return geo;
}

/** A side's extent over some paragraphs: from the top of the first to the bottom of the last. */
function extent(boxes: Boxes, ids: string[], side: Side): readonly [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of ids) {
    const b = boxes[id]?.[side];
    if (!b) continue;
    lo = Math.min(lo, b[0]);
    hi = Math.max(hi, b[1]);
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The document workspace in miniature, comparing two drafts of an agreement,
 * as the workspace shows them: connection bands joining the changes across
 * the gutter, the ruler in the middle. It works: the arrows and marked words
 * copy changes, the toolbar steps through them, folds the rest away, switches
 * to one column or to rows, and the list of changes records decisions.
 */
export function DocReplica() {
  const { focus } = useRegions();
  const [paras, setParas] = useState(START);
  const [past, setPast] = useState<Para[][]>([]);
  const [future, setFuture] = useState<Para[][]>([]);
  const [cur, setCur] = useState(0);
  const [changesOnly, setChangesOnly] = useState(false);
  const [unified, setUnified] = useState(false);
  const [bands, setBands] = useState(true);
  const [lines, setLines] = useState(false);
  const [minimap, setMinimap] = useState(false);
  const [panelOpen, setPanel] = useState(false);
  const [review, setReview] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [copied, setCopied] = useState<ReadonlySet<string>>(new Set());
  const docs = useRef<HTMLDivElement>(null);

  const visible = paras.filter((p) => p.a || p.b);
  const byId = new Map(visible.map((p) => [p.id, p]));
  const hunks = hunksOf(visible);
  const hunkOf = new Map(hunks.flatMap((h, i) => h.ids.map((id) => [id, i] as const)));
  const at = Math.min(cur, Math.max(0, hunks.length - 1));
  const current = hunks[at];
  const inCurrent = (p: Para) => hunkOf.get(p.id) === at;
  // The current change's first paragraph in B: its first marked word, and in review mode its note.
  const markedB = current?.ids.find((id) => byId.get(id)?.b?.some((s) => typeof s !== 'string'));
  const noteAt = current?.ids.find((id) => byId.get(id)?.b);
  // A step about a part opens it.
  const panel = panelOpen || focus === 'list' || focus === 'decide';
  const open: Menu | null = menu ?? (focus === 'copy-all' ? 'copy' : focus === 'export' ? 'export-b' : null);
  const notes = review || focus === 'review';
  const counts = { mod: 0, del: 0, ins: 0 };
  for (const p of visible) {
    const k = kindOf(p);
    if (k !== 'same') counts[k]++;
  }
  const layout = unified ? 'unified' : bands ? 'bands' : 'rows';
  const geo = useGeometry(docs, layout);
  const g = gutter((geo?.width ?? 900) < 520, lines, minimap && !unified);
  const vars = { '--gut': `${g.width}px`, '--num': `${g.num}px`, '--act': `${g.act}px` } as CSSProperties;

  // Each side's paragraphs numbered, as the line numbers show them.
  const numbers: Record<Side, Map<string, number>> = { a: new Map(), b: new Map() };
  for (const side of ['a', 'b'] as const) for (const p of visible) if (p[side]) numbers[side].set(p.id, numbers[side].size + 1);

  function commit(next: Para[]) {
    setPast((p) => [...p, paras]);
    setFuture([]);
    setParas(next);
  }

  /** Makes one side of these paragraphs read like the other. */
  function copy(ids: readonly string[], to: Side) {
    const from = other(to);
    commit(
      paras.map((p) => {
        if (!ids.includes(p.id)) return p;
        const text = p[from] ? [plain(p[from], from)] : null;
        return { ...p, a: text, b: text };
      }),
    );
    setCopied(new Set(ids));
  }

  /** Makes one document read like the other everywhere. */
  function copyAll(to: Side) {
    copy(
      hunks.flatMap((h) => h.ids),
      to,
    );
    setMenu(null);
  }

  function undo() {
    const prev = past.at(-1);
    if (!prev) return;
    setFuture((f) => [paras, ...f]);
    setPast((p) => p.slice(0, -1));
    setParas(prev);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, paras]);
    setFuture((f) => f.slice(1));
    setParas(next);
  }

  function reset() {
    setParas(START);
    setPast([]);
    setFuture([]);
    setDecisions({});
    setCur(0);
  }

  // A change's decision is kept by its first paragraph. Choosing the same decision again takes it back.
  const decide = (id: string, d: Decision) =>
    setDecisions((all) => {
      const { [id]: was, ...rest } = all;
      return was === d ? rest : { ...rest, [id]: d };
    });

  const toggleMenu = (m: Menu) => setMenu(open === m ? null : m);
  const pick = (p: Para) => {
    const i = hunkOf.get(p.id);
    if (i !== undefined) setCur(i);
  };
  const settled = () => setCopied(new Set());

  /** Paragraphs that differ from the document as it was loaded: the edits applied to that side. */
  const edits = (side: Side) => paras.filter((p) => plain(p[side], side) !== plain(FIRST.get(p.id)![side], side)).length;

  const note = (
    <>
      <span className={styles.mchip} title="1 note">
        <Icon name="note" size={13} />
      </span>
      <Region name="review" as="aside" className={styles.note}>
        <b>Needs work · You</b>
        Check this against the budget before we sign.
      </Region>
    </>
  );

  const foldLabel = (n: number) => `${n} unchanged ${n === 1 ? 'paragraph' : 'paragraphs'}`;

  /** A's » and B's «: each document's version of the change (or paragraph), sent to the other. */
  const arrow = (ids: readonly string[], to: Side, kind: Changed, style?: CSSProperties) => (
    <button
      type="button"
      className={styles.act}
      data-to={to}
      style={style}
      title={ARROW_LABEL[kind][to]}
      aria-label={ARROW_LABEL[kind][to]}
      onClick={(e) => {
        e.stopPropagation();
        copy(ids, to);
      }}
    >
      <Icon name={to === 'b' ? 'chevronsRight' : 'chevronsLeft'} size={12} />
    </button>
  );

  /** A paragraph's text on one side, with the current change's note beside B's. */
  const paragraph = (p: Para, side: Side, segs: Seg[]) => (
    <>
      <Text segs={segs} style={p.style} onWord={() => copy([p.id], side)} wordRegion={side === 'b' && p.id === markedB} />
      {side === 'b' && notes && p.id === noteAt && note}
    </>
  );

  /** With connection bands: one document's column, running on unbroken. */
  const column = (side: Side) => {
    const out: ReactNode[] = [];
    let folded = 0;
    const flush = (key: string) => {
      if (folded) out.push(<div key={`fold-${key}`} className={styles.foldSide}>{foldLabel(folded)}</div>);
      folded = 0;
    };
    for (const p of visible) {
      const k = kindOf(p);
      if (changesOnly && k === 'same') {
        folded++;
        continue;
      }
      flush(p.id);
      const segs = p[side];
      // Where the other document has a paragraph this one doesn't: a line across the sheet.
      if (!segs) out.push(<div key={p.id} className={styles.gap} data-pid={p.id} data-side={side} data-k={k} />);
      else
        out.push(
          <div
            key={p.id}
            className={styles.para}
            data-pid={p.id}
            data-side={side}
            data-k={k}
            data-current={inCurrent(p) || undefined}
            data-copied={copied.has(p.id) || undefined}
            onClick={() => pick(p)}
            onAnimationEnd={settled}
          >
            {paragraph(p, side, segs)}
          </div>,
        );
    }
    flush('end');
    return out;
  };

  /** The middle of the gutter: the bands (with connection bands on), the ruler and the minimaps. */
  const overview = (withBands: boolean) => {
    if (!geo) return null;
    const G = g.width;
    const ranges = hunks.flatMap((h, i) => {
      const a = extent(geo.boxes, h.ids, 'a');
      const b = extent(geo.boxes, h.ids, 'b');
      return a && b ? [{ h, i, a, b }] : [];
    });
    const ARROW = 20;
    // Beside the change's first line, or across the line where it would be.
    const armAt = (r: readonly [number, number]) => (r[0] === r[1] ? r[0] - ARROW / 2 : r[0] + 3);
    return (
      <>
        {withBands && (
          <svg className={styles.bands} width={G} height={geo.height} aria-hidden="true">
            {ranges.map(({ h, i, a, b }) => {
              const path = bandPath(g.side, G - g.side, G, a[0], a[1], b[0], b[1]);
              const on = i === at || undefined;
              return (
                <Fragment key={h.ids[0]}>
                  <path className={styles.band} data-k={h.kind} data-current={on} d={path.fill} onClick={() => setCur(i)} />
                  <path className={styles.bandEdge} data-k={h.kind} data-current={on} d={path.edges} />
                </Fragment>
              );
            })}
          </svg>
        )}
        <span className={styles.ruler} style={{ left: (G - g.rail) / 2, width: g.rail }} aria-hidden="true">
          {ranges.map(({ h, i, a, b }) => {
            const top = (a[0] + b[0]) / 2;
            return <span key={h.ids[0]} className={styles.rmark} data-k={h.kind} data-current={i === at || undefined} style={{ top, height: Math.max(4, (a[1] + b[1]) / 2 - top) }} onClick={() => setCur(i)} />;
          })}
          {/* The part of the documents on screen: all of it, here. */}
          <span className={styles.rview} />
        </span>
        {g.mapW > 0 &&
          (['a', 'b'] as const).map((side) => (
            <span key={side} className={styles.mini} style={{ left: side === 'a' ? (G - g.rail) / 2 - g.mapGap - g.mapW : (G + g.rail) / 2 + g.mapGap, width: g.mapW }} aria-hidden="true">
              {visible.map((p) => {
                const box = geo.boxes[p.id]?.[side];
                if (!box || !p[side] || box[1] - box[0] < 8) return null;
                return <i key={p.id} data-k={kindOf(p) === 'same' ? undefined : side} style={{ top: box[0] + 3, height: box[1] - box[0] - 6 }} />;
              })}
            </span>
          ))}
        {withBands &&
          ranges.map(({ h, i, a, b }) => {
            const ya = armAt(a);
            const yb = armAt(b);
            const top = Math.min(ya, yb);
            const body = (
              <>
                {arrow(h.ids, 'b', h.kind, { left: g.num, top: ya - top })}
                {arrow(h.ids, 'a', h.kind, { right: g.num, top: yb - top })}
              </>
            );
            const style = { top, height: Math.max(ya, yb) + ARROW - top };
            return i === at ? (
              <Region key={h.ids[0]} name="copy" as="span" className={styles.zone} data-current style={style}>
                {body}
              </Region>
            ) : (
              <span key={h.ids[0]} className={styles.zone} style={style}>
                {body}
              </span>
            );
          })}
        {withBands &&
          lines &&
          (['a', 'b'] as const).flatMap((side) =>
            visible.map((p) => {
              const box = geo.boxes[p.id]?.[side];
              if (!box || !p[side]) return null;
              return (
                <span key={side + p.id} className={styles.lnum} data-current={inCurrent(p) || undefined} style={{ position: 'absolute', top: box[0] + 3, [side === 'a' ? 'left' : 'right']: 0, width: g.num }}>
                  {numbers[side].get(p.id)}
                </span>
              );
            }),
          )}
      </>
    );
  };

  /** Side by side with connection bands: each document runs on, and bands join its changes to the other's. */
  const elastic = (
    <div className={styles.egrid} ref={docs} style={vars} data-review={notes || undefined}>
      <div className={styles.ecol} data-col="a">
        {column('a')}
        <div className={styles.endcap} />
      </div>
      <div className={styles.egut}>{overview(true)}</div>
      <div className={styles.ecol} data-col="b">
        {column('b')}
        <div className={styles.endcap} />
      </div>
    </div>
  );

  /** Side by side without the bands: the paragraphs lined up in rows, each changed one with its arrows. */
  const aligned = () => {
    const out: ReactNode[] = [];
    let folded = 0;
    const flush = (key: string) => {
      if (folded)
        out.push(
          <div key={`fold-${key}`} className={styles.foldRow}>
            <span className={styles.foldSide}>{foldLabel(folded)}</span>
            <span className={styles.foldSide}>{foldLabel(folded)}</span>
          </div>,
        );
      folded = 0;
    };
    for (const p of visible) {
      const k = kindOf(p);
      if (changesOnly && k === 'same') {
        folded++;
        continue;
      }
      flush(p.id);
      const gut = (
        <>
          <span className={styles.lnum}>{lines && numbers.a.get(p.id)}</span>
          {k === 'same' ? <span /> : arrow([p.id], 'b', k)}
          <span />
          {k === 'same' ? <span /> : arrow([p.id], 'a', k)}
          <span className={styles.lnum}>{lines && numbers.b.get(p.id)}</span>
        </>
      );
      const cell = (side: Side) => {
        const segs = p[side];
        return (
          <div className={styles.cell} data-side={side} data-pid={p.id}>
            {segs ? (
              paragraph(p, side, segs)
            ) : (
              <span className={styles.missing}>
                <span>Not in {side.toUpperCase()}</span>
              </span>
            )}
          </div>
        );
      };
      out.push(
        <div key={p.id} className={styles.row} data-k={k} data-current={inCurrent(p) || undefined} data-copied={copied.has(p.id) || undefined} onClick={() => pick(p)} onAnimationEnd={settled}>
          {cell('a')}
          {current?.ids[0] === p.id ? (
            <Region name="copy" className={styles.gut}>
              {gut}
            </Region>
          ) : (
            <div className={styles.gut}>{gut}</div>
          )}
          {cell('b')}
        </div>,
      );
    }
    flush('end');
    return (
      <div className={styles.agrid} ref={docs} style={vars} data-review={notes || undefined}>
        {out}
        <div className={styles.endcaps}>
          <span className={styles.endcap} />
          <span className={styles.endcap} />
        </div>
        <div className={styles.overlay}>{overview(false)}</div>
      </div>
    );
  };

  /** One column: unchanged paragraphs once, and where the documents differ, A's version above B's. */
  const single = () => {
    const out: ReactNode[] = [];
    let folded = 0;
    const flush = (key: string) => {
      if (folded)
        out.push(
          <div key={`fold-${key}`} className={styles.ufold}>
            <span className={styles.foldSide}>{foldLabel(folded)}</span>
          </div>,
        );
      folded = 0;
    };
    for (const p of visible) {
      const k = kindOf(p);
      if (changesOnly && k === 'same') {
        folded++;
        continue;
      }
      flush(p.id);
      if (k === 'same') {
        out.push(
          <div key={p.id} className={styles.urow}>
            <span className={styles.ugut}>
              <span className={styles.lnum}>{lines && numbers.a.get(p.id)}</span>
              <span className={styles.lnum}>{lines && numbers.b.get(p.id)}</span>
            </span>
            <div className={styles.ucell}>
              <Text segs={p.a!} style={p.style} />
            </div>
          </div>,
        );
        continue;
      }
      const version = (side: Side) => {
        const segs = p[side];
        return (
          <div className={styles.urow} data-side={side} data-k={k} data-current={inCurrent(p) || undefined} onClick={() => pick(p)}>
            <span className={styles.ugut}>
              <span className={styles.lnum}>{lines && side === 'a' && numbers.a.get(p.id)}</span>
              <span className={styles.lnum}>{lines && side === 'b' && numbers.b.get(p.id)}</span>
              {arrow([p.id], other(side), k)}
            </span>
            <div className={styles.ucell} data-side={side}>
              {segs ? (
                paragraph(p, side, own(segs, side))
              ) : (
                <span className={styles.missing}>
                  <span>Not in {side.toUpperCase()}</span>
                </span>
              )}
            </div>
          </div>
        );
      };
      const block = (
        <>
          {version('a')}
          {version('b')}
        </>
      );
      out.push(
        current?.ids[0] === p.id ? (
          <Region key={p.id} name="copy" className={styles.ublock} data-copied={copied.has(p.id) || undefined} onAnimationEnd={settled}>
            {block}
          </Region>
        ) : (
          <div key={p.id} className={styles.ublock} data-copied={copied.has(p.id) || undefined} onAnimationEnd={settled}>
            {block}
          </div>
        ),
      );
    }
    flush('end');
    return (
      <div className={styles.ugrid} ref={docs} style={vars} data-review={notes || undefined}>
        <div className={styles.utop} />
        {out}
        <div className={styles.endcap} />
      </div>
    );
  };

  const slot = (side: Side) => {
    const n = edits(side);
    const menuOpen = open === `export-${side}`;
    const exportButton = (
      <>
        <button type="button" className={styles.sm} data-primary={n > 0 || undefined} aria-haspopup="true" aria-expanded={menuOpen} title={`Download or copy ${side.toUpperCase()}`} onClick={() => toggleMenu(`export-${side}`)}>
          <Icon name="download" size={12} />
          <span>Export</span>
        </button>
        {menuOpen && (
          <div className={styles.menu} role="menu">
            <p className={styles.menuTitle}>
              {side.toUpperCase()}: {FILE[side]}
            </p>
            {EXPORTS.map(([label, hint], i) => (
              <p key={label} className={styles.mi} data-on={i === 0 || undefined}>
                {label}
                {hint && <small>{hint}</small>}
              </p>
            ))}
          </div>
        )}
      </>
    );
    return (
      <div className={styles.slot}>
        <span className={styles.siglum}>{side.toUpperCase()}</span>
        <span className={styles.slotMain}>
          <span className={styles.slotName}>{FILE[side]}</span>
          <span className={styles.slotMeta}>
            <span className={styles.fmt}>Word</span>
            <span>{plural(visible.reduce((w, p) => w + count(plain(p[side], side)), 0), 'word')}</span>
            <span>{visible.filter((p) => p[side]).length} ¶</span>
            {n > 0 && <span className={styles.edited}>{plural(n, 'edit')} applied</span>}
          </span>
        </span>
        <span className={styles.slotActions}>
          <button type="button" className={styles.sm} title={`Load a different document as ${side.toUpperCase()}`}>
            <Icon name="open" size={12} />
            <span>Replace</span>
          </button>
          {side === 'b' ? (
            <Region name="export" as="span" className={styles.anchor}>
              {exportButton}
            </Region>
          ) : (
            <span className={styles.anchor}>{exportButton}</span>
          )}
        </span>
      </div>
    );
  };

  /** One side of a change on its card: its paragraphs' text in that document, with the marks. */
  const cardLine = (h: Hunk, side: Side) => {
    const parts = h.ids.flatMap((id) => {
      const segs = byId.get(id)?.[side];
      return segs ? [own(segs, side)] : [];
    });
    if (!parts.length) return null;
    return (
      <span className={styles.cardLine}>
        {parts.map((segs, i) => (
          <Fragment key={i}>
            {i > 0 && ' · '}
            <Text segs={segs} style="p" />
          </Fragment>
        ))}
      </span>
    );
  };

  const decided = hunks.filter((h) => decisions[h.ids[0]!]).length;

  return (
    <Frame address="collate / compare" label="An interactive replica of the document workspace">
      <Region name="appbar" as="header" className={styles.appbar}>
        <span className={styles.brand}>
          <span className={styles.brandWord}>
            <i>C</i>ollate
          </span>
          <span className={styles.brandTag}>Compare two versions of a document, picture or recording</span>
        </span>
        <span className={styles.appActions}>
          <Tool icon="swap" label="Swap A and B" />
          <Tool icon="newDoc" label="New comparison" tip="New comparison: start again with two documents (resets the replica)" onClick={reset} />
          <Tool icon="contrast" label="Low contrast" tip="Low contrast: no borders, one background" pressed={false} />
          <Tool icon="moon" label="Dark theme" tip="Switch to the dark theme" />
          <Tool icon="help" label="Help and keyboard shortcuts" kbd="?" />
        </span>
      </Region>

      <div className={styles.tbar} data-match={!hunks.length || undefined}>
        <span className={styles.tcol} data-col="left">
          <Region name="nav" as="span" className={styles.tgroup}>
            <Tool icon="up" label="Previous change" kbd="P" disabled={at <= 0} onClick={() => setCur(at - 1)} />
            <Tool icon="down" label="Next change" kbd="N" disabled={at >= hunks.length - 1} onClick={() => setCur(at + 1)} />
          </Region>
          <Region name="fold" as="span" className={styles.tgroup}>
            <Tool icon="changesOnly" label="Changes only" tip="Changes only: fold unchanged paragraphs" kbd="C" pressed={changesOnly && !!hunks.length} disabled={!hunks.length} onClick={() => setChangesOnly(!changesOnly)} />
          </Region>
          <Stats counts={counts} total={hunks.length} />
        </span>
        <span className={styles.tcol} data-col="middle">
          <Region name="view" as="span" className={styles.vseg} role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={!unified} aria-label="Side by side" title="Side by side (V)" onClick={() => setUnified(false)}>
              <Icon name="sideBySide" size={14} />
            </button>
            <button type="button" role="radio" aria-checked={unified} aria-label="Unified" title="Unified: one column, A above B where they differ (V)" onClick={() => setUnified(true)}>
              <Icon name="unified" size={14} />
            </button>
          </Region>
          <Tool icon="minimap" label="Minimap" tip="Minimap of each document beside the ruler" kbd="M" pressed={minimap && !unified} disabled={unified} className={styles.opt} onClick={() => setMinimap(!minimap)} />
          <Tool icon="lineNumbers" label="Line numbers" tip="Line numbers in the gutter" kbd="L" pressed={lines} className={styles.opt} onClick={() => setLines(!lines)} />
          <Tool
            icon="connector"
            label="Connection bands"
            tip={unified ? 'Connection bands: in the side by side view' : 'Connection bands: each document runs on unbroken, with bands joining its changes to the other’s'}
            kbd="B"
            pressed={bands && !unified}
            disabled={unified}
            onClick={() => setBands(!bands)}
          />
          <Tool icon="sliders" label="Compare options" tip="Compare options: what counts as a difference" menu className={styles.opt} />
          <Region name="review-btn" as="span" className={styles.tgroup}>
            <Tool icon="review" label="Review mode" tip="Review mode: add notes, highlights and reactions from the margins" kbd="R" pressed={notes} onClick={() => setReview(!review)} />
          </Region>
          <span className={`${styles.tgroup} ${styles.opt}`}>
            <Tool icon="spell" label="Spelling and grammar" tip="Spelling and grammar: underline mistakes in both documents" kbd="G" pressed={false} />
            <button type="button" className={`${styles.tool} ${styles.chev}`} aria-label="Spelling and grammar options" title="Language, Claude and your dictionary" aria-haspopup="true" aria-expanded={false}>
              <Icon name="chevron" size={10} />
            </button>
          </span>
          <hr className={`${styles.tsep} ${styles.pages}`} aria-orientation="vertical" />
          <span className={`${styles.tgroup} ${styles.pages}`}>
            {/* The replica fits on one screen, as a short document does in the workspace. */}
            <button type="button" className={styles.textTool} disabled title="Scroll up a screen (Page Up)">
              Previous page
            </button>
            <button type="button" className={styles.textTool} disabled title="Scroll down a screen (Page Down)">
              Next page
            </button>
          </span>
        </span>
        <span className={styles.tcol} data-col="right">
          <span className={styles.tgroup} role="group" aria-label="Edit">
            <Region name="undo" as="span" className={styles.tgroup}>
              <Tool icon="undo" label="Undo" kbd="Ctrl+Z" disabled={!past.length} onClick={undo} />
              <Tool icon="redo" label="Redo" kbd="Ctrl+Shift+Z" disabled={!future.length} onClick={redo} />
            </Region>
            <Region name="copy-all" as="span" className={`${styles.tgroup} ${styles.anchor}`}>
              <Tool icon="merge" label="Copy changes" tip="Copy this change or every change across" menu expanded={open === 'copy'} disabled={!hunks.length} onClick={() => toggleMenu('copy')} />
              {open === 'copy' && current && (
                <div className={styles.menu} role="menu" aria-label="Copy changes">
                  <p className={styles.menuTitle}>Change {at + 1}</p>
                  <button type="button" className={styles.mi} role="menuitem" onClick={() => (copy(current.ids, 'b'), setMenu(null))}>
                    <Icon name="toB" size={13} />
                    <span>Use A’s version in B</span>
                    <kbd>Alt+→</kbd>
                  </button>
                  <button type="button" className={styles.mi} role="menuitem" onClick={() => (copy(current.ids, 'a'), setMenu(null))}>
                    <Icon name="toA" size={13} />
                    <span>Use B’s version in A</span>
                    <kbd>Alt+←</kbd>
                  </button>
                  <p className={styles.menuTitle}>All {plural(hunks.length, 'change')}</p>
                  <button type="button" className={styles.mi} role="menuitem" onClick={() => copyAll('b')}>
                    <Icon name="toB" size={13} />
                    <span>Make B match A</span>
                  </button>
                  <button type="button" className={styles.mi} role="menuitem" onClick={() => copyAll('a')}>
                    <Icon name="toA" size={13} />
                    <span>Make A match B</span>
                  </button>
                </div>
              )}
            </Region>
            <Region name="redline" as="span" className={styles.tgroup}>
              <Tool icon="download" label="Download redline" tip="Redline: a Word file with every change as a tracked change" menu disabled={!hunks.length} />
              <Tool icon="doc" label="Change report" tip="Report: every change with its decision, reactions and notes, as PDF or Word" menu />
              <Tool icon="link" label="Share the review" tip="Share: save the comparison and its review as a file to send, or open one" menu />
            </Region>
          </span>
          <Region name="list" as="span" className={styles.tgroup}>
            <Tool icon="sidebar" label="List of changes" kbd="S" pressed={panel} onClick={() => setPanel(!panelOpen)} />
          </Region>
        </span>
      </div>

      <div className={styles.body} data-panel={panel || undefined}>
        <div className={styles.stage}>
          <Region name="heads" className={styles.colheads} style={vars} data-unified={unified || undefined} data-review={notes || undefined}>
            {slot('a')}
            <span className={styles.pill} data-none={!hunks.length || undefined} title={hunks.length ? `Change ${at + 1} of ${hunks.length}` : 'No differences'}>
              {hunks.length ? (
                <>
                  <b>{at + 1}</b>
                  <span className={styles.pillSep}>/</span>
                  {hunks.length}
                </>
              ) : (
                <Icon name="check" size={11} />
              )}
            </span>
            {slot('b')}
          </Region>
          {unified ? single() : bands ? elastic : aligned()}
        </div>

        {panel && (
          <Region name="list" as="aside" className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.tab} aria-current={!notes || undefined}>
                Changes {hunks.length > 0 && <span className={styles.countPill}>{hunks.length}</span>}
              </span>
              {notes && (
                <span className={styles.tab}>
                  Notes <span className={styles.countPill}>1</span>
                </span>
              )}
              <button type="button" className={styles.tool} aria-label="Close the list of changes" title="Close" onClick={() => setPanel(false)}>
                <Icon name="close" size={13} />
              </button>
            </div>
            {hunks.length > 0 && (
              <div className={styles.decideBar}>
                <span className={styles.progress}>
                  <span style={{ width: `${(decided / hunks.length) * 100}%` }} />
                </span>
                {decided} of {hunks.length} decided
              </div>
            )}
            <div className={styles.cards}>
              {hunks.map((h, i) => {
                const id = h.ids[0]!;
                const ps = h.ids.map((x) => byId.get(x)!);
                const minus = ps.reduce((n, p) => n + (p.b ? words(p.a, 'd') : count(plain(p.a, 'a'))), 0);
                const plus = ps.reduce((n, p) => n + (p.a ? words(p.b, 'i') : count(plain(p.b, 'b'))), 0);
                return (
                  <div key={id} className={styles.card} data-current={i === at || undefined} data-decided={decisions[id]} onClick={() => setCur(i)}>
                    <span className={styles.cardHead}>
                      <span className={styles.cardN}>{i + 1}.</span>
                      {KIND_LABEL[h.kind]}
                      <span className={styles.cardCounts}>
                        {minus > 0 && <span data-k="del">−{minus}</span>}
                        {plus > 0 && <span data-k="ins">+{plus}</span>}
                      </span>
                    </span>
                    {i === at ? (
                      <Region name="decide" as="span" className={styles.decide}>
                        <DecideButtons id={id} value={decisions[id]} onDecide={decide} />
                      </Region>
                    ) : (
                      <span className={styles.decide}>
                        <DecideButtons id={id} value={decisions[id]} onDecide={decide} />
                      </span>
                    )}
                    {cardLine(h, 'a')}
                    {cardLine(h, 'b')}
                  </div>
                );
              })}
              {!hunks.length && <span className={styles.panelFoot}>No changes left.</span>}
            </div>
            <span className={styles.panelFoot}>A accepts, X rejects the current change.</span>
          </Region>
        )}
      </div>
    </Frame>
  );
}

function DecideButtons({ id, value, onDecide }: { id: string; value?: Decision; onDecide(id: string, d: Decision): void }) {
  return (
    <>
      <button
        type="button"
        data-v="accept"
        aria-pressed={value === 'accept'}
        aria-label="Accept"
        title="Accept (A)"
        onClick={(e) => {
          e.stopPropagation();
          onDecide(id, 'accept');
        }}
      >
        <Icon name="check" size={12} />
      </button>
      <button
        type="button"
        data-v="reject"
        aria-pressed={value === 'reject'}
        aria-label="Reject"
        title="Reject (X)"
        onClick={(e) => {
          e.stopPropagation();
          onDecide(id, 'reject');
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </>
  );
}
