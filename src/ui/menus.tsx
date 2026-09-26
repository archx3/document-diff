import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Ico } from '../components/icons';
import type { Dir } from '../core/merge';
import type { Doc } from '../core/model';
import type { CompareOptions } from '../core/tokens';
import type { ExportFormat } from '../formats/export';
import { VIEWER_EXTENSIONS, exportFormats } from '../formats/export';
import type { LoadKind } from './empty';
import { hostedInViewer, inViewer } from './files';
import type { Side } from './util';
import { SIDE_NAME, plural } from './util';

interface PopoverProps {
  /** The button (or word) it opened from. */
  anchor: HTMLElement;
  className?: string;
  onClose(): void;
  children: ReactNode;
}

/**
 * A menu under the button that opened it: right-aligned for B's and the
 * editing buttons, above the button where there is no room below. Focus moves
 * into it, and a press anywhere else closes it.
 */
export function Popover({ anchor, className = '', onClose, children }: PopoverProps) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pop = el.current!;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const edge = window.innerWidth - pw - 12;
    const left = anchor.closest('.colhead.b, .tgroup.edit') ? Math.min(edge, Math.max(12, r.right - pw)) : Math.min(edge, Math.max(12, r.left));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }, [anchor]);
  useEffect(() => {
    el.current?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [anchor, onClose]);
  return (
    <div className={`pop ${className}`} id="pop" ref={el}>
      {children}
    </div>
  );
}

export function LoadMenu({ side, onLoad }: { side: Side; onLoad(kind: LoadKind, side: Side): void }) {
  return (
    <div className="menu" role="menu" aria-label={`Load ${SIDE_NAME[side]}`}>
      <button type="button" className="mi" role="menuitem" data-load="file" data-side={side} onClick={() => onLoad('file', side)}>
        <Ico name="open" />
        <span>Open a file…</span>
        <small>Word, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV, text</small>
      </button>
      <button type="button" className="mi" role="menuitem" data-load="paste" data-side={side} onClick={() => onLoad('paste', side)}>
        <Ico name="paste" />
        <span>Paste from Google Docs or Word…</span>
      </button>
      <button type="button" className="mi" role="menuitem" data-load="gdoc" data-side={side} onClick={() => onLoad('gdoc', side)}>
        <Ico name="link" />
        <span>Google Docs link…</span>
      </button>
    </div>
  );
}

/** The document's own format first, then copying and printing, then every other format. */
export function ExportMenu({ side, doc, onExport }: { side: Side; doc: Doc; onExport(format: string, side: Side): void }) {
  const viewer = inViewer();
  const item = (f: ExportFormat, first: boolean) => {
    // This viewer only saves some file types; the others travel inside a zip.
    const zipped = viewer && !VIEWER_EXTENSIONS.has(f.ext);
    const hint = zipped ? 'Saved inside a .zip here (this viewer only saves some file types)' : f.hint;
    return (
      <button key={f.id} type="button" className="mi" role="menuitem" data-export={f.id} data-side={side} onClick={() => onExport(f.id, side)}>
        <Ico name={first ? 'download' : 'doc'} />
        <span>
          {f.label}{' '}
          <span className="ext">
            .{f.ext}
            {zipped && '.zip'}
          </span>
        </span>
        {hint && <small>{hint}</small>}
      </button>
    );
  };
  const [own, ...rest] = exportFormats(doc);
  return (
    <div className="menu" role="menu" aria-label={`Export ${SIDE_NAME[side]}`}>
      <div className="menu-title">
        {SIDE_NAME[side]}: {doc.name}
      </div>
      {own && item(own, true)}
      <button type="button" className="mi" role="menuitem" data-export="copy" data-side={side} onClick={() => onExport('copy', side)}>
        <Ico name="copy" />
        <span>Copy formatted text</span>
        <small>Paste into Google Docs or Word</small>
      </button>
      {!hostedInViewer() && (
        <button type="button" className="mi" role="menuitem" data-export="print" data-side={side} onClick={() => onExport('print', side)}>
          <Ico name="print" />
          <span>Print…</span>
        </button>
      )}
      <div className="menu-sep" />
      <div className="menu-title">Download as</div>
      {rest.map((f) => item(f, false))}
    </div>
  );
}

