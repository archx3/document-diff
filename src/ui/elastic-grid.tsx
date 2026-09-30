import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { MouseEvent, Ref } from 'react';
import { Ico } from '../components/icons';
import type { Comparison, Row } from '../core/compare';
import { computeListLabels } from '../core/lists';
import type { Dir } from '../core/merge';
import { optionsKey } from '../core/tokens';
import type { MarginInfo } from '../review/marks';
import { marginKey, marginSig } from '../review/marks';
import type { ElasticLayout } from './elastic';
import type { ReviewView } from './grid';
import { selectedIn } from './grid';
import { Rail, RailSpace } from './rail';
import type { Labels } from './render';
import type { ActKind, GridItem, RowPart } from './rows';
import { actLabels, numbering, rowParts } from './rows';

export interface ElasticGridProps {
  cmp: Comparison;
  items: readonly GridItem[];
  current: number;
  layout: ElasticLayout;
  /** Copies a whole change across. */
  onCopyHunk(hunk: number, dir: Dir): void;
  onFold(key: string): void;
  onInline(anchor: HTMLElement, rowKey: string, change: number): void;
  onPick(hunk: number): void;
  /** Review mode's margins, or null when it is off. */
  review: ReviewView | null;
  ref?: Ref<HTMLDivElement>;
}

/** One line of the grid: a paragraph, a row of a table or a fold, shown in both columns. */
type Line =
  | {
      type: 'part';
      key: string;
      row: Row;
      part: RowPart;
      /** Paragraph numbers, on the row's first line. */
      na: string;
      nb: string;
      /** On a change's first line: the arrows that copy the change across. */
      arrow: ActKind | null;
      /** The row's first line (where its marks go). */
      first: boolean;
    }
  | { type: 'fold'; key: string; foldKey: string; count: number };

/** Line kinds with nothing on A's side, and on B's: there the column shows where the other side's text would go. */
const GAP_A = new Set(['ins', 'tins']);
const GAP_B = new Set(['del', 'tdel']);

/**
 * The two documents side by side, each in its own column without gaps, with
 * bands joining the changes. The ElasticLayout lines the columns up as the page
 * scrolls; this renders them.
 */
