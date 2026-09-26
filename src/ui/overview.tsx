import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { GridLayout, HunkBox, Layout } from './layout';

interface OverviewProps {
  layout: GridLayout;
  scroller: RefObject<HTMLElement | null>;
  current: number;
  minimap: boolean;
  /** Changes with the theme and the contrast, whose colours the minimaps are drawn in. */
  palette: string;
  /** A change's mark was clicked. */
  onGo(hunk: number): void;
  /** The reader scrolled the documents from the overview. */
  onScrolled(): void;
}

/** Pointer travel (px) before a press on a mark becomes a drag. */
const DRAG_SLOP = 3;

/**
 * The overview on the gutter between the two columns: a ruler with a mark for
 * every change, a minimap of each document on either side of it (optional),
 * and a frame over the part of the documents that is on screen. The whole
 * height of the documents maps onto the height of the overview. Dragging the
 * frame scrolls the documents; pressing anywhere else brings that part into
 * view and keeps dragging from there. The frame and the minimaps follow every
 * scroll, so they are drawn directly rather than rendered.
 */
export function Overview({ layout, scroller, current, minimap, palette, onGo, onScrolled }: OverviewProps) {
  const el = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const maps = { a: useRef<HTMLCanvasElement>(null), b: useRef<HTMLCanvasElement>(null) };
  const [marks, setMarks] = useState<{ key: string; total: number; hunks: HunkBox[] }>({ key: '', total: 1, hunks: [] });
  const [dragging, setDragging] = useState(false);
  const [overView, setOverView] = useState(false);
  const drawn = useRef({ marks: '', maps: '', place: '' });
  const drag = useRef<{ id: number; startY: number; grab: number; hunk: number; moved: boolean } | null>(null);

  // Everything that follows the scroll position, the rows' layout or the stage's size.
  const draw = () => {
    const box = el.current;
    const sc = scroller.current;
    if (!box || !sc) return;
    place(box, sc, drawn.current);
    const height = box.clientHeight;
    if (!height) return;
    const total = sc.scrollHeight || 1;
    view.current!.style.top = `${(sc.scrollTop / total) * 100}%`;
    view.current!.style.height = `${Math.min(1, sc.clientHeight / total) * 100}%`;
    const L = layout.measure();
    if (!L) return;
    if (L.key !== drawn.current.marks) {
      drawn.current.marks = L.key;
      setMarks({ key: L.key, total: L.total, hunks: L.hunks });
    }
    if (!minimap) return;
    const key = `${L.key}:${height}:${window.devicePixelRatio || 1}:${palette}`;
    if (key === drawn.current.maps) return;
    drawn.current.maps = key;
    const css = getComputedStyle(box);
    for (const side of ['a', 'b'] as const) {
      const canvas = maps[side].current;
      if (canvas) drawMap(canvas, L, side, css);
    }
  };
  // After every render, as the rows may have changed (the grid renders first). Scrolling and
  // resizing draw from here too.
  const latestDraw = useRef(draw);
  useLayoutEffect(() => {
    latestDraw.current = draw;
    draw();
  });

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          latestDraw.current();
        });
    };
    sc.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The overview follows the gutter when the columns or their heads change size.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(sc);
    const heads = sc.querySelector('.colheads');
    if (heads) ro?.observe(heads);
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [scroller]);

  /* ------------------------------------------------------------ dragging */

  /** The frame's position and the pointer's, in px from the top of the overview. */
  const metrics = (clientY: number) => {
    const r = el.current!.getBoundingClientRect();
    const sc = scroller.current!;
    const total = sc.scrollHeight || 1;
    return { y: clientY - r.top, height: r.height, top: (sc.scrollTop / total) * r.height, size: Math.min(1, sc.clientHeight / total) * r.height };
  };

  /** Scrolls so the frame's top is at `y` px down the overview. */
  const scrollTo = (y: number, height: number) => {
    const sc = scroller.current!;
    sc.scrollTop = (y / height) * sc.scrollHeight;
    onScrolled();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary || !scroller.current) return;
    const m = metrics(e.clientY);
    if (!m.height) return;
    const inView = m.y >= m.top && m.y <= m.top + m.size;
    const mark = (e.target as Element).closest<HTMLElement>('.mark');
    drag.current = { id: e.pointerId, startY: m.y, grab: inView ? m.y - m.top : m.size / 2, hunk: mark ? Number(mark.dataset.hunk) : -1, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Pressing the track away from the frame brings that part into view straight away.
    if (!inView && !mark) {
      drag.current.moved = true;
      setDragging(true);
      scrollTo(m.y - drag.current.grab, m.height);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!scroller.current) return;
    const d = drag.current;
    const m = metrics(e.clientY);
    if (!d) {
      const over = m.y >= m.top && m.y <= m.top + m.size;
      if (over !== overView) setOverView(over);
      return;
    }
    if (e.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.abs(m.y - d.startY) < DRAG_SLOP) return;
      d.moved = true;
      setDragging(true);
    }
    scrollTo(m.y - d.grab, m.height);
  };

  const end = (click: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    if (click && !d.moved && d.hunk >= 0) onGo(d.hunk);
  };

  return (
    <div
      className={`overview${dragging ? ' dragging' : ''}${overView ? ' over-view' : ''}`}
      id="overview"
      aria-hidden="true"
      ref={el}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end(true)}
      onPointerCancel={end(false)}
      onLostPointerCapture={end(false)}
      onPointerLeave={() => overView && setOverView(false)}
    >
      <canvas className="mm a" ref={maps.a} />
      <div className="ruler">
        {marks.hunks.map((h) => (
          <Mark key={h.hunk} box={h} total={marks.total} cur={h.hunk === current} />
        ))}
      </div>
      <canvas className="mm b" ref={maps.b} />
      <div className="ruler-view" ref={view} />
    </div>
  );
}

