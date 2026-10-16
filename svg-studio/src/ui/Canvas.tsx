import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editableIds, findNode, selectableIn } from '../core/doc';
import { clamp, type Pt } from '../core/geometry';
import { insertNode, nearestOnSubPaths, setNodeType, toSubPaths } from '../core/nodes';
import { hitTest } from '../core/pick';
import { geomToSegs } from '../core/shapes';
import { enterGroup, geomFromSubPaths, nodeTargetId, setGeometry, setSelection, setTool, updateSettings } from '../state/actions';
import {
  pickTolerance,
  startGesture,
  track,
  untrack,
  type Gesture,
  type GestureContext,
  type Ptr,
  type View,
} from '../state/gestures';
import { store, useEditor, type ToolId } from '../state/store';
import { Artwork } from './Artwork';
import { Grid, Keylines } from './Guides';
import { Icon } from './icons';
import { Outlines, Overlay, ROTATE_CURSOR } from './Overlay';

const ZOOM_MIN = 2;
const ZOOM_MAX = 240;

const TOOL_CURSOR: Record<ToolId, string> = {
  select: 'default',
  node: 'default',
  pen: 'crosshair',
  line: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  scale: 'crosshair',
  scaleH: 'ew-resize',
  scaleV: 'ns-resize',
  rotate: ROTATE_CURSOR,
  hand: 'grab',
};

