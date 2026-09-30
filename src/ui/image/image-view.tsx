/**
 * Two pictures on the stage, as the image tools say: side by side (zoom and
 * pan in step), swiped, one over the other, or their difference, with the
 * changed areas outlined. Dragging pans; Ctrl/⌘ + wheel zooms around the
 * pointer; the wheel alone pans. Swiping and onion skin have their slider
 * under the view; the swipe's handle can be dragged too. With notes on,
 * dragging draws an area to write a note on (a click, a point).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Slider } from '../../components/ui/slider';
import type { MediaNote } from '../../review/media-notes';
import { newMediaNote, notesOf } from '../../review/media-notes';
import type { MediaNotesApi } from '../media-notes-ui';
import { NoteEditor } from '../media-notes-ui';
import type { Side } from '../util';
import type { ImageCompare } from './use-image-compare';
import { panesOf } from './use-image-compare';

/** The pane's padding (see .ic-pane), which the stage sits inside. */
const PANE_PAD = 8;

/** The widest the note card is (see .mn-editor), to keep it inside its pane. */
const EDITOR_W = 280;

export function ImageView({ ctl, notes }: { ctl: ImageCompare; notes?: MediaNotesApi }) {
  const view = useRef<HTMLDivElement>(null);
  const { loaded, sides, mode, scale, offset, boxes, area } = ctl;
  const drawing = !!notes && ctl.annotate;
  /** The area being drawn, in fractions of the picture, and the pane (side) it is drawn on. */
  const [draft, setDraft] = useState<{ side: Side; x0: number; y0: number; x1: number; y1: number } | null>(null);

  // The view tells the comparison its size, to fit the pictures to it.
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const measure = () => ctl.setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // setViewport is a state setter: it stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** Where the pointer is on the picture in a pane, in fractions of it. */
  const pointIn = (pane: Element, e: { clientX: number; clientY: number }) => {
    const r = pane.getBoundingClientRect();
    const W = (loaded?.width ?? 1) * scale;
    const H = (loaded?.height ?? 1) * scale;
    return { x: (e.clientX - r.left - PANE_PAD - offset.x) / W, y: (e.clientY - r.top - PANE_PAD - offset.y) / H };
  };
  const drawPane = useRef<Element | null>(null);

  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('.ic-handle, .mn-box, .mn-editor')) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const pane = (e.target as Element).closest<HTMLElement>('.ic-pane');
    if (drawing && pane && loaded) {
      const p = pointIn(pane, e);
      drawPane.current = pane;
      setDraft({ side: (pane.dataset.side as Side) ?? ctl.top, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, px: offset.x, py: offset.y };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (draft && drawPane.current) {
      const p = pointIn(drawPane.current, e);
      setDraft({ ...draft, x1: p.x, y1: p.y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (ctl.zoom === 'fit') ctl.setZoom(scale);
    ctl.setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onUp = () => {
    drag.current = null;
    if (draft && notes) {
      // A click (a few pixels at most) marks a point; a drag, an area.
      const tiny = Math.abs(draft.x1 - draft.x0) * (loaded?.width ?? 0) * scale < 5 && Math.abs(draft.y1 - draft.y0) * (loaded?.height ?? 0) * scale < 5;
      const n = newMediaNote(
        draft.side,
        tiny ? { type: 'box', x: draft.x0, y: draft.y0, w: 0, h: 0 } : { type: 'box', x: draft.x0, y: draft.y0, w: draft.x1 - draft.x0, h: draft.y1 - draft.y0 },
        notes.author,
      );
      if (n.at.type === 'box' && n.at.x + n.at.w > 0 && n.at.x < 1 && n.at.y + n.at.h > 0 && n.at.y < 1) {
        notes.add(n);
        notes.setOpen(n.id);
      }
    }
    setDraft(null);
    drawPane.current = null;
  };

  // The swipe's handle: dragging it moves the divide (the pictures stay put).
  const swiping = useRef(false);
  const swipeTo = (e: ReactPointerEvent) => {
    const pane = (e.currentTarget as Element).closest('.ic-pane');
    const w = (loaded?.width ?? 0) * scale;
    if (!pane || !w) return;
    const x = e.clientX - pane.getBoundingClientRect().left - PANE_PAD - offset.x;
    ctl.setSwipe(Math.round(Math.min(100, Math.max(0, (x / w) * 100)) * 10) / 10);
  };
  const handle = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      swiping.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent) => swiping.current && swipeTo(e),
    onPointerUp: () => {
      swiping.current = false;
    },
    onPointerCancel: () => {
      swiping.current = false;
    },
  };
  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Around the pointer, in the pane it is over (side by side, each pane has its own picture).
        const pane = (e.target as Element).closest('.ic-pane') ?? el;
        const r = pane.getBoundingClientRect();
        const next = Math.min(Math.max(scale * Math.exp(-e.deltaY / 300), 0.05), 16);
        const p = { x: e.clientX - r.left - PANE_PAD, y: e.clientY - r.top - PANE_PAD };
        ctl.setPan({ x: p.x - ((p.x - offset.x) * next) / scale, y: p.y - ((p.y - offset.y) * next) / scale });
        ctl.setZoom(next);
      } else {
        if (ctl.zoom === 'fit') ctl.setZoom(scale);
        ctl.setPan({ x: offset.x - e.deltaX, y: offset.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [ctl, scale, offset]);

  if (ctl.error) return <p className="ic-error">{ctl.error}</p>;
  if (!sides) return null;
  const { a, b } = sides;
  // Which picture is on top (swipe, onion skin) and which under it.
  const [over, under] = ctl.top === 'b' ? [b, a] : [a, b];
  const [O, U] = ctl.top === 'b' ? ['B', 'A'] : ['A', 'B'];
  const w = loaded?.width ?? 0;
  const h = loaded?.height ?? 0;
  const ordered = [...boxes].sort((p, q) => p.y - q.y || p.x - q.x);
  const pictureNotes = notes ? notesOf(notes.list, 'box') : [];
  const paneW = ctl.viewport.w / panesOf(mode);
  /** A pane's notes: side by side, each picture's own; otherwise all of them. */
  const notesIn = (side: Side | null) => pictureNotes.map((n, i) => ({ n, i })).filter(({ n }) => !side || n.side === side);
  const editorFor = (side: Side | null) => {
    const open = notes?.open ? notesIn(side).find(({ n }) => n.id === notes.open) : undefined;
    if (!open || open.n.at.type !== 'box' || !notes) return null;
    const at = open.n.at;
    const W = w * scale;
    const H = h * scale;
    let left = PANE_PAD + offset.x + (at.x + at.w) * W + 10;
    if (left + EDITOR_W > paneW - 8) left = Math.max(8, PANE_PAD + offset.x + at.x * W - EDITOR_W - 10);
    const top = Math.min(Math.max(8, PANE_PAD + offset.y + at.y * H), Math.max(8, ctl.viewport.h - 200));
    return <NoteEditor key={open.n.id} note={open.n} number={open.i + 1} api={notes} style={{ left, top }} />;
  };
  const noteMarks = (side: Side | null) =>
    notes && (
      <div className="mn-layer" data-annotating={drawing || undefined}>
        {notesIn(side).map(({ n, i }) => (n.at.type === 'box' ? <NoteBox key={n.id} n={n} number={i + 1} open={notes.open === n.id} onOpen={() => notes.setOpen(n.id)} /> : null))}
        {draft && (!side || draft.side === side) && (
          <span
            className="mn-draft"
            style={{
              left: `${Math.min(draft.x0, draft.x1) * 100}%`,
              top: `${Math.min(draft.y0, draft.y1) * 100}%`,
              width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
              height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
            }}
          />
        )}
      </div>
    );
  const stage = (children: ReactNode, label: string, key: string, over?: ReactNode, side: Side | null = null) => (
    <div className="ic-pane" key={key} data-side={side ?? ctl.top}>
      <span className="ic-pane-label">{label}</span>
      {over}
      {editorFor(side)}
      {/* Drawn at the zoomed size rather than scaled: a scaled layer is painted in tiles, and parts of it can be missing while it moves. */}
      <div className="ic-stage" style={{ width: w * scale, height: h * scale, transform: `translate(${offset.x}px, ${offset.y}px)` } as CSSProperties}>
        {children}
        {ctl.outline && boxes.length > 0 && (
          <svg className="ic-boxes" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            {ordered.map((bx, i) => (
              <rect key={i} data-on={i === area || undefined} x={bx.x - 2} y={bx.y - 2} width={bx.width + 4} height={bx.height + 4} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        {noteMarks(side)}
      </div>
    </div>
  );
  const sizes = loaded && (loaded.a.naturalWidth !== loaded.b.naturalWidth || loaded.a.naturalHeight !== loaded.b.naturalHeight);
  return (
    <div className="image-view" data-mode={mode}>
      {sizes && (
        <p className="ic-note">
          The pictures are different sizes ({loaded!.a.naturalWidth}×{loaded!.a.naturalHeight} and {loaded!.b.naturalWidth}×{loaded!.b.naturalHeight}): B is compared at A’s size.
        </p>
      )}
      <div className={`ic-view panes-${panesOf(mode)}`} data-annotating={drawing || undefined} ref={view} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {!loaded ? (
          <p className="ic-loading">Loading the pictures…</p>
        ) : mode === 'side' ? (
          <>
            {stage(<img src={a.src} alt={`A: ${a.name}`} draggable={false} />, `A · ${a.name}`, 'a', undefined, 'a')}
            {stage(<img src={b.src} alt={`B: ${b.name}`} draggable={false} />, `B · ${b.name}`, 'b', undefined, 'b')}
          </>
        ) : mode === 'swipe' ? (
          stage(
            <>
              <img src={under.src} alt={`${U}: ${under.name}`} draggable={false} />
              <img src={over.src} alt={`${O}: ${over.name}`} className="ic-top" style={{ clipPath: `inset(0 0 0 ${ctl.swipe}%)` }} draggable={false} />
            </>,
            `${U} · ${under.name}  |  ${O} · ${over.name}`,
            'swipe',
            // The handle is drawn at the view's scale, outside the picture, so it stays easy to grab.
            <span
              className="ic-handle"
              aria-hidden="true"
              style={{ left: PANE_PAD + offset.x + (w * scale * ctl.swipe) / 100, top: PANE_PAD + Math.max(0, offset.y), height: Math.max(0, h * scale + Math.min(0, offset.y)) }}
              {...handle}
            />,
          )
        ) : mode === 'onion' ? (
          stage(
            <>
              <img src={under.src} alt={`${U}: ${under.name}`} draggable={false} />
              <img src={over.src} alt={`${O}: ${over.name}`} className="ic-top" style={{ opacity: ctl.opacity / 100 }} draggable={false} />
            </>,
            `${O} over ${U}, ${ctl.opacity}%`,
            'onion',
          )
        ) : (
          stage(<img src={ctl.diffUrl} alt="The pixels that differ, in red" draggable={false} />, `Changed pixels in red, on ${O}`, 'diff')
        )}
      </div>
      {(mode === 'swipe' || mode === 'onion') && (
        <div className="ic-slide">
          <span className="ic-slide-end" data-side={U.toLowerCase()}>
            {U}
          </span>
          {mode === 'swipe' ? (
            <Slider label={`Swipe between ${U} and ${O}`} data-control="swipe" value={ctl.swipe} onChange={ctl.setSwipe} step={5} labelStep={25} fine format={(v) => `${v}%`} />
          ) : (
            <Slider label={`How much of ${O} shows over ${U}`} data-control="opacity" value={ctl.opacity} onChange={ctl.setOpacity} step={5} labelStep={25} fine format={(v) => `${v}%`} />
          )}
          <span className="ic-slide-end" data-side={O.toLowerCase()}>
            {O}
          </span>
        </div>
      )}
    </div>
  );
}

/** A note on a picture: its area (or its point) outlined in its colour, and its number, which opens it. */
function NoteBox({ n, number, open, onOpen }: { n: MediaNote; number: number; open: boolean; onOpen(): void }) {
  if (n.at.type !== 'box') return null;
  const point = n.at.w === 0 && n.at.h === 0;
  return (
    <button
      type="button"
      className={`mn-box hl-${n.color}${point ? ' point' : ''}`}
      data-note={n.id}
      data-open={open || undefined}
      aria-label={`Note ${number}${n.text ? `: ${n.text}` : ''}`}
      data-tip={n.text || undefined}
      style={{ left: `${n.at.x * 100}%`, top: `${n.at.y * 100}%`, width: `${n.at.w * 100}%`, height: `${n.at.h * 100}%` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onOpen}
    >
      <span className={`mn-num hl-${n.color}`}>{number}</span>
    </button>
  );
}
