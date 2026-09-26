import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { IconName } from '../components/icons';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';

type Click = (e: MouseEvent<HTMLButtonElement>) => void;

interface ToolProps {
  id: string;
  icon: IconName;
  /** The button's name, and its tooltip unless `tip` says more. */
  label: string;
  tip?: string;
  /** Shortcut as shown, and in aria-keyshortcuts form when that differs. */
  kbd?: string;
  keys?: string;
  ghost?: boolean;
  /** Styled as a toggle: highlighted while pressed. */
  toggle?: boolean;
  pressed?: boolean;
  /** Opens a menu, which is open while `expanded`. */
  menu?: boolean;
  expanded?: boolean;
  controls?: string;
  className?: string;
  disabled?: boolean;
  onClick: Click;
  /** In place of the icon. */
  children?: ReactNode;
}

/** An icon button: its label is its accessible name and tooltip. */
export function Tool({ id, icon, label, tip, kbd, keys, ghost, toggle, pressed, menu, expanded, controls, className, disabled, onClick, children }: Readonly<ToolProps>) {
  const cls = ['btn', menu ? 'icon-menu' : 'icon-only', ghost && 'ghost', toggle && 'toggle', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      id={id}
      aria-label={label}
      data-tip={tip ?? label}
      data-kbd={kbd}
      aria-keyshortcuts={kbd ? (keys ?? kbd) : undefined}
      aria-pressed={pressed}
      aria-haspopup={menu || undefined}
      aria-expanded={expanded || undefined}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
    >
      {children ?? <Ico name={icon} />}
      {menu && <Ico name="chevron" size={12} />}
    </button>
  );
}

/** A text button: its words are its name, and the tooltip says more. */
function TextTool({ id, text, tip, kbd, keys, disabled, onClick }: Readonly<{
  id: string;
  text: string;
  tip: string;
  kbd: string;
  keys: string;
  disabled: boolean;
  onClick: Click
}>) {
  return (
    <button type="button" className="btn ghost text-btn" id={id} data-tip={tip} data-kbd={kbd} aria-keyshortcuts={keys} disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}

/** A button that turns off while it has keyboard focus hands focus to the nearest button beside it. */
function useFocusRescue(container: RefObject<HTMLElement | null>) {
  const last = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const track = (e: FocusEvent) => {
      if (e.target instanceof HTMLButtonElement) last.current = e.target;
    };
    el.addEventListener('focusin', track);
    return () => el.removeEventListener('focusin', track);
  }, [container]);
  useLayoutEffect(() => {
    const b = last.current;
    if (!b?.disabled || !b.isConnected) return;
    const active = document.activeElement;
    if (active && active !== b && active !== document.body) return;
    const group = Array.from(b.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = group.indexOf(b);
    for (let d = 1; d < group.length; d++) {
      const next = [group[i - d], group[i + d]].find((x) => x && !x.disabled);
      if (next) {
        next.focus();
        return;
      }
    }
  });
}

interface AppBarProps {
  /** Where the name links to. */
  home?: string;
  hasDocs: boolean;
  lowContrast: boolean;
  dark: boolean;
  onSwap: Click;
  onNew: Click;
  onContrast: Click;
  onTheme: Click;
  onHelp: Click;
}

