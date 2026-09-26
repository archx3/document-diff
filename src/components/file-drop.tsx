'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Takes files dropped anywhere on the page (rather than letting the browser
 * open them). Returns whether files are being dragged over the page.
 */
export function usePageDrop(onDrop: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const drop = useEffectEvent(onDrop);

  useEffect(() => {
    const listeners = new AbortController();
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) =>
      window.addEventListener(type, fn, { signal: listeners.signal });
    let depth = 0;
    on('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    });
    on('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    });
    on('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    on('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) drop(files);
    });
    return () => listeners.abort();
  }, []);

  return dragging;
}

/** A hidden file input: render `input` somewhere and call `open` from a click. */
export function useFilePicker(onPick: (files: File[]) => void, accept: string) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        const files = Array.from(e.currentTarget.files ?? []);
        e.currentTarget.value = '';
        if (files.length) onPick(files);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}