export const ElasticGrid = memo(function ElasticGrid({ cmp, items, current, layout, onCopyHunk, onFold, onInline, onPick, review, ref }: ElasticGridProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const colA = useRef<HTMLDivElement>(null);
  const colB = useRef<HTMLDivElement>(null);
  const bands = useRef<SVGSVGElement>(null);
  const [labelsL, labelsR] = useMemo(() => [computeListLabels(cmp.left.blocks), computeListLabels(cmp.right.blocks)], [cmp]);
  const [numA, numB] = useMemo(() => [numbering(cmp.left), numbering(cmp.right)], [cmp]);
  const optsKey = optionsKey(cmp.opts);

  // Each row's lines, kept while the row, its list labels and the options stay the same (as the aligned grid's rows are).
  const cache = useRef(new Map<string, { deps: string; parts: RowPart[] }>());
  const lines = useMemo(() => {
    const out: Line[] = [];
    const seen = new Set<string>();
    let prevHunk = -1;
    for (const item of items) {
      if (item.type === 'fold') {
        out.push({ type: 'fold', key: `fold:${item.key}`, foldKey: item.key, count: item.count });
        prevHunk = -1;
        continue;
      }
      const row = item.row;
      const deps = `${label(labelsL, row, 'l')}|${label(labelsR, row, 'r')}|${optsKey}`;
      let hit = cache.current.get(row.key);
      if (hit?.deps !== deps) {
        hit = { deps, parts: rowParts(row, cmp.opts, labelsL, labelsR) };
        cache.current.set(row.key, hit);
      }
      seen.add(row.key);
      const na = row.l ? String(numA.get(row.l) ?? '') : '';
      const nb = row.r ? String(numB.get(row.r) ?? '') : '';
      hit.parts.forEach((part, i) => {
        const first = i === 0 && row.hunk >= 0 && row.hunk !== prevHunk;
        out.push({ type: 'part', key: `${row.key}#${i}`, row, part, na: i === 0 ? na : '', nb: i === 0 ? nb : '', arrow: first ? hunkKind(cmp, row.hunk) : null, first: i === 0 });
      });
      prevHunk = row.hunk;
    }
    for (const k of cache.current.keys()) if (!seen.has(k)) cache.current.delete(k);
    return out;
  }, [items, cmp, labelsL, labelsR, numA, numB, optsKey]);

  useLayoutEffect(() => {
    // The page's scroller is on the page already, though its ref may not be set yet.
    const scroller = el.current!.closest<HTMLElement>('.scroller') ?? el.current!.parentElement!;
    layout.attach({ scroller, grid: el.current!, a: colA.current!, b: colB.current!, bands: bands.current! });
    return () => layout.detach();
  }, [layout]);
  // After every render: read the lines again, keep the reader's place and line the columns up. When
  // only the current change moved, the lines are as they were (their sizes are watched anyway): its
  // band is drawn again without measuring every line, which in a long document means laying out
  // the whole of it.
  const measured = useRef<{ lines: readonly Line[]; review: ReviewView | null } | null>(null);
  useLayoutEffect(() => {
    layout.current = current;
    const m = measured.current;
    if (m?.lines === lines && m.review === review) layout.sync();
    else {
      measured.current = { lines, review };
      layout.rendered();
    }
  });

  const onClick = (e: MouseEvent) => {
    const t = e.target as Element;
    if (t.closest('button')) return;
    const band = t.closest<SVGElement>('.band');
    if (band) {
      onPick(Number(band.dataset.hunk));
      return;
    }
    const chg = t.closest<HTMLElement>('[data-c]');
    const rowEl = chg?.closest<HTMLElement>('.row.k-mod');
    if (chg && rowEl) {
      onInline(chg, rowEl.dataset.key!, Number(chg.dataset.c));
      return;
    }
    const row = t.closest<HTMLElement>('.row[data-hunk]');
    if (row && Number(row.dataset.hunk) >= 0) onPick(Number(row.dataset.hunk));
  };
  // Both sides of a word-level change light up together, though they are in different columns.
  const hover = (on: boolean) => (e: MouseEvent) => {
    const chg = (e.target as HTMLElement).closest?.<HTMLElement>('[data-c]');
    const row = chg?.closest<HTMLElement>('.row');
    if (!chg || !row?.dataset.a || !el.current) return;
    const sel = `.row[data-a="${CSS.escape(row.dataset.a)}"] [data-c="${chg.dataset.c}"]`;
    for (const x of Array.from(el.current.querySelectorAll(sel))) x.classList.toggle('hot', on);
  };

  const column = (side: 'a' | 'b') =>
    lines.map((line) => {
      const part = line.type === 'part';
      const sel = part && review ? selectedIn(review, line.row.key) : null;
      return (
        <SideLine
          key={line.key}
          line={line}
          side={side}
          cur={part && line.row.hunk >= 0 && line.row.hunk === current}
          onCopyHunk={onCopyHunk}
          onFold={onFold}
          review={review}
          rail={part && line.first ? review?.margins.get(marginKey(line.row.key, side)) : undefined}
          selected={part && sel === `${line.part.anchor}|${side}`}
        />
      );
    });
  return (
    <div
      className={`grid egrid${cmp.left.mono ? ' mono-a' : ''}${cmp.right.mono ? ' mono-b' : ''}`}
      id="grid"
      ref={(d) => {
        el.current = d;
        if (typeof ref === 'function') ref(d);
        else if (ref) ref.current = d;
      }}
      onClick={onClick}
      onMouseOver={hover(true)}
      onMouseOut={hover(false)}
    >
      <svg className="bands" ref={bands} aria-hidden="true" />
      <div className="ecol a" ref={colA}>
        {column('a')}
        <div className="ecap" />
      </div>
      <div className="ecol b" ref={colB}>
        {column('b')}
        <div className="ecap" />
      </div>
    </div>
  );
});

function label(labels: Labels, row: Row, side: 'l' | 'r'): string {
  const b = row[side];
  return b?.type === 'p' ? (labels.get(b) ?? '') : '';
}

