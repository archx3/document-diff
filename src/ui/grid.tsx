import { Component, memo, useLayoutEffect, useMemo } from 'react';
import type { MouseEvent, ReactNode, Ref } from 'react';
import { Ico } from '../components/icons';
import type { Comparison, Row } from '../core/compare';
import { computeListLabels } from '../core/lists';
import type { Dir } from '../core/merge';
import type { CompareOptions } from '../core/tokens';
import { optionsKey } from '../core/tokens';
import type { Anchor } from './layout';
import type { Labels } from './render';
import type { Act, GridItem } from './rows';
import { actLabels, numbering, rowParts } from './rows';

export interface GridProps {
  cmp: Comparison;
  items: readonly GridItem[];
  current: number;
  /** Copies a row, or one row of a table (`sub`), across. */
  onCopy(rowKey: string, dir: Dir, sub?: string): void;
  /** Shows the unchanged rows folded under `key`. */
  onFold(key: string): void;
  /** A word-level change was clicked. */
  onInline(anchor: HTMLElement, rowKey: string, change: number): void;
  /** A changed row was clicked. */
  onPick(hunk: number): void;
  /** The rows were rendered again. */
  onRender(): void;
  ref?: Ref<HTMLDivElement>;
}

/** The two documents side by side, one aligned row at a time. */
export const DocumentGrid = memo(function DocumentGrid({ cmp, items, current, onCopy, onFold, onInline, onPick, onRender, ref }: GridProps) {
  const [labelsL, labelsR] = useMemo(() => [computeListLabels(cmp.left.blocks), computeListLabels(cmp.right.blocks)], [cmp]);
  const [numA, numB] = useMemo(() => [numbering(cmp.left), numbering(cmp.right)], [cmp]);
  const optsKey = optionsKey(cmp.opts);
  useLayoutEffect(() => onRender());

  // Word-level changes are inside the rows' HTML, so their clicks are handled here.
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return;
    const chg = t.closest<HTMLElement>('[data-c]');
    const rowEl = chg?.closest<HTMLElement>('.row.k-mod');
    if (chg && rowEl) {
      onInline(chg, rowEl.dataset.key!, Number(chg.dataset.c));
      return;
    }
    // Clicking a changed row makes it the current change.
    const row = t.closest<HTMLElement>('.row[data-hunk]');
    if (row && Number(row.dataset.hunk) >= 0) onPick(Number(row.dataset.hunk));
  };
  // Both sides of a word-level change light up together.
  const hover = (on: boolean) => (e: MouseEvent) => {
    const chg = (e.target as HTMLElement).closest?.<HTMLElement>('[data-c]');
    const row = chg?.closest('.row');
    if (!chg || !row) return;
    for (const el of Array.from(row.querySelectorAll(`[data-c="${chg.dataset.c}"]`))) el.classList.toggle('hot', on);
  };

  const label = (labels: Labels, row: Row, side: 'l' | 'r') => {
    const b = row[side];
    return b?.type === 'p' ? (labels.get(b) ?? '') : '';
  };
  return (
    <div
      className={`grid${cmp.left.mono ? ' mono-a' : ''}${cmp.right.mono ? ' mono-b' : ''}`}
      id="grid"
      ref={ref}
      onClick={onClick}
      onMouseOver={hover(true)}
      onMouseOut={hover(false)}
    >
      {items.map((item) =>
        item.type === 'fold' ? (
          <FoldRow key={`fold:${item.key}`} foldKey={item.key} count={item.count} onFold={onFold} />
        ) : (
          <RowView
            key={item.row.key}
            row={item.row}
            hunk={item.row.hunk}
            cur={item.row.hunk >= 0 && item.row.hunk === current}
            labelA={label(labelsL, item.row, 'l')}
            labelB={label(labelsR, item.row, 'r')}
            na={item.row.l ? String(numA.get(item.row.l) ?? '') : ''}
            nb={item.row.r ? String(numB.get(item.row.r) ?? '') : ''}
            optsKey={optsKey}
            opts={cmp.opts}
            labelsL={labelsL}
            labelsR={labelsR}
            onCopy={onCopy}
          />
        ),
      )}
    </div>
  );
});

interface RowViewProps {
  row: Row;
  hunk: number;
  cur: boolean;
  /** The list labels of the row's paragraphs, which change when items before them are added or removed. */
  labelA: string;
  labelB: string;
  /** Paragraph numbers, for the gutter. */
  na: string;
  nb: string;
  optsKey: string;
  opts: CompareOptions;
  labelsL: Labels;
  labelsR: Labels;
  onCopy: GridProps['onCopy'];
}

