import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';
import type { HighlightColor, Reaction } from '../review/marks';
import type { ChangeSummary, Excerpt } from './changes';
import { KIND_LABEL, summarizeChange } from './changes';
import { REACTION_ICON, REACTION_NAME } from './rail';
import { when } from './review-card';
import type { Side } from './util';
import { SIDE_NAME, plural } from './util';

/** The marks on one change, for its card. */
export interface ChangeMarks {
  reactions: Reaction[];
  notes: number;
}

/** A note or highlight, for the list of notes. */
export interface PanelMark {
  id: string;
  kind: 'note' | 'highlight';
  /** Still in the documents. */
  found: boolean;
  /** The change it is on (a note on a change), or -1. */
  hunk: number;
  side?: Side;
  /** The row it shows beside, to go to it. */
  rowKey?: string;
  quote?: string;
  text?: string;
  color?: HighlightColor;
  created: number;
}

/** Review mode's part of the list: marks on the changes, and every note and highlight. */
export interface PanelReview {
  byHunk: ReadonlyMap<number, ChangeMarks>;
  marks: readonly PanelMark[];
  onGo(mark: PanelMark): void;
  onDelete(id: string): void;
}

interface PanelProps {
  cmp: Comparison;
  current: number;
  /** What to say when the documents match. */
  same: string;
  onGo(hunk: number): void;
  onClose(): void;
  /** In review mode, the marks. */
  review: PanelReview | null;
}

/** The list of changes beside the documents: a card for each change; clicking one goes to it. */
export function ChangesPanel({ cmp, current, same, onGo, onClose, review }: PanelProps) {
  const summaries = useMemo(() => cmp.hunks.map((_, i) => summarizeChange(cmp, i)), [cmp]);
  const list = useRef<HTMLOListElement>(null);
  const [tab, setTab] = useState<'changes' | 'notes'>('changes');
  const showNotes = !!review && tab === 'notes';

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
        {review ? (
          <div className="panel-tabs" role="tablist" aria-label="Changes and notes">
            <button type="button" role="tab" id="changes-title" aria-selected={!showNotes} aria-controls="changes-list" onClick={() => setTab('changes')}>
              Changes {summaries.length > 0 && <span className="changes-count">{summaries.length.toLocaleString()}</span>}
            </button>
            <button type="button" role="tab" id="notes-tab" aria-selected={showNotes} aria-controls="notes-list" onClick={() => setTab('notes')}>
              Notes {review.marks.length > 0 && <span className="changes-count">{review.marks.length.toLocaleString()}</span>}
            </button>
          </div>
        ) : (
          <h2 id="changes-title">
            Changes {summaries.length > 0 && <span className="changes-count">{summaries.length.toLocaleString()}</span>}
          </h2>
        )}
        <button type="button" className="btn ghost icon-only" data-close-changes aria-label="Close the list of changes" data-tip="Close" onClick={onClose}>
          <Ico name="close" />
        </button>
      </div>
      {showNotes ? (
        <NotesList review={review} />
      ) : (
        <ol className="changes-list scroll-thin" id="changes-list" ref={list}>
          {summaries.length ? (
            summaries.map((s, i) => <ChangeCard key={i} index={i} summary={s} current={i === current} marks={review?.byHunk.get(i)} onGo={onGo} />)
          ) : (
            <li className="changes-none">
              <Ico name="check" />
              <span>{same}</span>
            </li>
          )}
        </ol>
      )}
    </aside>
  );
}

const ChangeCard = memo(function ChangeCard({
  index,
  summary: s,
  current,
  marks,
  onGo,
}: {
  index: number;
  summary: ChangeSummary;
  current: boolean;
  marks?: ChangeMarks;
  onGo(hunk: number): void;
}) {
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
          {marks && (marks.reactions.length > 0 || marks.notes > 0) && (
            <span className="chg-marks">
              {marks.reactions.map((r) => (
                <span key={r} className={`rx ${r}`} title={REACTION_NAME[r]}>
                  <Ico name={REACTION_ICON[r]} size={14} />
                  <span className="vh">{REACTION_NAME[r]},</span>
                </span>
              ))}
              {marks.notes > 0 && (
                <span className="rn">
                  <Ico name="note" size={14} />
                  <span className="vh">{plural(marks.notes, 'note')}</span>
                  {marks.notes > 1 && <b aria-hidden="true">{marks.notes}</b>}
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

/** Every note and highlight: those still in the documents first, in the order they come, then any no longer there. */
function NotesList({ review }: { review: PanelReview }) {
  const found = review.marks.filter((m) => m.found);
  const lost = review.marks.filter((m) => !m.found);
  if (!review.marks.length)
    return (
      <div className="changes-list notes-list" id="notes-list" role="tabpanel" aria-labelledby="notes-tab">
        <p className="notes-none">
          Notes and highlights you add from the margins beside the documents are listed here. Select some text to highlight it or note on it.
        </p>
      </div>
    );
  return (
    <ol className="changes-list notes-list scroll-thin" id="notes-list" role="tabpanel" aria-labelledby="notes-tab">
      {found.map((m) => (
        <MarkCard key={m.id} mark={m} review={review} />
      ))}
      {lost.length > 0 && <li className="notes-lost-head">No longer in the documents</li>}
      {lost.map((m) => (
        <MarkCard key={m.id} mark={m} review={review} />
      ))}
    </ol>
  );
}

function MarkCard({ mark: m, review }: { mark: PanelMark; review: PanelReview }) {
  const where = m.hunk >= 0 && !m.side ? `Change ${m.hunk + 1}` : m.side ? `In ${SIDE_NAME[m.side]}${m.hunk >= 0 ? `, change ${m.hunk + 1}` : ''}` : '';
  const body = (
    <>
      <span className="chg-head">
        {m.kind === 'note' ? <Ico name="note" size={14} /> : <span className={`rh ${m.color}`} aria-hidden="true" />}
        <span className="chg-kind">{m.kind === 'note' ? 'Note' : 'Highlight'}</span>
        {where && <span className="mark-where">{where}</span>}
        <span className="mark-when">{when(m.created)}</span>
      </span>
      {m.quote && <span className="mark-quote">“{m.quote.length > 140 ? `${m.quote.slice(0, 139)}…` : m.quote}”</span>}
      {m.text && <span className="mark-text">{m.text}</span>}
    </>
  );
  return (
    <li className="mark-item">
      {m.found ? (
        <button type="button" className="chg-card mark-card" data-mark={m.id} onClick={() => review.onGo(m)}>
          {body}
        </button>
      ) : (
        <div className="chg-card mark-card lost" data-mark={m.id}>
          {body}
          <button type="button" className="btn ghost sm" onClick={() => review.onDelete(m.id)}>
            <Ico name="trash" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </li>
  );
}
