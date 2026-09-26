import { Fragment, memo, useLayoutEffect, useMemo, useRef } from 'react';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';
import type { ChangeSummary, Excerpt } from './changes';
import { KIND_LABEL, summarizeChange } from './changes';
import { plural } from './util';

interface PanelProps {
  cmp: Comparison;
  current: number;
  /** What to say when the documents match. */
  same: string;
  onGo(hunk: number): void;
  onClose(): void;
}

/** The list of changes beside the documents: a card for each change; clicking one goes to it. */
export function ChangesPanel({ cmp, current, same, onGo, onClose }: PanelProps) {
  const summaries = useMemo(() => cmp.hunks.map((_, i) => summarizeChange(cmp, i)), [cmp]);
  const list = useRef<HTMLOListElement>(null);

  // Keeps the current change's card in view (scrolled directly: a smooth scroll here would
  // cancel the documents' own in some browsers).
  useLayoutEffect(() => {
    const ol = list.current;
    const card = ol?.querySelector<HTMLElement>(`.chg-card[data-hunk="${current}"]`);
    if (!ol || !card) return;
    const lr = ol.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    if (cr.top < lr.top) ol.scrollTop += cr.top - lr.top - 8;
    else if (cr.bottom > lr.bottom) ol.scrollTop += cr.bottom - lr.bottom + 8;
  }, [current, summaries]);

  return (
    <aside className="changes" id="changes" aria-labelledby="changes-title">
      <div className="changes-head">
        <h2 id="changes-title">
          Changes {summaries.length > 0 && <span className="changes-count">{summaries.length.toLocaleString()}</span>}
        </h2>
        <button type="button" className="btn ghost icon-only" data-close-changes aria-label="Close the list of changes" data-tip="Close" onClick={onClose}>
          <Ico name="close" />
        </button>
      </div>
      <ol className="changes-list scroll-thin" id="changes-list" ref={list}>
        {summaries.length ? (
          summaries.map((s, i) => <ChangeCard key={i} index={i} summary={s} current={i === current} onGo={onGo} />)
        ) : (
          <li className="changes-none">
            <Ico name="check" />
            <span>{same}</span>
          </li>
        )}
      </ol>
    </aside>
  );
}

const ChangeCard = memo(function ChangeCard({ index, summary: s, current, onGo }: { index: number; summary: ChangeSummary; current: boolean; onGo(hunk: number): void }) {
  return (
    <li>
      <button type="button" className={`chg-card k-${s.kind}${current ? ' cur' : ''}`} aria-current={current || undefined} data-hunk={index} onClick={() => onGo(index)}>
        <span className="chg-head">
          <span className="chg-n">{index + 1}.</span>
          <span className="chg-kind">{KIND_LABEL[s.kind]}</span>
          {(s.minus > 0 || s.plus > 0) && (
            <span className="chg-counts">
              {s.minus > 0 && (
                <span className="minus">
                  <span className="vh">{plural(s.minus, 'word')} only in A,</span>
                  <span aria-hidden="true">−{s.minus.toLocaleString()}</span>
                </span>
              )}
              {s.plus > 0 && (
                <span className="plus">
                  <span className="vh">{plural(s.plus, 'word')} only in B,</span>
                  <span aria-hidden="true">+{s.plus.toLocaleString()}</span>
                </span>
              )}
            </span>
          )}
        </span>
        {s.edits.map((e, i) => (
          <Fragment key={i}>
            {e.a && (
              <span className="chg-line a">
                <ExcerptText x={e.a} />
              </span>
            )}
            {e.b && (
              <span className="chg-line b">
                <ExcerptText x={e.b} />
              </span>
            )}
            {e.note && <span className="chg-note">{e.note}</span>}
          </Fragment>
        ))}
        {s.more > 0 && <span className="chg-more">and {plural(s.more, 'more edit')}</span>}
      </button>
    </li>
  );
});

/** The words that differ, marked, with the text around them. */
function ExcerptText({ x }: { x: Excerpt }) {
  if (x.empty) return <i>An empty paragraph</i>;
  const words = x.text || <i>spaces</i>;
  const marked = x.mark === 'fmt' ? <mark className="fmt">{words}</mark> : x.mark === 'del' ? <del>{words}</del> : <ins>{words}</ins>;
  return (
    <>
      {x.before}
      {marked}
      {x.after}
    </>
  );
}
