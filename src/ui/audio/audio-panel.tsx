/**
 * The pane beside two recordings, as the list of changes is beside two
 * documents: what sounds different, and — once the recordings are transcribed —
 * the words that changed, in a second half under it (the divide between them
 * can be dragged). Clicking a difference or a word change goes to it.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { AudioDifference } from '../../audio/align';
import type { Word } from '../../audio/transcribe';
import type { WordRun } from '../../audio/words';
import { diffWords, wordChanges } from '../../audio/words';
import { Ico } from '../../components/icons';
import { notesOf } from '../../review/media-notes';
import type { MediaNotesApi } from '../media-notes-ui';
import { NotesList } from '../media-notes-ui';
import { clock } from '../facts';
import { KIND_NAME } from './playback';
import type { AudioCompare } from './use-audio-compare';

/** The share of the pane the differences take when both halves show (the rest is the words'). */
const SPLIT_KEY = 'collate.audio-split';

function savedSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= 0.15 && v <= 0.85 ? v : 0.5;
  } catch {
    return 0.5;
  }
}

export function AudioPanel({ ctl, notes, onClose }: { ctl: AudioCompare; notes?: MediaNotesApi; onClose(): void }) {
  const [tab, setTab] = useState<'differences' | 'notes'>('differences');
  const noteList = notes ? notesOf(notes.list, 'time') : [];
  // A note being written shows in the list.
  const opened = notes?.open && noteList.some((n) => n.id === notes.open);
  const showNotes = tab === 'notes' || !!opened;
  const { differences, current } = ctl;
  const t = ctl.transcript;
  const runs = useMemo(() => (t.status === 'done' ? diffWords(t.a.words, t.b.words, ctl.ignore) : null), [t, ctl.ignore]);
  const changes = useMemo(() => (runs ? wordChanges(runs) : []), [runs]);
  const [word, setWord] = useState(-1);
  const [split, setSplit] = useState(savedSplit);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const setAndSave = (v: number) => {
    const next = Math.min(0.85, Math.max(0.15, v));
    setSplit(next);
    try {
      localStorage.setItem(SPLIT_KEY, String(next));
    } catch {
      /* Remembered for this page only. */
    }
  };
  const moveDivide = (e: ReactPointerEvent) => {
    const r = body.current?.getBoundingClientRect();
    if (drag.current && r?.height) setAndSave((e.clientY - r.top) / r.height);
  };
  const divideKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? -0.05 : e.key === 'ArrowDown' ? 0.05 : 0;
    if (!d) return;
    e.preventDefault();
    setAndSave(split + d);
  };

  const playWords = (i: number) => {
    const c = changes[i];
    if (!c) return;
    setWord(i);
    // Heard in the recording being listened to, if the change has words in it.
    const side = ctl.heard === 'a' ? (c.aStart !== undefined ? 'a' : 'b') : c.bStart !== undefined ? 'b' : 'a';
    const at = side === 'a' ? c.aStart : c.bStart;
    if (at === undefined) return;
    ctl.seek(side, Math.max(0, at - 0.2));
    if (!ctl.playing) ctl.toggle();
  };

  const words = runs !== null && ctl.showTranscript;
  return (
    <aside className="changes audio-changes" id="changes" aria-labelledby="changes-title">
      <div className="changes-head">
        {notes ? (
          <div className="panel-tabs" role="tablist" aria-label="Differences and notes">
            <button type="button" role="tab" id="changes-title" aria-selected={!showNotes} onClick={() => (setTab('differences'), notes.setOpen(null))}>
              Differences {differences.length > 0 && <span className="changes-count">{differences.length.toLocaleString()}</span>}
            </button>
            <button type="button" role="tab" id="notes-tab" aria-selected={showNotes} onClick={() => setTab('notes')}>
              Notes {noteList.length > 0 && <span className="changes-count">{noteList.length.toLocaleString()}</span>}
            </button>
          </div>
        ) : (
          <h2 id="changes-title">Differences {differences.length > 0 && <span className="changes-count">{differences.length.toLocaleString()}</span>}</h2>
        )}
        <button type="button" className="btn ghost icon-only" data-close-changes aria-label="Close the list of differences" data-tip="Close" onClick={onClose}>
          <Ico name="close" />
        </button>
      </div>
      {notes && showNotes ? (
        <>
          <div className="ap-notes-bar">
            <button
              type="button"
              className={`btn sm${ctl.annotate ? ' primary' : ''}`}
              data-panel="annotate"
              aria-pressed={ctl.annotate}
              data-tip="Drag along a track to mark a stretch, or click a moment, and write a note on it (C)"
              onClick={() => ctl.setAnnotate(!ctl.annotate)}
            >
              <Ico name="note" />
              <span>{ctl.annotate ? 'Adding notes' : 'Add a note'}</span>
            </button>
          </div>
          <NotesList
            notes={noteList}
            api={notes}
            empty="No notes yet. Choose Add a note, then drag along either track to mark a stretch, or click a moment."
            onGo={(n) => {
              if (n.at.type === 'time') ctl.seek(n.side, n.at.start);
              notes.setOpen(n.id);
            }}
          />
        </>
      ) : (
        <div className={`ap-body${words ? ' split' : ''}`} ref={body} style={words ? { gridTemplateRows: `${split}fr auto ${1 - split}fr` } : undefined}>
          <section className="ap-half" aria-label="Sounds">
            {words && <h3 className="ap-title">Sound</h3>}
            {differences.length ? (
              <ol className="changes-list" id="changes-list">
                {differences.map((d, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`chg-card at-card${i === current ? ' cur' : ''}`}
                      data-item={i}
                      aria-current={i === current || undefined}
                      onClick={() => ctl.goTo(i)}
                    >
                      <span className="chg-head">
                        <span className="chg-n">{i + 1}.</span>
                        <span className={`at-kind ${d.kind}`}>{KIND_NAME[d.kind]}</span>
                        <span className="at-len">{Math.max(d.aEnd - d.aStart, d.bEnd - d.bStart).toFixed(1)} s</span>
                      </span>
                      <span className="at-when">
                        {d.kind !== 'added' && (
                          <span>
                            <b className="side-a">A</b> {clock(d.aStart)}–{clock(d.aEnd)}
                          </span>
                        )}
                        {d.kind !== 'removed' && (
                          <span>
                            <b className="side-b">B</b> {clock(d.bStart)}–{clock(d.bEnd)}
                          </span>
                        )}
                      </span>
                      {runs && <TranscriptExcerpt runs={runs} d={d} />}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ap-none">{ctl.busy || !ctl.sides ? 'Comparing…' : 'No differences heard'}</p>
            )}
          </section>
          {words && (
            <>
              <div
                className="ap-divide"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the halves"
                aria-valuemin={15}
                aria-valuemax={85}
                aria-valuenow={Math.round(split * 100)}
                tabIndex={0}
                onPointerDown={(e) => {
                  drag.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={moveDivide}
                onPointerUp={() => (drag.current = false)}
                onPointerCancel={() => (drag.current = false)}
                onDoubleClick={() => setAndSave(0.5)}
                onKeyDown={divideKey}
              />
              <section className="ap-half" aria-label="Words">
                <h3 className="ap-title">Words {changes.length > 0 && <span className="changes-count">{changes.length.toLocaleString()}</span>}</h3>
                {changes.length ? (
                  <ol className="changes-list" data-words>
                    {changes.map((c, i) => {
                      const kind = !c.removed ? 'ins' : !c.added ? 'del' : 'mod';
                      return (
                        <li key={i}>
                          <button type="button" className={`chg-card k-${kind}${i === word ? ' cur' : ''}`} data-word={i} onClick={() => playWords(i)}>
                            <span className="chg-head">
                              <span className="chg-n">{i + 1}.</span>
                              <span className="chg-kind">{kind === 'ins' ? 'Only in B' : kind === 'del' ? 'Only in A' : 'Said differently'}</span>
                              <span className="at-len">{clock((c.aStart ?? c.bStart ?? 0) as number)}</span>
                            </span>
                            <span className="at-said">
                              {c.removed && <span className="del">{c.removed}</span>}
                              {c.added && <span className="ins">{c.added}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="ap-none">{t.status === 'done' && !t.a.words.length && !t.b.words.length ? 'No speech heard' : 'The same words in both'}</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

/** The words said in a difference's stretch, in each recording, the changed ones marked. */
function TranscriptExcerpt({ runs, d }: { runs: readonly WordRun[]; d: AudioDifference }) {
  const inA = (w: Word) => w.end > d.aStart - 0.2 && w.start < d.aEnd + 0.2;
  const inB = (w: Word) => w.end > d.bStart - 0.2 && w.start < d.bEnd + 0.2;
  // What only one recording has is said only in that one.
  const a = d.kind === 'added' ? [] : runs.flatMap((r) => r.a.filter(inA).map((w) => ({ w, same: r.same })));
  const b = d.kind === 'removed' ? [] : runs.flatMap((r) => r.b.filter(inB).map((w) => ({ w, same: r.same })));
  if (!a.length && !b.length) return null;
  return (
    <span className="at-said">
      {a.length > 0 && (
        <span>
          {a.map((x, i) => (
            <span key={i} className={x.same ? '' : 'del'}>
              {x.w.text}{' '}
            </span>
          ))}
        </span>
      )}
      {b.length > 0 && (
        <span>
          {b.map((x, i) => (
            <span key={i} className={x.same ? '' : 'ins'}>
              {x.w.text}{' '}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
