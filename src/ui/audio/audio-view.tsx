/**
 * Two recordings compared: A's track over B's on one time scale, the
 * differences marked on each and joined by bands between them (as the text
 * view joins changes), a playhead on each at the same moment of the
 * recording, and the playback bar. Over the tracks, a ruler of the whole
 * recordings frames the part in view: drag the frame to scroll, drag its ends
 * to zoom. Pressing a track, or dragging a playhead, scrubs. Under it all, the
 * transcripts compared as text; the differences are listed in the pane.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Ico } from '../../components/icons';
import { newMediaNote, notesOf } from '../../review/media-notes';
import type { MediaNote } from '../../review/media-notes';
import type { MediaNotesApi } from '../media-notes-ui';
import { NoteEditor } from '../media-notes-ui';
import type { Doc } from '../../core/model';
import type { Word } from '../../audio/transcribe';
import { diffWords } from '../../audio/words';
import { clock, fileSize } from '../facts';
import type { DocMenu } from '../heads';
import type { Side } from '../util';
import { SIDE_NAME, kindLabel } from '../util';
import { KIND_NAME, PlaybackBar } from './playback';
import { Track } from './track';
import { TranscriptCompare } from './transcript-view';
import type { AudioCompare } from './use-audio-compare';

const TRACK_H = 112;
const BAND_H = 44;
/** The widest a track is drawn (canvases have limits). */
const MAX_W = 16000;
/** The width of the heads left of the tracks (see .at-side). */
const HEAD_W = 76;
/** The zoom's range. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

/** The side colours, read from the stylesheet (so they follow the theme). */
function useSideColors(el: HTMLElement | null): Record<Side, string> {
  const [colors, setColors] = useState({ a: '#b4533a', b: '#2e7d5b' });
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => {
      const s = getComputedStyle(el);
      setColors({
        a: s.getPropertyValue('--a').trim() || '#b4533a',
        b: s.getPropertyValue('--b').trim() || '#2e7d5b',
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => mo.disconnect();
  }, [el]);
  return colors;
}

/** What the heads need: the documents, and their Replace and Export menus. */
export interface AudioHeads {
  docs: Record<Side, Doc>;
  /** The menu that is open, as "load-a" and so on. */
  open: string | null;
  onMenu(menu: DocMenu, side: Side, anchor: HTMLElement): void;
}

const channelsName = (n: number) => (n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} channels`);

/** `bands`: the transcripts are shown with connection bands, as documents are (or in aligned rows). */
export function AudioView({ ctl, heads, notes, bands = false }: { ctl: AudioCompare; heads: AudioHeads; notes?: MediaNotesApi; bands?: boolean }) {
  const drawing = !!notes && ctl.annotate;
  /** The stretch being marked for a note, in seconds of its recording. */
  const [draft, setDraft] = useState<{ side: Side; t0: number; t1: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const colors = useSideColors(root);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ctl.sides]);

  const { sides, differences, current } = ctl;
  const longest = sides ? Math.max(sides.a.decoded.duration, sides.b.decoded.duration) : 0;
  // The tracks' width in view (right of the heads); zoomed, they are drawn wider and scroll.
  const inView = Math.max(1, width - HEAD_W - 2);
  const full = Math.min(MAX_W, inView * ctl.zoom);
  const pps = longest ? full / longest : 0;
  const x = (t: number) => t * pps;

  const said = ctl.transcript;
  const words = useMemo(() => (said.status === 'done' ? diffWords(said.a.words, said.b.words, ctl.ignore) : null), [said, ctl.ignore]);
  const wordMarks = useMemo(() => {
    if (!words) return { a: [] as Word[], b: [] as Word[] };
    return {
      a: words.filter((r) => !r.same).flatMap((r) => r.a),
      b: words.filter((r) => !r.same).flatMap((r) => r.b),
    };
  }, [words]);

  // The part in view, as fractions of the whole (for the ruler's frame); and where to scroll to
  // once a zoom has been drawn (the ruler's, or else keeping the middle where it was).
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, size: 1 });
  const pending = useRef<number | null>(null);
  const middle = useRef(0.5);
  const readView = () => {
    const sc = scroller.current;
    if (!sc || !sc.scrollWidth) return;
    const next = {
      left: sc.scrollLeft / sc.scrollWidth,
      size: Math.min(1, sc.clientWidth / sc.scrollWidth),
    };
    middle.current = next.left + next.size / 2;
    setView((v) => (Math.abs(v.left - next.left) < 1e-4 && Math.abs(v.size - next.size) < 1e-4 ? v : next));
  };
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const left = pending.current ?? middle.current - Math.min(1, sc.clientWidth / sc.scrollWidth) / 2;
    pending.current = null;
    sc.scrollLeft = Math.max(0, left * sc.scrollWidth);
    readView();
    // Only when the drawn width changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  // The playheads follow along while playing (not while being dragged).
  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc || !ctl.playing || ctl.scrubbing) return;
    const px = x(ctl.timeOf(ctl.heard));
    if (px < sc.scrollLeft + 40 || px > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, px - sc.clientWidth / 3);
  });

  if (ctl.error) return <p className="ic-error">{ctl.error}</p>;

  /**
   * Pressing a track: it scrubs (the playhead goes there, and along with a
   * drag); or, adding notes, a drag marks a stretch to write on (a click, a moment).
   */
  const scrubAt = (side: Side) => {
    const timeAt = (e: ReactPointerEvent<HTMLDivElement>) => Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / pps);
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || !pps || (e.target as Element).closest(drawing ? '.at-note, .at-knob' : '.at-diff, .at-note')) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        if (drawing && !(e.target as Element).closest('.at-head')) {
          const t = timeAt(e);
          setDraft({ side, t0: t, t1: t });
          return;
        }
        ctl.scrubStart(side);
        ctl.scrubTo(timeAt(e));
      },
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (draft) setDraft({ ...draft, t1: timeAt(e) });
        else if (ctl.scrubbing) ctl.scrubTo(timeAt(e));
      },
      onPointerUp: () => {
        if (draft && notes) {
          const len = sides?.[draft.side].decoded.duration ?? 0;
          const clampT = (t: number) => Math.min(len, t);
          const tiny = Math.abs(draft.t1 - draft.t0) * pps < 5;
          const n = newMediaNote(draft.side, { type: 'time', start: clampT(draft.t0), end: clampT(tiny ? draft.t0 : draft.t1) }, notes.author);
          notes.add(n);
          notes.setOpen(n.id);
          setDraft(null);
        } else if (ctl.scrubbing) ctl.scrubEnd();
      },
      onPointerCancel: () => {
        setDraft(null);
        if (ctl.scrubbing) ctl.scrubEnd();
      },
    };
  };
  const recordingNotes = notes ? notesOf(notes.list, 'time') : [];

  const trackRow = (side: Side) => {
    const s = sides?.[side];
    const w = s ? x(s.decoded.duration) : 0;
    const doc = heads.docs[side];
    const d = s?.decoded;
    const name = SIDE_NAME[side];
    return (
      <div className={`at-row ${side}`} data-side={side}>
        {/* The head: which recording, its format, and replacing or exporting it. It stays put as the tracks scroll. */}
        <div className="at-side" data-side={side}>
          <span className="siglum" aria-hidden="true">
            {name}
          </span>
          <span className="badge" data-kind="audio">
            {kindLabel(doc)}
          </span>
          <span className="at-side-tools">
            <button
              type="button"
              className="btn ghost icon-only sm"
              data-menu="load"
              data-side={side}
              aria-haspopup="true"
              aria-expanded={heads.open === `load-${side}` || undefined}
              aria-label={`Replace ${name}`}
              data-tip={`Load a different recording as ${name}`}
              onClick={(e) => heads.onMenu('load', side, e.currentTarget)}
            >
              <Ico name="open" />
            </button>
            <button
              type="button"
              className="btn ghost icon-only sm"
              data-menu="export"
              data-side={side}
              aria-haspopup="true"
              aria-expanded={heads.open === `export-${side}` || undefined}
              aria-label={`Export ${name}`}
              data-tip={`Download ${name}`}
              onClick={(e) => heads.onMenu('export', side, e.currentTarget)}
            >
              <Ico name="download" />
            </button>
          </span>
        </div>
        <div className="at-main">
          <div className="at-label" style={{ width: Math.max(0, inView - 24) }}>
            <span className="at-facts">
              <span className="at-name" title={doc.name}>
                {doc.name}
              </span>
              {d && d.sampleRate ? (
                <span data-fact="rate">{`${+(d.sampleRate / 1000).toFixed(2)} kHz`}</span>
              ) : d ? (
                <span data-fact="rate">{`${Math.round(d.bitrate / 1000)} kbps`}</span>
              ) : null}
              {d && <span data-fact="channels">{channelsName(d.channels)}</span>}
              {ctl.heard === side && ctl.playing && <span className="at-live">Playing</span>}
            </span>
            <span className="at-facts end">
              {d && <span data-fact="duration">{clock(d.duration)}</span>}
              {s?.obj.data && <span data-fact="size">{fileSize(s.obj.data.length)}</span>}
            </span>
          </div>
          <div className="at-track" style={{ width: w, height: TRACK_H }} data-track={side} data-annotating={drawing || undefined} {...scrubAt(side)}>
            {s && <Track samples={s.decoded.mono} vis={ctl.vis} width={w} height={TRACK_H} color={colors[side]} />}
            {differences.map((d, i) => {
              const [from, to] = side === 'a' ? [d.aStart, d.aEnd] : [d.bStart, d.bEnd];
              if (to <= from && ((side === 'a' && d.kind === 'added') || (side === 'b' && d.kind === 'removed'))) {
                return <span key={i} className={`at-gap ${d.kind}`} style={{ left: x(from) }} data-diff={i} />;
              }
              return (
                <button
                  type="button"
                  key={i}
                  className={`at-diff ${d.kind}`}
                  data-diff={i}
                  data-on={i === current || undefined}
                  aria-label={`${KIND_NAME[d.kind]}, ${clock(from)} to ${clock(to)}`}
                  style={{ left: x(from), width: Math.max(3, x(to - from)) }}
                  onClick={() => ctl.goTo(i)}
                />
              );
            })}
            {wordMarks[side].map((wd, i) => (
              <span
                key={`w${i}`}
                className="at-word"
                style={{
                  left: x(wd.start),
                  width: Math.max(2, x(wd.end - wd.start)),
                }}
                title={wd.text}
              />
            ))}
            {notes &&
              recordingNotes.map((n, i) =>
                n.side === side && n.at.type === 'time' ? (
                  <button
                    type="button"
                    key={n.id}
                    className={`at-note hl-${n.color}${n.at.end - n.at.start < 0.05 ? ' point' : ''}`}
                    data-note={n.id}
                    data-open={notes.open === n.id || undefined}
                    aria-label={`Note ${i + 1}${n.text ? `: ${n.text}` : ''}`}
                    data-tip={n.text || undefined}
                    style={{ left: x(n.at.start), width: Math.max(0, x(n.at.end - n.at.start)) }}
                    onClick={() => notes.setOpen(n.id)}
                  >
                    <span className={`mn-num hl-${n.color}`}>{i + 1}</span>
                  </button>
                ) : null,
              )}
            {draft?.side === side && <span className="at-note draft" style={{ left: x(Math.min(draft.t0, draft.t1)), width: x(Math.abs(draft.t1 - draft.t0)) }} />}
            {s && (
              <span className={`at-head${ctl.heard === side ? ' heard' : ''}`} data-head={side} style={{ left: x(ctl.timeOf(side)) }}>
                <svg className="at-knob" viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
                  <path d="M1.5 0h9A1.5 1.5 0 0 1 12 1.5V13L6 20 0 13V1.5A1.5 1.5 0 0 1 1.5 0z" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="audio-view" ref={(el) => setRoot(el)}>
        {notes && <OpenNote root={root} notes={notes} list={recordingNotes} watch={`${view.left}:${full}`} />}
        <div className="at-box">
          <ZoomRuler
            ctl={ctl}
            longest={longest}
            view={view}
            onScroll={(left) => {
              const sc = scroller.current;
              if (sc) sc.scrollLeft = left * sc.scrollWidth;
            }}
            onZoom={(zoom, left) => {
              pending.current = left;
              ctl.setZoom(zoom);
            }}
          />
          <div className="at-scroll" id="audio-tracks" ref={scroller} onScroll={readView}>
            <div className="at-inner" ref={box}>
              <div className="at-offset">
                <Ruler longest={longest} width={full} />
              </div>
              {trackRow('a')}
              <svg className="at-bands" width={full} height={BAND_H} aria-hidden="true" style={{ marginLeft: HEAD_W }}>
                {differences.map((d, i) => (
                  <polygon
                    key={i}
                    className={`at-band ${d.kind}`}
                    data-on={i === current || undefined}
                    points={`${x(d.aStart)},0 ${x(Math.max(d.aEnd, d.aStart))},0 ${x(Math.max(d.bEnd, d.bStart))},${BAND_H} ${x(d.bStart)},${BAND_H}`}
                  />
                ))}
              </svg>
              {trackRow('b')}
            </div>
            {!sides && <p className="ic-loading">Decoding the recordings…</p>}
            {ctl.busy && <p className="at-busy">Lining the recordings up…</p>}
          </div>
        </div>

        <PlaybackBar ctl={ctl} />
      </div>
      <TranscriptCompare ctl={ctl} bands={bands} />
    </>
  );
}

/**
 * The whole recordings in one strip, their differences marked and the
 * playhead shown, with a frame over the part in view. Dragging the frame
 * scrolls; dragging either of its ends zooms (the other end stays put);
 * pressing elsewhere brings that part into view; a double click shows it all.
 */
function ZoomRuler({
  ctl,
  longest,
  view,
  onScroll,
  onZoom,
}: {
  ctl: AudioCompare;
  longest: number;
  view: { left: number; size: number };
  onScroll(left: number): void;
  onZoom(zoom: number, left: number): void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    what: 'move' | 'l' | 'r';
    grab: number;
    left: number;
    right: number;
  } | null>(null);
  const [dragging, setDragging] = useState<'move' | 'l' | 'r' | null>(null);
  const at = (e: ReactPointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const min = 1 / MAX_ZOOM;
  const zoomTo = (left: number, right: number) => onZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, 1 / (right - left))), left);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !longest) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    const edge = (e.target as HTMLElement).dataset.edge as 'l' | 'r' | undefined;
    let left = view.left;
    // Pressed away from the frame: that part comes into view, and the drag goes on from there.
    if (!edge && (p < view.left || p > view.left + view.size)) {
      left = Math.min(1 - view.size, Math.max(0, p - view.size / 2));
      onScroll(left);
    }
    drag.current = {
      what: edge ?? 'move',
      grab: p - left,
      left,
      right: left + view.size,
    };
    setDragging(drag.current.what);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (d.what === 'move') onScroll(Math.min(1 - (d.right - d.left), Math.max(0, p - d.grab)));
    else if (d.what === 'l') zoomTo(Math.min(p, d.right - min), d.right);
    else zoomTo(d.left, Math.max(p, d.left + min));
  };
  const onUp = () => {
    drag.current = null;
    setDragging(null);
  };

  const heard = ctl.heard;
  const pos = longest ? ctl.timeOf(heard) / longest : 0;
  return (
    <div
      className={`at-zoom${dragging ? ` dragging ${dragging}` : ''}`}
      ref={el}
      role="scrollbar"
      aria-label="The part of the recordings in view: drag to scroll, drag an end to zoom"
      aria-controls="audio-tracks"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view.left * 100)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => onZoom(MIN_ZOOM, 0)}
    >
      <div className="az-track" aria-hidden="true">
        {longest > 0 &&
          ctl.differences.map((d, i) => {
            const [s, e] = heard === 'a' && d.kind !== 'added' ? [d.aStart, d.aEnd] : [d.bStart, d.bEnd];
            return (
              <span
                key={i}
                className={`az-mark ${d.kind}`}
                data-on={i === ctl.current || undefined}
                style={{
                  left: `${(s / longest) * 100}%`,
                  width: `max(2px, ${((e - s) / longest) * 100}%)`,
                }}
              />
            );
          })}
        <span className="az-head" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="az-view" data-full={view.size >= 0.999 || undefined} style={{ left: `${view.left * 100}%`, width: `${view.size * 100}%` }}>
        <span className="az-edge" data-edge="l" />
        <span className="az-edge" data-edge="r" />
      </div>
    </div>
  );
}

/** Seconds along the top, at a spacing that reads well at the zoom. */
function Ruler({ longest, width }: { longest: number; width: number }) {
  if (!longest || !width) return <div className="at-ruler" />;
  const pps = width / longest;
  const every = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 70) ?? 1200;
  const ticks: number[] = [];
  for (let t = 0; t <= longest; t += every) ticks.push(t);
  return (
    <div className="at-ruler" style={{ width }} aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} style={{ left: t * pps }}>
          {clock(t)}
          {every < 1 && t % 1 ? `.${Math.round((t % 1) * 10)}` : ''}
        </span>
      ))}
    </div>
  );
}

/** The card of the note open, under its stretch of the track (placed from where the stretch is drawn). */
function OpenNote({ root, notes, list, watch }: { root: HTMLElement | null; notes: MediaNotesApi; list: readonly MediaNote[]; watch: string }) {
  const i = list.findIndex((n) => n.id === notes.open);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = i >= 0 ? root?.querySelector<HTMLElement>(`.at-note[data-note="${list[i]!.id}"]`) : null;
    if (!root || !el) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left - box.left), Math.max(0, box.width - 290));
    const next = { left, top: r.bottom - box.top + 8 };
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  }, [root, i, list, watch]);
  if (i < 0 || !pos) return null;
  return <NoteEditor key={list[i]!.id} note={list[i]!} number={i + 1} api={notes} style={pos} />;
}
