import { useEffect, useRef, useState } from 'react';
import type { Side } from './util';

interface Drop {
  /** Files are being dragged over the window. */
  active: boolean;
  /** The half of the window they would load into. */
  hot: Side | null;
}

/**
 * Files dragged anywhere over the window: the overlay shows while they are, and
 * dropping them calls `onDrop` with the side they were dropped on (or the
 * target's own data-side, such as a drop zone in a dialog).
 */
export function useFileDrop(onDrop: (files: File[], target: HTMLElement | null, clientX: number) => void): Drop {
  const [drop, setDrop] = useState<Drop>({ active: false, hot: null });
  const handler = useRef(onDrop);
  useEffect(() => {
    handler.current = onDrop;
  });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const set = (next: Drop) => setDrop((d) => (d.active === next.active && d.hot === next.hot ? d : next));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      set({ active: true, hot: null });
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) set({ active: false, hot: null });
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const half = (e.target as HTMLElement).closest?.<HTMLElement>('.drop-half');
      set({ active: true, hot: (half?.dataset.side as Side | undefined) ?? null });
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const dropped = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      set({ active: false, hot: null });
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) handler.current(files, e.target as HTMLElement | null, e.clientX);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', dropped);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', dropped);
    };
  }, []);
  return drop;
}

/** Covers the window while files are dragged over it: the left half loads A, the right half B. */
export function DropOverlay({ hot }: { hot: Side | null }) {
  return (
    <div className="drop-overlay" id="drop-overlay">
      {(['a', 'b'] as const).map((side) => (
        <div key={side} className={`drop-half${hot === side ? ' hot' : ''}`} data-side={side}>
          <span className="siglum">{side.toUpperCase()}</span>
          <span>Drop to load as {side.toUpperCase()}</span>
        </div>
      ))}
    </div>
  );
}