/** Copying the current change, or every change, one way or the other. */
export function CopyMenu({ current, total, onApply }: { current: number; total: number; onApply(scope: 'cur' | 'all', dir: Dir): void }) {
  return (
    <div className="menu" role="menu" aria-label="Copy changes">
      {current >= 0 && current < total && (
        <>
          <div className="menu-title">Change {current + 1}</div>
          <button type="button" className="mi" role="menuitem" data-apply="cur-l2r" onClick={() => onApply('cur', 'l2r')}>
            <Ico name="toB" />
            <span>Use A’s version in B</span>
            <kbd>Alt+→</kbd>
          </button>
          <button type="button" className="mi" role="menuitem" data-apply="cur-r2l" onClick={() => onApply('cur', 'r2l')}>
            <Ico name="toA" />
            <span>Use B’s version in A</span>
            <kbd>Alt+←</kbd>
          </button>
          <div className="menu-sep" />
        </>
      )}
      <div className="menu-title">All {plural(total, 'change')}</div>
      <button type="button" className="mi" role="menuitem" data-apply="all-l2r" onClick={() => onApply('all', 'l2r')}>
        <Ico name="toB" />
        <span>Make B match A</span>
      </button>
      <button type="button" className="mi" role="menuitem" data-apply="all-r2l" onClick={() => onApply('all', 'r2l')}>
        <Ico name="toA" />
        <span>Make A match B</span>
      </button>
    </div>
  );
}

type Flag = { [K in keyof CompareOptions]: CompareOptions[K] extends boolean ? K : never }[keyof CompareOptions];

/** What counts as a difference. */
export function OptionsMenu({ opts, onChange }: { opts: CompareOptions; onChange(opts: CompareOptions): void }) {
  const box = (key: Flag, label: string, hint?: string) => (
    <label className="opt">
      <input type="checkbox" data-opt={key} checked={opts[key]} onChange={(e) => onChange({ ...opts, [key]: e.currentTarget.checked })} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
  return (
    <div className="menu options" role="dialog" aria-label="Comparison options">
      <div className="menu-title">Compare</div>
      <label className="opt">
        <input type="radio" name="gran" value="word" checked={opts.granularity === 'word'} onChange={() => onChange({ ...opts, granularity: 'word' })} />
        <span>Word by word</span>
      </label>
      <label className="opt">
        <input type="radio" name="gran" value="char" checked={opts.granularity === 'char'} onChange={() => onChange({ ...opts, granularity: 'char' })} />
        <span>
          Character by character<small>Shows single-letter edits</small>
        </span>
      </label>
      <div className="menu-sep" />
      <div className="menu-title">Ignore</div>
      {box('ignoreEmpty', 'Empty paragraphs')}
      {box('ignoreFormatting', 'Formatting', 'Bold, italic, underline, links and alignment')}
      {box('ignoreCase', 'Upper and lower case')}
      {box('ignoreWhitespace', 'Extra spaces')}
      {box('normalizePunctuation', 'Quote and dash styles', 'Treats “curly” and "straight" quotes alike')}
    </div>
  );
}

/** A word-level change: both sides' words, and copying either across. */
export function InlineMenu({ a, b, fmtOnly, onApply }: { a: string; b: string; fmtOnly: boolean; onApply(dir: Dir): void }) {
  const show = (s: string, side: 'A' | 'B') => (s ? (s.length > 80 ? `${s.slice(0, 77)}…` : s) : <em>nothing in {side}</em>);
  return (
    <div className="menu inline-pop" role="dialog" aria-label="Word-level change">
      <div className="chg-preview">
        <div>
          <span className="siglum sm">A</span>
          <del>{show(a, 'A')}</del>
        </div>
        <div>
          <span className="siglum sm">B</span>
          <ins>{show(b, 'B')}</ins>
        </div>
      </div>
      {fmtOnly && <div className="menu-note">Same words, different formatting.</div>}
      <button type="button" className="mi" data-inline="l2r" onClick={() => onApply('l2r')}>
        <Ico name="toB" />
        <span>Use A’s wording in B</span>
      </button>
      <button type="button" className="mi" data-inline="r2l" onClick={() => onApply('r2l')}>
        <Ico name="toA" />
        <span>Use B’s wording in A</span>
      </button>
    </div>
  );
}