const Mark = memo(function Mark({ box, total, cur }: { box: HunkBox; total: number; cur: boolean }) {
  return (
    <div
      className={`mark m-${box.kind}${cur ? ' cur' : ''}`}
      data-hunk={box.hunk}
      style={{ top: `${(box.top / total) * 100}%`, height: `max(3px, ${((box.bottom - box.top) / total) * 100}%)` }}
    />
  );
});

/** Centres the overview on the gutter column, below the column heads. */
function place(box: HTMLElement, sc: HTMLElement, drawn: { place: string }): void {
  const stage = box.parentElement;
  const gutter = sc.querySelector('.colhead.gut');
  const heads = sc.querySelector<HTMLElement>('.colheads');
  if (!stage || !gutter || !heads) return;
  const g = gutter.getBoundingClientRect();
  const left = Math.round(g.left + g.width / 2 - stage.getBoundingClientRect().left);
  const top = heads.offsetHeight + 6;
  const key = `${left}:${top}`;
  if (key === drawn.place) return;
  drawn.place = key;
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}

/**
 * One document in miniature: each paragraph as lines of its text, unchanged
 * text faint, text that differs in the side's colour (full strength where the
 * whole paragraph is only on this side).
 */
function drawMap(canvas: HTMLCanvasElement, layout: Layout, side: 'a' | 'b', css: CSSStyleDeclaration): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const color = (name: string) => css.getPropertyValue(name).trim() || '#888';
  const ink = color('--ink');
  const strong = color(side === 'a' ? '--a' : '--b');
  const scale = h / (layout.total || 1);
  const lineH = layout.line[side];
  const chars = layout.chars[side];
  const pad = 3;
  const full = w - pad * 2;
  // Separate lines while they are far enough apart to tell apart; solid blocks below that.
  const step = lineH * scale;
  const lines = step >= 2.5;
  const bar = Math.max(1, Math.min(step - 1, step * 0.55));

  for (const r of layout.rows) {
    const len = side === 'a' ? r.a : r.b;
    if (len <= 0) continue;
    const kind = r.kind.replace(/^t(?=mod|del|ins|eq)/, '');
    const only = kind === (side === 'a' ? 'del' : 'ins');
    ctx.fillStyle = kind === 'mod' || only ? strong : ink;
    ctx.globalAlpha = only ? 0.9 : kind === 'mod' ? 0.5 : 0.17;
    const y = r.top * scale;
    const rh = r.height * scale;
    if (!lines) {
      ctx.fillRect(pad, y, full, Math.max(1, rh - Math.min(1, rh * 0.25)));
      continue;
    }
    // Rows have a little padding above and below their text.
    const n = Math.max(1, Math.round((r.height - 10) / lineH));
    const inset = Math.max(0, (r.height - n * lineH) / 2) * scale;
    for (let i = 0; i < n; i++) {
      let frac = 1;
      if (i === n - 1) frac = Math.min(1, Math.max(0.15, (len - (n - 1) * chars) / chars));
      ctx.fillRect(pad, y + inset + i * step + (step - bar) / 2, Math.max(2, full * frac), bar);
    }
  }
  ctx.globalAlpha = 1;
}