/**
 * One aligned row. Its key names the blocks on each side, so a row with the
 * same key shows the same thing: comparing again after an edit only renders
 * the rows that changed.
 */
const RowView = memo(
  function RowView({ row, hunk, cur, labelA, labelB, na, nb, optsKey, opts, labelsL, labelsR, onCopy }: RowViewProps) {
    // The key, the labels and the options say what the row shows (a new comparison makes new row objects).
    const parts = useMemo(() => rowParts(row, opts, labelsL, labelsR), [row.key, labelA, labelB, optsKey]);
    return (
      <>
        {parts.map((p, i) => (
          <div key={i} className={`row k-${p.kind}${p.extra}${cur ? ' cur' : ''}`} data-key={row.key} data-a={p.anchor} data-hunk={hunk} data-la={p.la} data-lb={p.lb}>
            <div className="cell a" dangerouslySetInnerHTML={{ __html: p.a }} />
            <div className="gut" data-na={i === 0 ? na : undefined} data-nb={i === 0 ? nb : undefined}>
              {p.act && <Arrows act={p.act} rowKey={row.key} onCopy={onCopy} />}
            </div>
            <div className="cell b" dangerouslySetInnerHTML={{ __html: p.b }} />
          </div>
        ))}
      </>
    );
  },
  (p, q) =>
    p.row.key === q.row.key &&
    p.hunk === q.hunk &&
    p.cur === q.cur &&
    p.labelA === q.labelA &&
    p.labelB === q.labelB &&
    p.na === q.na &&
    p.nb === q.nb &&
    p.optsKey === q.optsKey,
);

/** The arrows either side of the ruler that copy a row across. */
function Arrows({ act, rowKey, onCopy }: { act: Act; rowKey: string; onCopy: GridProps['onCopy'] }) {
  const [toA, toB] = actLabels(act);
  return (
    <>
      <button type="button" className="act to-a" data-act="r2l" data-key={rowKey} data-sub={act.sub} data-tip={toA} aria-label={toA} onClick={() => onCopy(rowKey, 'r2l', act.sub)}>
        <Ico name="chevronsLeft" />
      </button>
      <button type="button" className="act to-b" data-act="l2r" data-key={rowKey} data-sub={act.sub} data-tip={toB} aria-label={toB} onClick={() => onCopy(rowKey, 'l2r', act.sub)}>
        <Ico name="chevronsRight" />
      </button>
    </>
  );
}

/** Unchanged paragraphs folded away. The label shows on both columns, clear of the overview on the gutter. */
const FoldRow = memo(function FoldRow({ foldKey, count, onFold }: { foldKey: string; count: number; onFold(key: string): void }) {
  const label = (
    <>
      <Ico name="fold" />
      <span>
        {count} unchanged {count === 1 ? 'paragraph' : 'paragraphs'}
      </span>
    </>
  );
  return (
    <div className="row fold" data-a={`fold:${foldKey}`}>
      <button type="button" className="fold-btn" data-fold={foldKey} onClick={() => onFold(foldKey)}>
        <span className="fold-side">{label}</span>
        <span className="fold-side" aria-hidden="true">
          {label}
        </span>
      </button>
    </div>
  );
});

/** Records which lines are at the top of the screen, and puts them back there. */
export interface Place {
  capture(): Anchor | null;
  restore(anchor: Anchor): void;
}

interface KeepPlaceProps {
  place: Place;
  /** When any of these changes, the rows may move. */
  watch: readonly unknown[];
  children: ReactNode;
}

/**
 * Keeps the reader's place when the rows change or change size: the line at
 * the top of the screen stays where it was. It is measured just before React
 * changes the page, so it also covers changes elsewhere in the same update,
 * such as the gutter or the list of changes changing the columns' width.
 */
export class KeepPlace extends Component<KeepPlaceProps> {
  override getSnapshotBeforeUpdate(prev: Readonly<KeepPlaceProps>): Anchor | null {
    const { place, watch } = this.props;
    if (watch.length === prev.watch.length && watch.every((w, i) => Object.is(w, prev.watch[i]))) return null;
    return place.capture();
  }

  override componentDidUpdate(_prev: Readonly<KeepPlaceProps>, _state: unknown, anchor: Anchor | null): void {
    if (anchor) this.props.place.restore(anchor);
  }

  override render(): ReactNode {
    return this.props.children;
  }
}
