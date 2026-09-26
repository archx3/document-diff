import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** How long the pointer rests on a button before its tooltip shows. */
const DELAY = 450;
/** After a tooltip hides, the next one shows at once for this long (moving along a toolbar). */
const WARM = 400;

interface Tip {
  anchor: HTMLElement;
  text: string;
  kbd?: string;
}

/**
 * Tooltips for the buttons under `root`. An element with `data-tip` shows that
 * text, and its keyboard shortcut from `data-kbd`, on hover or keyboard focus.
 * The tooltip repeats the button's accessible name, so it is hidden from
 * assistive technology; shortcuts are announced through aria-keyshortcuts.
 */
export function Tooltips({ root }: { root: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let anchor: HTMLElement | null = null;
    let pending: HTMLElement | null = null;
    let timer = 0;
    let warmUntil = 0;

    const find = (t: EventTarget | null) => ((t as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null;
    const show = (a: HTMLElement) => {
      clearTimeout(timer);
      timer = 0;
      pending = null;
      const text = a.dataset.tip;
      if (!text) return;
      anchor = a;
      setTip({ anchor: a, text, kbd: a.dataset.kbd });
    };
    // Unless `cold`, the next tooltip within a moment shows at once.
    const hide = (cold = false) => {
      clearTimeout(timer);
      timer = 0;
      pending = null;
      if (anchor) warmUntil = cold ? 0 : performance.now() + WARM;
      anchor = null;
      setTip(null);
    };
    const schedule = (a: HTMLElement) => {
      if (a === anchor || a === pending) return;
      clearTimeout(timer);
      pending = a;
      if (anchor || performance.now() < warmUntil) {
        show(a);
        return;
      }
      timer = window.setTimeout(() => {
        timer = 0;
        if (pending === a && a.isConnected) show(a);
      }, DELAY);
    };

    const ac = new AbortController();
    const { signal } = ac;
    host.addEventListener(
      'pointerover',
      (e) => {
        if (e.pointerType === 'touch') return;
        const a = find(e.target);
        if (a) schedule(a);
      },
      { signal },
    );
    host.addEventListener(
      'pointerout',
      (e) => {
        const from = find(e.target);
        if (!from || (from !== anchor && from !== pending)) return;
        if (e.relatedTarget && from.contains(e.relatedTarget as Node)) return;
        hide();
      },
      { signal },
    );
    host.addEventListener(
      'focusin',
      (e) => {
        const a = find(e.target);
        if (a && (e.target as Element).matches(':focus-visible')) show(a);
      },
      { signal },
    );
    host.addEventListener('focusout', () => hide(), { signal });
    host.addEventListener('pointerdown', () => hide(true), { signal, capture: true });
    // Any scrolling moves the button away from its tooltip.
    window.addEventListener('scroll', () => hide(true), { signal, capture: true, passive: true });
    window.addEventListener('keydown', () => hide(true), { signal, capture: true });
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [root]);

  // Below the button, or above it where there is no room, and inside the window.
  useLayoutEffect(() => {
    const t = el.current;
    if (!tip || !t) return;
    const r = tip.anchor.getBoundingClientRect();
    const left = Math.min(window.innerWidth - t.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - t.offsetWidth / 2));
    let top = r.bottom + 7;
    if (top + t.offsetHeight > window.innerHeight - 8) top = r.top - t.offsetHeight - 7;
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div className="tip" aria-hidden="true" ref={el}>
      <span>{tip.text}</span>
      {tip.kbd && <kbd>{tip.kbd}</kbd>}
    </div>
  );
}
