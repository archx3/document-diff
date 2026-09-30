import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import type { IconName } from '../components/icons';
import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';
import { Segmented } from '../components/ui/segmented';
import type { MediaKind } from '../media/kinds';
import { MEDIA } from '../media/kinds';
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
        <span className="brand-tag">Compare two versions of a document, picture or recording</span>
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
  /** Review mode, and how many marks there are (shown on its button while it is off). */
  review: boolean;
  marks: number;
  /** Spelling and grammar checking, how many findings there are (null while it loads), and a Claude check under way. */
  check: boolean;
  issues: number | null;
  checking: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The toolbar menu that is open. */
  menu: 'options' | 'copy' | 'check' | 'redline' | 'report' | 'share' | null;
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
  onRedline: Click;
  onReport: Click;
  onShare: Click;
  onSidebar: Click;
  onReview: Click;
  onCheck: Click;
  onCheckMenu: Click;
}

interface FrameProps {
  /** What is compared: each kind has its own tools. */
  kind: MediaKind;
  /** Nothing to compare yet (the tools are dimmed), or the two are the same (the bar turns green). */
  idle?: boolean;
  same?: boolean;
  /** What changed; how it is shown; editing and getting it out. */
  left: ReactNode;
  middle: ReactNode;
  right: ReactNode;
}

/**
 * The toolbar: three columns — what changed on the left, how it is shown in
 * the middle (centred), editing and getting it out on the right — each filled
 * by the tools for what is compared (text, images or audio).
 */
export function ToolbarFrame({ kind, idle, same, left, middle, right }: Readonly<FrameProps>) {
  const bar = useRef<HTMLDivElement>(null);
  useFocusRescue(bar);
  return (
    <div className={`toolbar${idle ? ' disabled' : ''}${same ? ' same' : ''}`} id="toolbar" data-kind={kind} role="toolbar" aria-label={`${MEDIA[kind].label} tools`} ref={bar}>
      <div className="tcol left" role="group" aria-label="Changes">
        {left}
      </div>
      <div className="tcol middle" role="group" aria-label="View">
        {middle}
      </div>
      <div className="tcol right">{right}</div>
    </div>
  );
}

/** Undo and redo, which every kind of comparison has. */
export function HistoryTools({ canUndo, canRedo, onUndo, onRedo }: Readonly<{ canUndo: boolean; canRedo: boolean; onUndo: Click; onRedo: Click }>) {
  return (
    <>
      <Tool id="btn-undo" icon="undo" label="Undo" kbd="Ctrl+Z" keys="Control+Z Meta+Z" disabled={!canUndo} onClick={onUndo} />
      <Tool id="btn-redo" icon="redo" label="Redo" kbd="Ctrl+Shift+Z" keys="Control+Shift+Z Meta+Shift+Z" disabled={!canRedo} onClick={onRedo} />
    </>
  );
}

/** Sharing the review as a file, which every kind of comparison has. */
export function ShareTool({ expanded, onClick }: Readonly<{ expanded: boolean; onClick: Click }>) {
  return <Tool id="btn-share" icon="link" label="Share the review" tip="Share: save the comparison and its review as a file to send, or open one" menu expanded={expanded} onClick={onClick} />;
}