function fitView(w: number, h: number, docW: number, docH: number): View {
  // Room above for the hint and below for the view bar.
  const top = 56;
  const bottom = 84;
  const side = 56;
  const zoom = clamp(Math.min((w - side * 2) / docW, (h - top - bottom) / docH), ZOOM_MIN, ZOOM_MAX);
  return { zoom, x: (w - docW * zoom) / 2, y: top + (h - top - bottom - docH * zoom) / 2 };
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Canvas() {
  const s = useEditor((st) => st);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState<View>({ zoom: 10, x: 0, y: 0 });
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const gesture = useRef<Gesture | null>(null);
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const fittedFor = useRef('');
  // The view follows the canvas's size (fitting the icon) until the person pans or zooms it themselves.
  const autoFit = useRef(true);

  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  /** A view the person chose: it is kept as it is when the canvas changes size. */
  const setView = useCallback(
    (v: View) => {
      autoFit.current = false;
      applyView(v);
    },
    [applyView],
  );
  const ctx = useMemo<GestureContext>(() => ({ view: () => viewRef.current, setView }), [setView]);

  /* Size, and fitting the document in view. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const prev = sizeRef.current;
      sizeRef.current = { w: r.width, h: r.height };
      setSize(sizeRef.current);
      if (!fittedFor.current || !prev.w) return;
      const doc = store.get().doc;
      if (autoFit.current) applyView(fitView(r.width, r.height, doc.width, doc.height));
      // Otherwise keep what was at the centre at the centre.
      else applyView({ ...viewRef.current, x: viewRef.current.x + (r.width - prev.w) / 2, y: viewRef.current.y + (r.height - prev.h) / 2 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyView]);

  const docKey = `${s.doc.width}x${s.doc.height}`;
  useEffect(() => {
    if (size.w > 0 && fittedFor.current !== docKey) {
      fittedFor.current = docKey;
      autoFit.current = true;
      applyView(fitView(size.w, size.h, s.doc.width, s.doc.height));
    }
  }, [size.w, size.h, docKey, s.doc.width, s.doc.height, applyView]);

  const fit = useCallback(() => {
    autoFit.current = true;
    applyView(fitView(sizeRef.current.w, sizeRef.current.h, store.get().doc.width, store.get().doc.height));
  }, [applyView]);

  const zoomTo = useCallback(
    (zoom: number, at?: Pt) => {
      const v = viewRef.current;
      const sz = sizeRef.current;
      const c = at ?? { x: sz.w / 2, y: sz.h / 2 };
      const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      const k = z / v.zoom;
      setView({ zoom: z, x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k });
    },
    [setView],
  );

  /* Wheel: scroll pans, pinch or Ctrl/⌘ + wheel zooms. Not passive, so the page itself stays put. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0125));
        zoomTo(viewRef.current.zoom * factor, at);
      } else {
        const v = viewRef.current;
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView, zoomTo]);

  /* Keys that belong to the viewport: Space to pan, + − and Shift+1 to zoom. */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.backdrop')) return;
      if (e.code === 'Space') {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setPanning(true);
        }
        e.preventDefault();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === '+' || e.key === '=' || (mod && e.key === '=')) {
        e.preventDefault();
        zoomTo(viewRef.current.zoom * 1.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomTo(viewRef.current.zoom / 1.25);
      } else if (e.code === 'Digit1' && e.shiftKey) {
        e.preventDefault();
        fit();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setPanning(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [fit, zoomTo]);

  /* Pointer events → gestures. */
  const makePtr = (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Ptr => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return { doc: { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom }, screen: { x: sx, y: sy }, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    // The inspector and bars live outside this element, but the view bar floats inside it.
    if ((e.target as Element).closest('.viewbar')) return;
    e.preventDefault();
    ref.current?.focus({ preventScroll: true });
    ref.current?.setPointerCapture(e.pointerId);
    const hit = (e.target as Element).closest?.('[data-hit]')?.getAttribute('data-hit') ?? null;
    const tool: ToolId = e.button === 1 || spaceRef.current ? 'hand' : store.get().tool;
    if (tool === 'hand') setPanning(true);
    gesture.current = track(startGesture(tool, makePtr(e), hit, ctx));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = makePtr(e);
    if (gesture.current) {
      gesture.current.move(p);
      return;
    }
    const st = store.get();
    if (st.tool === 'pen' && st.pen) {
      const step = st.settings.snapStep;
      const snap = st.settings.snap !== p.mod;
      const q = snap ? { x: Math.round(p.doc.x / step) * step, y: Math.round(p.doc.y / step) * step } : p.doc;
      store.patch({ pen: { ...st.pen, cursor: q } });
    } else if (st.tool === 'select' && !e.buttons) {
      const hit = hitTest(st.doc, p.doc, st.scope, pickTolerance(viewRef.current.zoom), p.mod);
      if (hit !== st.hover) store.patch({ hover: hit });
    }
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    untrack();
    setPanning(spaceRef.current);
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (cancelled) g.cancel();
    else g.up(makePtr(e));
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.viewbar')) return;
    const st = store.get();
    const p = makePtr(e);
    const tol = pickTolerance(viewRef.current.zoom);
    if (st.tool === 'select') {
      const deep = hitTest(st.doc, p.doc, st.scope, tol, true);
      if (!deep) return;
      const top = selectableIn(st.doc, deep, st.scope);
      const node = top ? findNode(st.doc, top) : null;
      if (node?.type === 'group') enterGroup(node.id, [selectableIn(st.doc, deep, node.id)!]);
      else if (node) {
        setSelection([node.id]);
        setTool('node');
      }
    } else if (st.tool === 'node') {
      const id = nodeTargetId();
      const n = id ? findNode(st.doc, id) : null;
      if (!id || !n || n.type !== 'shape') return;
      const subs = toSubPaths(geomToSegs(n.geom));
      // (With the pointer captured, the event's target is the canvas, so find the point by its position.)
      const z = viewRef.current.zoom;
      let hit: { si: number; ni: number; d: number } | null = null;
      subs.forEach((sp, si) =>
        sp.nodes.forEach((nd, ni) => {
          const d = Math.hypot((nd.x - p.doc.x) * z, (nd.y - p.doc.y) * z);
          if (d < 9 && (!hit || d < hit.d)) hit = { si, ni, d };
        }),
      );
      if (hit) {
        // Double-click a point to turn it into a corner or a smooth point.
        const { si, ni } = hit as { si: number; ni: number };
        const nd = subs[si]!.nodes[ni]!;
        setGeometry(id, geomFromSubPaths(setNodeType(subs, { sub: si, idx: ni }, nd.hin || nd.hout ? 'corner' : 'smooth')));
        return;
      }
      const near = nearestOnSubPaths(subs, p.doc);
      if (near && near.dist * viewRef.current.zoom < 10) {
        const r = insertNode(subs, near.sub, near.idx, near.t);
        setGeometry(id, geomFromSubPaths(r.subs));
        store.patch({ nodeSel: [`${r.ref.sub}:${r.ref.idx}`] });
      }
    }
  };

  const cursor = panning || spaceRef.current ? (gesture.current ? 'grabbing' : 'grab') : TOOL_CURSOR[s.tool];

  const selIds = useMemo(() => editableIds(s.doc, s.selection), [s.doc, s.selection]);
  const hoverIds = s.hover && !s.selection.includes(s.hover) && s.tool === 'select' ? [s.hover] : [];

  return (
    <div className={`canvas ${s.settings.outline ? 'wire' : ''} tone-${s.settings.artboard}`} ref={ref} tabIndex={-1} style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => endGesture(e, false)} onPointerCancel={(e) => endGesture(e, true)} onDoubleClick={onDoubleClick} onContextMenu={(e) => e.preventDefault()} data-testid="canvas">
      <svg className="scene" width={size.w} height={size.h}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <rect className="artboard" x={0} y={0} width={s.doc.width} height={s.doc.height} />
          {s.settings.grid && <Grid width={s.doc.width} height={s.doc.height} zoom={view.zoom} />}
          <g className="art" data-testid="artwork">
            <Artwork doc={s.doc} />
          </g>
          {s.settings.keylines && <Keylines width={s.doc.width} height={s.doc.height} />}
          <rect className="artboard-edge" x={0} y={0} width={s.doc.width} height={s.doc.height} fill="none" vectorEffect="non-scaling-stroke" />
          <Outlines s={s} ids={hoverIds} className="outline hover" />
          <Outlines s={s} ids={selIds} className="outline" />
        </g>
      </svg>
      <Overlay s={s} view={view} width={size.w} height={size.h} />
      <ViewBar zoom={view.zoom} onZoomIn={() => zoomTo(view.zoom * 1.25)} onZoomOut={() => zoomTo(view.zoom / 1.25)} onFit={fit} onActual={() => zoomTo(Math.max(ZOOM_MIN, Math.round(view.zoom)))} />
      <Hint tool={s.tool} hasSelection={selIds.length > 0} />
    </div>
  );
}

function ViewBar({ zoom, onZoomIn, onZoomOut, onFit }: { zoom: number; onZoomIn(): void; onZoomOut(): void; onFit(): void; onActual(): void }) {
  const settings = useEditor((s) => s.settings);
  return (
    <div className="viewbar" role="toolbar" aria-label="View">
      <button className="btn icon" title="Zoom out (−)" onClick={onZoomOut} aria-label="Zoom out">
        <Icon name="zoomOut" />
      </button>
      <span className="zoom-readout" title="Zoom (pixels per unit)">
        {Math.round(zoom * 100)}%
      </span>
      <button className="btn icon" title="Zoom in (+)" onClick={onZoomIn} aria-label="Zoom in">
        <Icon name="zoomIn" />
      </button>
      <button className="btn icon" title="Fit canvas (Shift+1)" onClick={onFit} aria-label="Fit canvas">
        <Icon name="fit" />
      </button>
      <span className="sep" />
      <button className={`btn icon ${settings.grid ? 'on' : ''}`} title="Grid" aria-pressed={settings.grid} onClick={() => updateSettings({ grid: !settings.grid })}>
        <Icon name="grid" />
      </button>
      <button className={`btn icon ${settings.keylines ? 'on' : ''}`} title="Keyline shapes" aria-pressed={settings.keylines} onClick={() => updateSettings({ keylines: !settings.keylines })}>
        <Icon name="keylines" />
      </button>
      <button className={`btn icon ${settings.snap ? 'on' : ''}`} title="Snap to grid (hold Ctrl/⌘ to toggle while dragging)" aria-pressed={settings.snap} onClick={() => updateSettings({ snap: !settings.snap })}>
        <Icon name="magnet" />
      </button>
      <select className="select slim" title="Snap step" aria-label="Snap step" value={settings.snapStep} onChange={(e) => updateSettings({ snapStep: Number(e.target.value) })}>
        <option value={1}>1</option>
        <option value={0.5}>0.5</option>
        <option value={0.25}>0.25</option>
        <option value={0.1}>0.1</option>
      </select>
      <button
        className="btn icon"
        title={`Artboard background: ${settings.artboard} (click to change). Use light or dark to check icons that are black or white.`}
        aria-label={`Artboard background: ${settings.artboard}`}
        data-testid="artboard-tone"
        onClick={() => updateSettings({ artboard: settings.artboard === 'auto' ? 'light' : settings.artboard === 'light' ? 'dark' : 'auto' })}
      >
        <Icon name={settings.artboard === 'dark' ? 'moon' : settings.artboard === 'light' ? 'sun' : 'image'} />
      </button>
      <button className={`btn icon ${settings.outline ? 'on' : ''}`} title="Outline view: see the paths without their stroke width (O)" aria-pressed={settings.outline} data-testid="outline-view" onClick={() => updateSettings({ outline: !settings.outline })}>
        <Icon name="convert" />
      </button>
      <span className="sep" />
      <button
        className="btn seg-btn"
        title={
          settings.selectMode === 'encompass'
            ? 'Drag selection: only shapes completely inside the rectangle are selected (Alt toggles while dragging)'
            : 'Drag selection: any shape the rectangle touches is selected (Alt toggles while dragging)'
        }
        aria-label={`Drag selection mode: ${settings.selectMode}`}
        data-testid="select-mode"
        onClick={() => updateSettings({ selectMode: settings.selectMode === 'encompass' ? 'touch' : 'encompass' })}
      >
        <Icon name={settings.selectMode === 'encompass' ? 'encompass' : 'touch'} />
        <span>{settings.selectMode === 'encompass' ? 'Encompass' : 'Touch'}</span>
      </button>
    </div>
  );
}

const HINTS: Record<ToolId, string> = {
  select: 'Drag to select shapes inside a rectangle · Shift adds · Double-click a group to open it',
  node: 'Drag points and handles · Double-click a line to add a point · Double-click a point to switch corner/smooth',
  pen: 'Click to add points, drag for curves · click the first point to close · Enter or double-click to finish',
  line: 'Drag to draw a line · Shift snaps the angle',
  rect: 'Drag to draw a rectangle · Shift for a square · Alt from the centre',
  ellipse: 'Drag to draw an ellipse · Shift for a circle · Alt from the centre',
  scale: 'Drag to scale both ways about the pivot · Shift scales each axis freely',
  scaleH: 'Drag sideways to scale horizontally about the pivot',
  scaleV: 'Drag up or down to scale vertically about the pivot',
  rotate: 'Drag around the pivot to rotate · Shift snaps to 15°',
  hand: 'Drag to pan the canvas',
};

function Hint({ tool, hasSelection }: { tool: ToolId; hasSelection: boolean }) {
  const needs = (tool === 'scale' || tool === 'scaleH' || tool === 'scaleV' || tool === 'rotate') && !hasSelection;
  return <div className="hint">{needs ? 'Select something first, then drag to transform it' : HINTS[tool]}</div>;
}
