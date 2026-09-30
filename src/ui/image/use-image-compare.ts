/**
 * Comparing two pictures: the state of the comparison (how it is shown, how
 * small a difference counts, the zoom) and what it found (the changed pixels
 * and areas). The toolbar's image tools and the view both work from it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Box, PixelDiff, Pixels } from '../../image/diff';
import { changedBoxes, diffImage, diffPixels } from '../../image/diff';
import { loadImage, pixelsOf, pngOf } from '../../image/draw';
import { saveFile } from '../files';

export interface ImageSide {
  src: string;
  name: string;
}

export type ImageMode = 'side' | 'swipe' | 'onion' | 'diff';

/** The longest side pictures are compared at (larger ones are compared scaled down). */
const MAX_SIDE = 2000;

interface Loaded {
  a: HTMLImageElement;
  b: HTMLImageElement;
  /** The size both are compared at (A's, within MAX_SIDE). */
  width: number;
  height: number;
  pa: Pixels;
  pb: Pixels;
}

export interface ImageCompare {
  sides: { a: ImageSide; b: ImageSide } | null;
  loaded: Loaded | null;
  error: string;
  mode: ImageMode;
  setMode(m: ImageMode): void;
  /** Where the swipe divides A from B, and how much of B shows over A, 0 to 100. */
  swipe: number;
  setSwipe(v: number): void;
  opacity: number;
  setOpacity(v: number): void;
  /** How small a difference counts, 0 to 100. */
  sensitivity: number;
  setSensitivity(v: number): void;
  outline: boolean;
  setOutline(v: boolean): void;
  /**
   * The picture on top in swipe and onion skin, and the one the difference
   * is drawn on (B, until swapped): swiping uncovers it from the left, onion
   * skin fades it in over the other.
   */
  top: 'a' | 'b';
  setTop(v: 'a' | 'b'): void;
  diff: PixelDiff | null;
  boxes: Box[];
  /** The difference as a picture (changed pixels in red). */
  diffUrl: string;
  /** Fitted to the view, or a scale (1 = the picture's own size). */
  zoom: number | 'fit';
  setZoom(z: number | 'fit'): void;
  pan: { x: number; y: number };
  setPan(p: { x: number; y: number }): void;
  /** The changed area shown last (by stepping through them), or -1. */
  area: number;
  /** Shows the next or previous changed area, zoomed in on it. */
  stepArea(delta: 1 | -1): void;
  /** Zooms in on an area (in fractions of the picture), such as a note's. */
  showBox(box: { x: number; y: number; w: number; h: number }): void;
  /** Drawing notes on the pictures (instead of dragging them about). */
  annotate: boolean;
  setAnnotate(v: boolean): void;
  /** The view's size (it tells), what that makes the scale, and where the pictures sit in their panes. */
  viewport: { w: number; h: number };
  setViewport(v: { w: number; h: number }): void;
  scale: number;
  offset: { x: number; y: number };
  saveDifference(): Promise<void>;
}

/** Panes in a mode: side by side has two. */
export const panesOf = (m: ImageMode) => (m === 'side' ? 2 : 1);
/** Space around a picture in its pane. */
const PAD = 16;

