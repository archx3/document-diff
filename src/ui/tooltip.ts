import { esc } from './render';

/** How long the pointer rests on a button before its tooltip shows. */
const DELAY = 450;
/** After a tooltip hides, the next one shows at once for this long (moving along a toolbar). */
const WARM = 400;

/**
 * Tooltips for icon buttons. An element with `data-tip` shows that text, and
 * its keyboard shortcut from `data-kbd`, on hover or keyboard focus. The
 * tooltip repeats the button's accessible name, so it is hidden from
 * assistive technology; shortcuts are announced through aria-keyshortcuts.
 */
export class Tooltips {
  private readonly tip: HTMLElement;
  private anchor: HTMLElement | null = null;
  private pending: HTMLElement | null = null;
  private timer = 0;
  private warmUntil = 0;

  constructor(root: HTMLElement, signal: AbortSignal) {
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.setAttribute('aria-hidden', 'true');
    this.tip.hidden = true;
    root.appendChild(this.tip);

    const find = (t: EventTarget | null) => ((t as Element | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null;
    root.addEventListener(
      'pointerover',
      (e) => {
        if (e.pointerType === 'touch') return;
        const a = find(e.target);
        if (a) this.schedule(a);
      },
      { signal },
    );
    root.addEventListener(
      'pointerout',
      (e) => {
        const from = find(e.target);
        if (!from || (from !== this.anchor && from !== this.pending)) return;
        if (e.relatedTarget && from.contains(e.relatedTarget as Node)) return;
        this.hide();
      },
      { signal },
    );
    root.addEventListener(
      'focusin',
      (e) => {
        const a = find(e.target);
        if (a && (e.target as Element).matches(':focus-visible')) this.show(a);
      },
      { signal },
    );
    root.addEventListener('focusout', () => this.hide(), { signal });
    root.addEventListener('pointerdown', () => this.hide(true), { signal, capture: true });
    // Any scrolling moves the button away from its tooltip.
    window.addEventListener('scroll', () => this.hide(true), { signal, capture: true, passive: true });
    window.addEventListener('keydown', () => this.hide(true), { signal, capture: true });
  }

  private schedule(a: HTMLElement): void {
    if (a === this.anchor || a === this.pending) return;
    clearTimeout(this.timer);
    this.pending = a;
    if (this.anchor || performance.now() < this.warmUntil) {
      this.show(a);
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.pending === a && a.isConnected) this.show(a);
    }, DELAY);
  }

  private show(a: HTMLElement): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.pending = null;
    const text = a.dataset.tip;
    if (!text) return;
    const kbd = a.dataset.kbd;
    this.tip.innerHTML = `<span>${esc(text)}</span>${kbd ? `<kbd>${esc(kbd)}</kbd>` : ''}`;
    this.tip.hidden = false;
    this.anchor = a;
    const r = a.getBoundingClientRect();
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    let top = r.bottom + 7;
    if (top + h > window.innerHeight - 8) top = r.top - h - 7;
    this.tip.style.left = `${Math.round(left)}px`;
    this.tip.style.top = `${Math.round(top)}px`;
  }

  /** Hides the tooltip; unless `cold`, the next one within a moment shows at once. */
  hide(cold = false): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.pending = null;
    if (this.anchor) this.warmUntil = cold ? 0 : performance.now() + WARM;
    this.anchor = null;
    this.tip.hidden = true;
  }
}