/** A change that only removes paragraphs from A, or only adds them in B, is copied as such; anything else is a change of wording. */
function hunkKind(cmp: Comparison, hunk: number): ActKind {
  const h = cmp.hunks[hunk];
  if (!h) return 'mod';
  const kinds = new Set(cmp.rows.slice(h.start, h.end).map((r) => r.kind));
  return kinds.size === 1 && (kinds.has('del') || kinds.has('ins')) ? (kinds.has('del') ? 'del' : 'ins') : 'mod';
}

interface SideLineProps {
  line: Line;
  side: 'a' | 'b';
  cur: boolean;
  onCopyHunk: ElasticGridProps['onCopyHunk'];
  onFold: ElasticGridProps['onFold'];
  review: ReviewView | null;
  /** The marks beside this line (its row's first line). */
  rail?: MarginInfo;
  /** Text in this line is selected. */
  selected: boolean;
}

/** One line in one column: the text and this column's part of the gutter, or where the other side's text would go. */
const SideLine = memo(
  function SideLine({ line, side, cur, onCopyHunk, onFold, review, rail, selected }: SideLineProps) {
    if (line.type === 'fold') {
      // One fold, shown in both columns: the second is for the eye only.
      const hidden = side === 'b';
      return (
        <div className="row fold" data-a={`fold:${line.foldKey}`}>
          <button type="button" className="fold-btn" data-fold={line.foldKey} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined} onClick={() => onFold(line.foldKey)}>
            <span className="fold-side">
              <Ico name="fold" />
              <span>
                {line.count} unchanged {line.count === 1 ? 'paragraph' : 'paragraphs'}
              </span>
            </span>
          </button>
        </div>
      );
    }
    const { row, part } = line;
    const gap = (side === 'a' ? GAP_A : GAP_B).has(part.kind);
    // The margin outside the document, where there is text beside it.
    const margin =
      !review || gap ? null : line.first || selected ? <Rail side={side} rowKey={row.key} info={rail} selected={selected} actions={review.actions} /> : <RailSpace side={side} />;
    const n = side === 'a' ? line.na : line.nb;
    const gut = (
      <div className="egut" data-n={n || undefined}>
        {line.arrow && <HunkArrow side={side} kind={line.arrow} hunk={row.hunk} onCopyHunk={onCopyHunk} />}
      </div>
    );
    return (
      <div
        className={`row k-${part.kind}${part.extra}${gap ? ' gap' : ''}${cur ? ' cur' : ''}`}
        data-key={row.key}
        data-a={part.anchor}
        data-hunk={row.hunk}
        data-la={part.la}
        data-lb={part.lb}
      >
        {side === 'a' && margin}
        {side === 'b' && gut}
        {!gap && <div className={`cell ${side}`} dangerouslySetInnerHTML={{ __html: side === 'a' ? part.a : part.b }} />}
        {side === 'a' && gut}
        {side === 'b' && margin}
      </div>
    );
  },
  (p, q) =>
    p.side === q.side &&
    p.cur === q.cur &&
    sameLine(p.line, q.line) &&
    !!p.review === !!q.review &&
    p.review?.actions === q.review?.actions &&
    marginSig(p.rail) === marginSig(q.rail) &&
    p.selected === q.selected,
);

function sameLine(x: Line, y: Line): boolean {
  if (x.type === 'fold' || y.type === 'fold') return x.type === y.type && x.key === y.key && (x as { count: number }).count === (y as { count: number }).count;
  return x.part === y.part && x.row.hunk === y.row.hunk && x.na === y.na && x.nb === y.nb && x.arrow === y.arrow && x.first === y.first;
}

/** The arrow on one side of a change: A's sends A's version to B, B's sends B's to A. */
function HunkArrow({ side, kind, hunk, onCopyHunk }: { side: 'a' | 'b'; kind: ActKind; hunk: number; onCopyHunk: ElasticGridProps['onCopyHunk'] }) {
  const [toA, toB] = actLabels({ kind });
  const dir: Dir = side === 'a' ? 'l2r' : 'r2l';
  const text = side === 'a' ? toB : toA;
  /** The side it copies to. */
  const to = side === 'a' ? 'b' : 'a';
  return (
    <button type="button" className={`act to-${to}`} data-act={dir} data-tip={text} aria-label={text} onClick={() => onCopyHunk(hunk, dir)}>
      <Ico name={to === 'a' ? 'chevronsLeft' : 'chevronsRight'} />
    </button>
  );
}