/** The comparison of two pictures (with null, an idle one: hooks can't be called conditionally). */
export function useImageCompare(sides: { a: ImageSide; b: ImageSide } | null): ImageCompare {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ImageMode>('side');
  const [swipe, setSwipe] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [sensitivity, setSensitivity] = useState(90);
  const [outline, setOutline] = useState(true);
  const [top, setTop] = useState<'a' | 'b'>('b');
  const [annotate, setAnnotate] = useState(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState(-1);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const srcA = sides?.a.src;
  const srcB = sides?.b.src;

  useEffect(() => {
    setLoaded(null);
    setError('');
    setArea(-1);
    setZoom('fit');
    if (!srcA || !srcB) return;
    let live = true;
    Promise.all([loadImage(srcA), loadImage(srcB)]).then(
      ([ia, ib]) => {
        if (!live) return;
        const nw = ia.naturalWidth || 600;
        const nh = ia.naturalHeight || 400;
        const scale = Math.min(1, MAX_SIDE / Math.max(nw, nh));
        const width = Math.max(1, Math.round(nw * scale));
        const height = Math.max(1, Math.round(nh * scale));
        setLoaded({ a: ia, b: ib, width, height, pa: pixelsOf(ia, width, height), pb: pixelsOf(ib, width, height) });
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [srcA, srcB]);

  const diff = useMemo(() => (loaded ? diffPixels(loaded.pa, loaded.pb, sensitivity / 100) : null), [loaded, sensitivity]);
  const boxes = useMemo(() => (diff ? changedBoxes(diff) : []), [diff]);
  // Areas are in reading order to step through (top to bottom, left to right).
  const ordered = useMemo(() => [...boxes].sort((p, q) => p.y - q.y || p.x - q.x), [boxes]);
  const diffUrl = useMemo(() => {
    if (!loaded || !diff) return '';
    const canvas = document.createElement('canvas');
    canvas.width = diff.width;
    canvas.height = diff.height;
    canvas.getContext('2d')!.putImageData(new ImageData(diffImage(top === 'a' ? loaded.pa : loaded.pb, diff), diff.width, diff.height), 0, 0);
    return canvas.toDataURL('image/png');
  }, [loaded, diff, top]);

  const panes = panesOf(mode);
  const paneW = viewport.w / panes - PAD;
  const paneH = viewport.h - PAD;
  const fit = loaded && viewport.w ? Math.min(paneW / loaded.width, paneH / loaded.height, 4) : 1;
  const scale = zoom === 'fit' ? fit : zoom;
  // Fitted, a picture sits in the middle of its pane.
  const offset =
    zoom === 'fit' && loaded ? { x: Math.max(0, (paneW - loaded.width * scale) / 2), y: Math.max(0, (paneH - loaded.height * scale) / 2) } : pan;

  /** Zooms in on an area (in the picture's pixels), in the middle of the pane. */
  const zoomTo = useCallback(
    (box: Box) => {
      if (!viewport.w) return;
      const s = Math.min(8, Math.max(0.5, Math.min(paneW / (Math.max(8, box.width) * 3), paneH / (Math.max(8, box.height) * 3))));
      setZoom(s);
      setPan({ x: paneW / 2 - (box.x + box.width / 2) * s, y: paneH / 2 - (box.y + box.height / 2) * s });
    },
    [viewport.w, paneW, paneH],
  );

  /** Zooms in on a changed area. */
  const stepArea = useCallback(
    (delta: 1 | -1) => {
      if (!ordered.length || !viewport.w) return;
      const next = area < 0 ? (delta > 0 ? 0 : ordered.length - 1) : (area + delta + ordered.length) % ordered.length;
      setArea(next);
      zoomTo(ordered[next]!);
    },
    [ordered, area, viewport.w, zoomTo],
  );

  const showBox = useCallback(
    (b: { x: number; y: number; w: number; h: number }) => {
      if (!loaded) return;
      zoomTo({ x: b.x * loaded.width, y: b.y * loaded.height, width: b.w * loaded.width, height: b.h * loaded.height } as Box);
    },
    [loaded, zoomTo],
  );

  const saveDifference = useCallback(async () => {
    if (!loaded || !diff || !sides) return;
    const png = await pngOf({ width: diff.width, height: diff.height, data: diffImage(top === 'a' ? loaded.pa : loaded.pb, diff) });
    await saveFile(`${sides[top].name.replace(/\.[^.]+$/, '')} (difference).png`, png);
  }, [loaded, diff, sides, top]);

  return {
    sides,
    loaded,
    error,
    mode,
    setMode,
    swipe,
    setSwipe,
    opacity,
    setOpacity,
    sensitivity,
    setSensitivity,
    outline,
    setOutline,
    top,
    setTop,
    diff,
    boxes,
    diffUrl,
    zoom,
    setZoom,
    pan,
    setPan,
    area,
    stepArea,
    showBox,
    annotate,
    setAnnotate,
    viewport,
    setViewport,
    scale,
    offset,
    saveDifference,
  };
}