export function AppBar({ home, hasDocs, lowContrast, dark, onSwap, onNew, onContrast, onTheme, onHelp }: Readonly<AppBarProps>) {
  const bar = useRef<HTMLElement>(null);
  useFocusRescue(bar);
  const word = (
    <>
      <span className="brand-mark" aria-hidden="true">
        C
      </span>
      <span className="brand-name" aria-hidden="true">
        ollate
      </span>
    </>
  );
  return (
    <header className="appbar" ref={bar}>
      <div className="brand">
        {home ? (
          <a className="brand-word" href={home} aria-label="Collate home">
            {word}
          </a>
        ) : (
          <span className="brand-word" role="img" aria-label="Collate">
            {word}
          </span>
        )}
        <span className="brand-tag">Compare two documents and copy changes across</span>
      </div>
      <div className="appbar-actions">
        <Tool id="btn-swap" icon="swap" label="Swap A and B" ghost disabled={!hasDocs} onClick={onSwap} />
        <Tool id="btn-new" icon="newDoc" label="New comparison" tip="New comparison: start again with two documents" ghost disabled={!hasDocs} onClick={onNew} />
        <Tool id="btn-contrast" icon="contrast" label="Low contrast" tip="Low contrast: no borders, one background" ghost toggle pressed={lowContrast} onClick={onContrast} />
        <Tool
          id="btn-theme"
          icon="moon"
          label="Dark theme"
          tip={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
          ghost
          className="theme-btn"
          pressed={dark}
          onClick={onTheme}
        >
          {/* The icon shows the theme it switches to, through CSS (styles.css). */}
          <span className="theme-moon">
            <Ico name="moon" />
          </span>
          <span className="theme-sun">
            <Ico name="sun" />
          </span>
        </Tool>
        <Tool id="btn-help" icon="help" label="Help and keyboard shortcuts" kbd="?" ghost onClick={onHelp} />
      </div>
    </header>
  );
}

/** Which of the change and page buttons would do nothing. */
export interface NavOff {
  prev: boolean;
  next: boolean;
  pageUp: boolean;
  pageDown: boolean;
}

export const ALL_NAV_OFF: NavOff = { prev: true, next: true, pageUp: true, pageDown: true };

interface ToolbarProps {
  cmp: Comparison | null;
  current: number;
  nav: NavOff;
  changesOnly: boolean;
  minimap: boolean;
  lines: boolean;
  sidebar: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The toolbar menu that is open. */
  menu: 'options' | 'copy' | null;
  /** What to say when the documents match. */
  same: string;
  onPrev: Click;
  onNext: Click;
  onChangesOnly: Click;
  onMinimap: Click;
  onLines: Click;
  onOptions: Click;
  onPagePrev: Click;
  onPageNext: Click;
  onUndo: Click;
  onRedo: Click;
  onCopy: Click;
  onSidebar: Click;
}

/**
 * Three columns: the changes on the left, the view in the middle (centred)
 * and editing on the right.
 */
export function Toolbar (p: Readonly<ToolbarProps>) {
  const bar = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  useFocusRescue(bar);
  useFit(left);
  const n = p.cmp?.hunks.length ?? 0;
  const s = p.cmp?.stats;
  return (
    <div className={`toolbar${p.cmp ? '' : ' disabled'}${p.cmp && n === 0 ? ' same' : ''}`} id="toolbar" role="toolbar" aria-label="Comparison tools" ref={bar}>
      <div className="tcol left" role="group" aria-label="Changes" ref={left}>
        <div className="tgroup nav">
          <Tool id="btn-prev" icon="up" label="Previous change" kbd="P" disabled={p.nav.prev} onClick={p.onPrev} />
          <Tool id="btn-next" icon="down" label="Next change" kbd="N" disabled={p.nav.next} onClick={p.onNext} />
          <Tool
            id="btn-changes"
            icon="fold"
            label="Changes only"
            tip="Changes only: fold unchanged paragraphs"
            kbd="C"
            toggle
            pressed={p.changesOnly && n > 0}
            disabled={n === 0}
            onClick={p.onChangesOnly}
          />
        </div>
        <span className="counter" id="counter" aria-live="polite">
          {p.cmp &&
            (n === 0 ? (
              <>
                <Ico name="check" />
                <span className="same">No differences</span>
              </>
            ) : (
              <>
                <span className="c-word">Change </span>
                <b>{p.current + 1}</b>
                <span className="c-of"> of </span>
                <b className="c-n">{n}</b>
              </>
            ))}
        </span>
        <div className="stats" id="stats">
          {s &&
            (n === 0 ? (
              <span className="stat ok">{p.same}</span>
            ) : (
              <>
                {/* Where the toolbar is short of room, only the numbers show; the tooltip names them. */}
                <Stat kind="mod" count={s.changed} words="changed" tip="Paragraphs that differ" />
                <Stat kind="del" count={s.removed} words="only in A" tip="Paragraphs only in A" />
                <Stat kind="ins" count={s.added} words="only in B" tip="Paragraphs only in B" />
              </>
            ))}
        </div>
      </div>
      <div className="tcol middle" role="group" aria-label="View">
        <Tool id="btn-minimap" icon="minimap" label="Minimap" tip="Minimap of each document beside the ruler" kbd="M" toggle pressed={p.minimap} disabled={!p.cmp} onClick={p.onMinimap} />
        <Tool id="btn-lines" icon="lineNumbers" label="Line numbers" tip="Line numbers in the gutter" kbd="L" toggle pressed={p.lines} disabled={!p.cmp} onClick={p.onLines} />
        <Tool
          id="btn-options"
          icon="sliders"
          label="Compare options"
          tip="Compare options: what counts as a difference"
          menu
          expanded={p.menu === 'options'}
          disabled={!p.cmp}
          onClick={p.onOptions}
        />
        <hr className="tsep" aria-orientation="vertical" />
        <div className="tgroup pages">
          <TextTool id="btn-page-prev" text="Previous page" tip="Scroll up a screen" kbd="Page Up" keys="PageUp" disabled={p.nav.pageUp} onClick={p.onPagePrev} />
          <TextTool id="btn-page-next" text="Next page" tip="Scroll down a screen" kbd="Page Down" keys="PageDown" disabled={p.nav.pageDown} onClick={p.onPageNext} />
        </div>
      </div>
      <div className="tcol right">
        <div className="tgroup edit" role="group" aria-label="Edit">
          <Tool id="btn-undo" icon="undo" label="Undo" kbd="Ctrl+Z" keys="Control+Z Meta+Z" disabled={!p.canUndo} onClick={p.onUndo} />
          <Tool id="btn-redo" icon="redo" label="Redo" kbd="Ctrl+Shift+Z" keys="Control+Shift+Z Meta+Shift+Z" disabled={!p.canRedo} onClick={p.onRedo} />
          <Tool id="btn-all" icon="merge" label="Copy changes" tip="Copy this change or every change across" menu expanded={p.menu === 'copy'} disabled={n === 0} onClick={p.onCopy} />
        </div>
        <div className="tgroup panel">
          <Tool id="btn-sidebar" icon="sidebar" label="List of changes" kbd="S" toggle pressed={p.sidebar && !!p.cmp} controls="changes" disabled={!p.cmp} onClick={p.onSidebar} />
        </div>
      </div>
    </div>
  );
}

function Stat({ kind, count, words, tip }: Readonly<{ kind: string; count: number; words: string; tip: string }>) {
  return (
    <span className={`stat ${kind}`} data-tip={tip}>
      {count.toLocaleString()}
      <span className="stat-words"> {words}</span>
    </span>
  );
}

/**
 * Shortens the counter and stats only as far as their column needs: first the
 * stats lose their words, then the counter reads "1 / 7". As a last resort
 * they wrap. The column takes its share of the toolbar whatever its content,
 * so it is measured after every render and whenever it changes size.
 */
function useFit(col: RefObject<HTMLElement | null>) {
  const fit = () => {
    const el = col.current;
    if (!el) return;
    const fits = () => el.scrollWidth <= el.clientWidth + 1;
    el.classList.remove('short-stats', 'short-count', 'wrap');
    for (const level of ['short-stats', 'short-count', 'wrap']) {
      if (fits()) return;
      el.classList.add(level);
    }
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const el = col.current;
    if (!el) return;
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    // Text is measured again once the web fonts are in.
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro?.disconnect();
    };
    // `fit` only reads the column, so the first one serves for good.
  }, [col]);
}