/** The text tools: changes, views, review and checking, copying across, redline and report. */
export function TextToolbar(p: Readonly<ToolbarProps>) {
  const n = p.cmp?.hunks.length ?? 0;
  const split = p.view === 'split';
  return (
    <ToolbarFrame
      kind="text"
      idle={!p.cmp}
      same={!!p.cmp && n === 0}
      left={
        <>
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
        </>
      }
      middle={
        <>
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
          <Tool
            id="btn-review"
            icon="review"
            label="Review mode"
            tip={p.review ? 'Review mode: notes, highlights and reactions in the margins' : p.marks ? `Review mode: show your ${p.marks === 1 ? 'mark' : `${p.marks} marks`}` : 'Review mode: add notes, highlights and reactions from the margins'}
            kbd="R"
            toggle
            pressed={p.review && !!p.cmp}
            className={!p.review && p.marks ? 'has-marks' : undefined}
            disabled={!p.cmp}
            onClick={p.onReview}
          />
          <div className={`tgroup check${p.checking ? ' busy' : ''}`}>
            <Tool
              id="btn-check"
              icon="spell"
              label="Spelling and grammar"
              tip={p.check ? (p.issues === null ? 'Spelling and grammar: loading the dictionary' : `Spelling and grammar: ${p.issues === 0 ? 'no issues' : `${p.issues} to look at`}`) : 'Spelling and grammar: underline mistakes in both documents'}
              kbd="G"
              toggle
              pressed={p.check && !!p.cmp}
              disabled={!p.cmp}
              onClick={p.onCheck}
            >
              <Ico name="spell" />
              {p.check && !!p.issues && <span className="tbadge">{p.issues > 99 ? '99+' : p.issues}</span>}
            </Tool>
            <Tool id="btn-check-menu" icon="chevron" label="Spelling and grammar options" tip="Language, Claude and your dictionary" menu expanded={p.menu === 'check'} disabled={!p.cmp} onClick={p.onCheckMenu}>
              <span />
            </Tool>
          </div>
          <hr className="tsep" aria-orientation="vertical" />
          <div className="tgroup pages">
            <TextTool id="btn-page-prev" text="Previous page" tip="Scroll up a screen" kbd="Page Up" keys="PageUp" disabled={p.nav.pageUp} onClick={p.onPagePrev} />
            <TextTool id="btn-page-next" text="Next page" tip="Scroll down a screen" kbd="Page Down" keys="PageDown" disabled={p.nav.pageDown} onClick={p.onPageNext} />
          </div>
        </>
      }
      right={
        <>
          <div className="tgroup edit" role="group" aria-label="Edit">
            <HistoryTools canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.onUndo} onRedo={p.onRedo} />
            <Tool id="btn-all" icon="merge" label="Copy changes" tip="Copy this change or every change across" menu expanded={p.menu === 'copy'} disabled={n === 0} onClick={p.onCopy} />
            <Tool
              id="btn-redline"
              icon="download"
              label="Download redline"
              tip="Redline: a Word file with every change as a tracked change"
              menu
              expanded={p.menu === 'redline'}
              disabled={n === 0}
              onClick={p.onRedline}
            />
            <Tool
              id="btn-report"
              icon="doc"
              label="Change report"
              tip="Report: every change with its decision, reactions and notes, as PDF or Word"
              menu
              expanded={p.menu === 'report'}
              disabled={!p.cmp}
              onClick={p.onReport}
            />
            <ShareTool expanded={p.menu === 'share'} onClick={p.onShare} />
          </div>
          <div className="tgroup panel">
            <Tool id="btn-sidebar" icon="sidebar" label="List of changes" kbd="S" toggle pressed={p.sidebar && !!p.cmp} controls="changes" disabled={!p.cmp} onClick={p.onSidebar} />
          </div>
        </>
      }
    />
  );
}

const VIEWS: ReadonlyArray<{ view: View; icon: IconName; label: string; tip: string }> = [
  { view: 'split', icon: 'sideBySide', label: 'Side by side', tip: 'Side by side' },
  { view: 'unified', icon: 'unified', label: 'Unified', tip: 'Unified: one column, A above B where they differ' },
];

/** Side by side or unified. */
function ViewSwitch({ view, disabled, onView }: Readonly<{ view: View; disabled: boolean; onView(view: View): void }>) {
  return (
    <Segmented
      id="view"
      label="View"
      value={view}
      disabled={disabled}
      onChange={onView}
      segments={VIEWS.map((v) => ({ value: v.view, id: `btn-view-${v.view}`, label: v.label, tip: v.tip, kbd: 'V', content: <Ico name={v.icon} /> }))}
    />
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
