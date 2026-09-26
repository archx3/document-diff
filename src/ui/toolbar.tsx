import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import type { IconName } from '../components/icons';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';
import { Counter } from './counter';
import type { View } from './util';

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

/** An icon button, borderless until hovered: its label is its accessible name and tooltip. */
export function Tool({ id, icon, label, tip, kbd, keys, toggle, pressed, menu, expanded, controls, className, disabled, onClick, children }: Readonly<ToolProps>) {
  const cls = ['btn ghost', menu ? 'icon-menu' : 'icon-only', toggle && 'toggle', className].filter(Boolean).join(' ');
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
        <Tool id="btn-swap" icon="swap" label="Swap A and B" disabled={!hasDocs} onClick={onSwap} />
        <Tool id="btn-new" icon="newDoc" label="New comparison" tip="New comparison: start again with two documents" disabled={!hasDocs} onClick={onNew} />
        <Tool id="btn-contrast" icon="contrast" label="Low contrast" tip="Low contrast: no borders, one background" toggle pressed={lowContrast} onClick={onContrast} />
        <Tool id="btn-theme" icon="moon" label="Dark theme" tip={dark ? 'Switch to the light theme' : 'Switch to the dark theme'} className="theme-btn" pressed={dark} onClick={onTheme}>
          {/* The icon shows the theme it switches to, through CSS (styles.css). */}
          <span className="theme-moon">
            <Ico name="moon" />
          </span>
          <span className="theme-sun">
            <Ico name="sun" />
          </span>
        </Tool>
        <Tool id="btn-help" icon="help" label="Help and keyboard shortcuts" kbd="?" onClick={onHelp} />
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
  view: View;
  minimap: boolean;
  lines: boolean;
  bands: boolean;
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
  onView(view: View): void;
  onMinimap: Click;
  onLines: Click;
  onBands: Click;
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
export function Toolbar(p: Readonly<ToolbarProps>) {
  const bar = useRef<HTMLDivElement>(null);
  useFocusRescue(bar);
  const n = p.cmp?.hunks.length ?? 0;
  const split = p.view === 'split';
  return (
    <div className={`toolbar${p.cmp ? '' : ' disabled'}${p.cmp && n === 0 ? ' same' : ''}`} id="toolbar" role="toolbar" aria-label="Comparison tools" ref={bar}>
      <div className="tcol left" role="group" aria-label="Changes">
        <div className="tgroup nav">
          <Tool id="btn-prev" icon="up" label="Previous change" kbd="P" disabled={p.nav.prev} onClick={p.onPrev} />
          <Tool id="btn-next" icon="down" label="Next change" kbd="N" disabled={p.nav.next} onClick={p.onNext} />
          <Tool
            id="btn-changes"
            icon="changesOnly"
            label="Changes only"
            tip="Changes only: fold unchanged paragraphs"
            kbd="C"
            toggle
            pressed={p.changesOnly && n > 0}
            disabled={n === 0}
            onClick={p.onChangesOnly}
          />
        </div>
        {/* On a phone the column heads, where the counter usually is, scroll away. */}
        <Counter cmp={p.cmp} current={p.current} className="counter-m" />
        <StatsHint cmp={p.cmp} same={p.same} />
      </div>
      <div className="tcol middle" role="group" aria-label="View">
        <ViewSwitch view={p.view} disabled={!p.cmp} onView={p.onView} />
        <Tool id="btn-minimap" icon="minimap" label="Minimap" tip="Minimap of each document beside the ruler" kbd="M" toggle pressed={p.minimap} disabled={!p.cmp} onClick={p.onMinimap} />
        <Tool id="btn-lines" icon="lineNumbers" label="Line numbers" tip="Line numbers in the gutter" kbd="L" toggle pressed={p.lines} disabled={!p.cmp} onClick={p.onLines} />
        <Tool
          id="btn-bands"
          icon="connector"
          label="Connection bands"
          tip={split ? 'Connection bands: each document runs on unbroken, with bands joining its changes to the other’s' : 'Connection bands: in the side by side view'}
          kbd="B"
          toggle
          pressed={p.bands && split}
          disabled={!p.cmp || !split}
          onClick={p.onBands}
        />
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

const VIEWS: ReadonlyArray<{ view: View; icon: IconName; label: string; tip: string }> = [
  { view: 'split', icon: 'sideBySide', label: 'Side by side', tip: 'Side by side' },
  { view: 'unified', icon: 'unified', label: 'Unified', tip: 'Unified: one column, A above B where they differ' },
];

/** Side by side or unified: two segments, one of them chosen, that arrow keys move between. */
function ViewSwitch({ view, disabled, onView }: Readonly<{ view: View; disabled: boolean; onView(view: View): void }>) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = VIEWS.findIndex((v) => v.view === view);
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'Home' ? 0 : e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'End' ? VIEWS.length - 1 : -1;
    if (to < 0 || to === i) return;
    e.preventDefault();
    onView(VIEWS[to]!.view);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
  };
  return (
    <div className="seg" id="view" role="radiogroup" aria-label="View" ref={group} onKeyDown={onKeyDown}>
      {VIEWS.map((v) => (
        <button
          key={v.view}
          type="button"
          role="radio"
          id={`btn-view-${v.view}`}
          aria-checked={view === v.view}
          aria-label={v.label}
          aria-keyshortcuts="V"
          data-tip={v.tip}
          data-kbd="V"
          tabIndex={view === v.view ? 0 : -1}
          disabled={disabled}
          onClick={() => onView(v.view)}
        >
          <Ico name={v.icon} />
        </button>
      ))}
    </div>
  );
}

/**
 * The summary of the changes behind an icon: shown while the pointer rests on
 * it or it has keyboard focus, and kept open by a click (a tap on a phone).
 */
function StatsHint({ cmp, same }: Readonly<{ cmp: Comparison | null; same: string }>) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const open = !!cmp && (hover || focus || pinned);
  const s = cmp?.stats;
  const n = cmp?.hunks.length ?? 0;

  useEffect(() => () => clearTimeout(timer.current), []);
  // A press anywhere else, or Escape, puts it away.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setPinned(false);
        setHover(false);
      }
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setHover(false);
      setFocus(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Shown after a moment's rest, so passing over it on the way elsewhere does nothing; kept
  // for a moment after the pointer leaves, so it can move onto the card.
  const rest = (on: boolean) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(on), on ? 120 : 160);
  };

  return (
    <div
      className="stats-hint"
      ref={box}
      onPointerEnter={(e) => e.pointerType !== 'touch' && rest(true)}
      onPointerLeave={(e) => e.pointerType !== 'touch' && rest(false)}
    >
      <button
        type="button"
        className="btn ghost icon-only"
        id="btn-stats"
        aria-label="Summary of the changes"
        aria-describedby="stats"
        aria-expanded={open}
        disabled={!cmp}
        onClick={() => setPinned((v) => !v)}
        onFocus={(e) => setFocus(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
        }}
      >
        <Ico name="info" />
      </button>
      <div className="stats-card" id="stats" role="tooltip" hidden={!open}>
        {s &&
          (n === 0 ? (
            <span className="stat ok">{same}</span>
          ) : (
            <>
              <span className="stats-head">Paragraphs</span>
              <Stat kind="mod" count={s.changed} words="changed" />
              <Stat kind="del" count={s.removed} words="only in A" />
              <Stat kind="ins" count={s.added} words="only in B" />
            </>
          ))}
      </div>
    </div>
  );
}

function Stat({ kind, count, words }: Readonly<{ kind: string; count: number; words: string }>) {
  return (
    <span className={`stat ${kind}`}>
      <b>{count.toLocaleString()}</b> {words}
    </span>
  );
}
