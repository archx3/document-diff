'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Segment<T extends string> {
  value: T;
  /** What the segment shows: text, or an icon (then `label` names it). */
  content: ReactNode;
  label?: string;
  tip?: string;
  kbd?: string;
  id?: string;
  disabled?: boolean;
  /** More attributes for the segment's button (data-* for tests and styles). */
  attrs?: Record<string, string>;
}

interface SegmentedProps<T extends string> {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange(value: T): void;
  /** The group's name, for screen readers. */
  label: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A segmented control: one of a few choices, with a pill that slides to the
 * chosen one. Arrow keys, Home and End move the choice, as radio buttons do.
 */
export function Segmented<T extends string>({ segments, value, onChange, label, id, className = '', disabled }: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // The pill jumps into place the first time, and slides after that.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = group.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
      setPill(on ? { x: on.offsetLeft, w: on.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, segments]);
  useLayoutEffect(() => {
    if (pill && !ready) requestAnimationFrame(() => setReady(true));
  }, [pill, ready]);

  const enabled = segments.filter((s) => !s.disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.findIndex((s) => s.value === value);
    const to =
      e.key === 'Home' ? 0 : e.key === 'End' ? enabled.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : null;
    if (to === null || !enabled.length) return;
    e.preventDefault();
    const next = enabled[(to + enabled.length) % enabled.length]!;
    onChange(next.value);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus());
  };

  return (
    <div className={`seg ${className}`} id={id} role="radiogroup" aria-label={label} ref={group} onKeyDown={onKeyDown} data-ready={ready || undefined}>
      {pill && <span className="seg-pill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
      {segments.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          id={s.id}
          data-value={s.value}
          aria-checked={value === s.value}
          aria-label={s.label}
          aria-keyshortcuts={s.kbd}
          data-tip={s.tip}
          data-kbd={s.kbd}
          tabIndex={value === s.value ? 0 : -1}
          disabled={disabled || s.disabled}
          {...s.attrs}
          onClick={() => onChange(s.value)}
        >
          {s.content}
        </button>
      ))}
    </div>
  );
}
