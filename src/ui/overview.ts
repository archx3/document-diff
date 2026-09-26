import type { GridView, Layout } from './grid';

export interface OverviewEvents {
  /** A change's mark was clicked. */
  go(hunk: number): void;
  /** The reader scrolled the documents from the overview. */
  scrolled(): void;
}

/** Pointer travel (px) before a press on a mark becomes a drag. */
const DRAG_SLOP = 3;

/**
 * The overview on the gutter between the two columns: a ruler with a mark for
 * every change, a minimap of each document on either side of it (optional),
 * and a frame over the part of the documents that is on screen. The whole
 * height of the documents maps onto the height of the overview. Dragging the
 * frame scrolls the documents; pressing anywhere else brings that part into
 * view and keeps dragging from there.
 */
export class Overview {
  private readonly ruler: HTMLElement;
  private readonly view: HTMLElement;
  private readonly maps: Record<'a' | 'b', HTMLCanvasElement>;
  private marksKey = '';
  private mapsKey = '';
  private current = -1;
  private minimap = false;
  private drag: { id: number; startY: number; grab: number; hunk: number; moved: boolean } | null = null;

  constructor(
    readonly el: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly grid: GridView,
    private readonly events: OverviewEvents,
    signal: AbortSignal,
  ) {
    this.ruler = el.querySelector('.ruler')!;
    this.view = el.querySelector('.ruler-view')!;
    this.maps = { a: el.querySelector('.mm.a')!, b: el.querySelector('.mm.b')! };
    el.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    el.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    el.addEventListener('pointerup', (e) => this.onUp(e, true), { signal });
    el.addEventListener('pointercancel', (e) => this.onUp(e, false), { signal });
    el.addEventListener('lostpointercapture', (e) => this.onUp(e, false), { signal });
  }

  setMinimap(on: boolean): void {
    this.minimap = on;
    this.mapsKey = '';
  }

  /** Redraws everything on the next draw (the documents, theme or colours changed). */
  invalidate(): void {
    this.marksKey = '';
    this.mapsKey = '';
  }

  setCurrent(hunk: number): void {
    this.current = hunk;
    for (const m of Array.from(this.ruler.querySelectorAll('.mark.cur'))) m.classList.remove('cur');
    this.ruler.querySelector(`.mark[data-hunk="${hunk}"]`)?.classList.add('cur');
  }

  /** Centres the overview on the gutter column, below the column heads. */
  place(gutter: Element | null, top: number): void {
    const stage = this.el.parentElement;
    if (!gutter || !stage) return;
    const g = gutter.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    this.el.style.left = `${Math.round(g.left + g.width / 2 - s.left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  /** Brings the frame, marks and minimaps up to date. Cheap when only the scroll position changed. */
  draw(): void {
    const height = this.el.clientHeight;
    if (this.el.hidden || !height) return;
    const sc = this.scroller;
    const total = sc.scrollHeight || 1;
    this.view.style.top = `${(sc.scrollTop / total) * 100}%`;
    this.view.style.height = `${Math.min(1, sc.clientHeight / total) * 100}%`;
    const layout = this.grid.layout();
    if (layout.key !== this.marksKey) {
      this.marksKey = layout.key;
      this.drawMarks(layout);
    }
    if (!this.minimap) return;
    const key = `${layout.key}:${height}:${window.devicePixelRatio || 1}`;
    if (key === this.mapsKey) return;
    this.mapsKey = key;
    const css = getComputedStyle(this.el);
    for (const side of ['a', 'b'] as const) this.drawMap(this.maps[side], layout, side, css);
  }

  private drawMarks(layout: Layout): void {
    const frag = document.createDocumentFragment();
    for (const h of layout.hunks) {
      const m = document.createElement('div');
      m.className = `mark m-${h.kind}${h.hunk === this.current ? ' cur' : ''}`;
      m.style.top = `${(h.top / layout.total) * 100}%`;
      m.style.height = `max(3px, ${((h.bottom - h.top) / layout.total) * 100}%)`;
      m.dataset.hunk = String(h.hunk);
      frag.appendChild(m);
    }
    this.ruler.replaceChildren(frag);
  }

  /**
   * One document in miniature: each paragraph as lines of its text, unchanged
   * text faint, text that differs in the side's colour (full strength where the
   * whole paragraph is only on this side).
   */
  private drawMap(canvas: HTMLCanvasElement, layout: Layout, side: 'a' | 'b', css: CSSStyleDeclaration): void {
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

  /* ------------------------------------------------------------ dragging */

  /** The frame's position and the pointer's, in px from the top of the overview. */
  private metrics(clientY: number): { y: number; height: number; top: number; size: number } {
    const r = this.el.getBoundingClientRect();
    const sc = this.scroller;
    const total = sc.scrollHeight || 1;
    return { y: clientY - r.top, height: r.height, top: (sc.scrollTop / total) * r.height, size: Math.min(1, sc.clientHeight / total) * r.height };
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0 || !e.isPrimary) return;
    const m = this.metrics(e.clientY);
    if (!m.height) return;
    const inView = m.y >= m.top && m.y <= m.top + m.size;
    const mark = (e.target as Element).closest<HTMLElement>('.mark');
    this.drag = { id: e.pointerId, startY: m.y, grab: inView ? m.y - m.top : m.size / 2, hunk: mark ? Number(mark.dataset.hunk) : -1, moved: false };
    this.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    // Pressing the track away from the frame brings that part into view straight away.
    if (!inView && !mark) {
      this.drag.moved = true;
      this.el.classList.add('dragging');
      this.scrollTo(m.y - this.drag.grab, m.height);
    }
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    const m = this.metrics(e.clientY);
    if (!d) {
      this.el.classList.toggle('over-view', m.y >= m.top && m.y <= m.top + m.size);
      return;
    }
    if (e.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.abs(m.y - d.startY) < DRAG_SLOP) return;
      d.moved = true;
      this.el.classList.add('dragging');
    }
    this.scrollTo(m.y - d.grab, m.height);
  }

  private onUp(e: PointerEvent, click: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.el.classList.remove('dragging');
    if (click && !d.moved && d.hunk >= 0) this.events.go(d.hunk);
  }

  /** Scrolls so the frame's top is at `y` px down the overview. */
  private scrollTo(y: number, height: number): void {
    const sc = this.scroller;
    sc.scrollTop = (y / height) * sc.scrollHeight;
    this.events.scrolled();
  }
}
