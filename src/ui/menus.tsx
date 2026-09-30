import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Ico } from '../components/icons';
import type { Dir } from '../core/merge';
import type { Doc } from '../core/model';
import type { CompareOptions } from '../core/tokens';
import type { ExportFormat } from '../formats/export';
import { VIEWER_EXTENSIONS, exportFormats } from '../formats/export';
import type { CloudKind } from '../lib/cloud';
import { CLOUD_NAME } from '../lib/cloud';
import type { LoadKind } from './empty';
import { KindPicker } from '../components/kind-picker';
import { Segmented } from '../components/ui/segmented';
import type { MediaKind } from '../media/kinds';
import { MEDIA } from '../media/kinds';
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
    const pop = el.current;
    (pop?.querySelector<HTMLElement>('[data-autofocus]') ?? pop?.querySelector<HTMLElement>('button, input'))?.focus({ preventScroll: true });
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

interface LoadMenuProps {
  side: Side;
  /** Cloud drives this site is set up for. */
  clouds?: readonly CloudKind[];
  /** The document here came from Google Drive: its earlier versions can be compared. */
  driveFile?: string;
  onLoad(kind: LoadKind, side: Side): void;
  /** What kind of file to open, chosen first: it sets which files the dialog offers, and which other ways fit. */
  media: MediaKind;
  onMedia(k: MediaKind): void;
}

export function LoadMenu({ side, clouds = [], driveFile, onLoad, media, onMedia }: LoadMenuProps) {
  return (
    <div className="menu load-menu" role="menu" aria-label={`Load ${SIDE_NAME[side]}`}>
      <div className="load-kinds">
        <KindPicker value={media} onChange={onMedia} />
      </div>
      <button type="button" className="mi" role="menuitem" data-load="file" data-side={side} onClick={() => onLoad('file', side)}>
        <Ico name="open" />
        <span>Open one or two files…</span>
        <small>{MEDIA[media].formats}. Two files replace both A and B.</small>
      </button>
      {media === 'text' && (
        <>
          <button type="button" className="mi" role="menuitem" data-load="paste" data-side={side} onClick={() => onLoad('paste', side)}>
            <Ico name="paste" />
            <span>Paste from Google Docs or Word…</span>
          </button>
          <button type="button" className="mi" role="menuitem" data-load="gdoc" data-side={side} onClick={() => onLoad('gdoc', side)}>
            <Ico name="link" />
            <span>Google Docs link…</span>
          </button>
        </>
      )}
      {clouds.map((c) => (
        <button key={c} type="button" className="mi" role="menuitem" data-load={c} data-side={side} onClick={() => onLoad(c, side)}>
          <Ico name="open" />
          <span>From {CLOUD_NAME[c]}…</span>
        </button>
      ))}
      {driveFile && (
        <button type="button" className="mi" role="menuitem" data-load="drive-version" data-side={side} onClick={() => onLoad('drive-version', side)}>
          <Ico name="undo" />
          <span>Compare with an earlier version…</span>
          <small>Of “{driveFile}” on Google Drive</small>
        </button>
      )}
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

interface RedlineMenuProps {
  /** Names of A and B. */
  a: string;
  b: string;
  author: string;
  changes: number;
  /** Notes and reactions that can go in as comments, and whether they will. */
  notes: number;
  withNotes: boolean;
  onAuthor(name: string): void;
  onWithNotes(on: boolean): void;
  onDownload(format: 'docx' | 'pdf'): void;
}

/** The redline's options: whose name goes on the changes, and the download. */
export function RedlineMenu({ a, b, author, changes, notes, withNotes, onAuthor, onWithNotes, onDownload }: RedlineMenuProps) {
  return (
    <div className="menu redline-menu" role="dialog" aria-label="Download redline">
      <div className="menu-title">Redline</div>
      <p className="menu-note">
        A Word file of <b>{b}</b> with {plural(changes, 'change')} from <b>{a}</b> as tracked changes. Accept them all to get B, reject them all to get A.
      </p>
      <label className="rl-field">
        <span>Your name on the changes</span>
        <input type="text" value={author} placeholder="Collate" data-autofocus maxLength={80} onChange={(e) => onAuthor(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && onDownload('docx')} />
      </label>
      {notes > 0 && (
        <label className="rl-check">
          <input type="checkbox" data-redline="notes" checked={withNotes} onChange={(e) => onWithNotes(e.currentTarget.checked)} />
          <span>Include my notes, reactions and decisions as comments ({notes})</span>
        </label>
      )}
      <button type="button" className="btn primary rl-download" data-redline="download" onClick={() => onDownload('docx')}>
        <Ico name="download" />
        <span>Download redline (.docx)</span>
      </button>
      <button type="button" className="mi" role="menuitem" data-redline="pdf" onClick={() => onDownload('pdf')}>
        <Ico name="print" />
        <span>As a PDF instead</span>
        <small>For reading and printing: added text in green, removed text struck through in red</small>
      </button>
    </div>
  );
}

export interface ReportChoices {
  format: 'pdf' | 'docx';
  openOnly: boolean;
  notedOnly: boolean;
  context: boolean;
  summary: boolean;
}

interface ReportMenuProps {
  choices: ReportChoices;
  /** A summary of what matters is there to include. */
  hasSummary: boolean;
  onChange(c: ReportChoices): void;
  onDownload(): void;
}

/** The change report's options and its download. */
export function ReportMenu({ choices: c, hasSummary, onChange, onDownload }: ReportMenuProps) {
  const check = (key: 'openOnly' | 'notedOnly' | 'context' | 'summary', text: string) => (
    <label className="rl-check">
      <input type="checkbox" data-report={key} checked={c[key]} onChange={(e) => onChange({ ...c, [key]: e.currentTarget.checked })} />
      <span>{text}</span>
    </label>
  );
  return (
    <div className="menu report-menu" role="dialog" aria-label="Change report">
      <div className="menu-title">Change report</div>
      <p className="menu-note">Every change with its words before and after, your decision, reactions and notes, and a table of them all.</p>
      <Segmented
        className="text rp-format"
        label="Format"
        value={c.format}
        onChange={(format) => onChange({ ...c, format })}
        segments={(['pdf', 'docx'] as const).map((f) => ({ value: f, content: f === 'pdf' ? 'PDF' : 'Word', attrs: { 'data-format': f } }))}
      />
      {check('openOnly', 'Only open changes (no decision yet)')}
      {check('notedOnly', 'Only changes with notes or reactions')}
      {check('context', 'Show the paragraph before and after each change')}
      {hasSummary && check('summary', 'Include Claude’s summary of what matters')}
      <button type="button" className="btn primary rl-download" data-report="download" onClick={onDownload}>
        <Ico name="download" />
        <span>Download report</span>
      </button>
    </div>
  );
}

interface ShareMenuProps {
  /** There is a comparison to save. */
  canSave: boolean;
  author: string;
  onAuthor(name: string): void;
  onSave(password: string): void;
  onOpen(): void;
}

/** Sharing a review: the comparison and its review as one file, locked with a password if wished; or opening one. */
export function ShareMenu({ canSave, author, onAuthor, onSave, onOpen }: ShareMenuProps) {
  const [password, setPassword] = useState('');
  return (
    <div className="menu share-menu" role="dialog" aria-label="Share the review">
      <div className="menu-title">Share the review</div>
      <p className="menu-note">
        A review file holds both documents and your notes, highlights, reactions and decisions. Send it to anyone with Collate: they open it here and carry on.
      </p>
      {canSave && (
        <>
          <label className="rl-field">
            <span>Your name on your notes</span>
            <input type="text" value={author} placeholder="Anonymous" maxLength={80} onChange={(e) => onAuthor(e.currentTarget.value)} />
          </label>
          <label className="rl-field">
            <span>Password (optional)</span>
            <input type="password" data-share="password" value={password} autoComplete="new-password" placeholder="Lock the file with a password" onChange={(e) => setPassword(e.currentTarget.value)} />
          </label>
          <button type="button" className="btn primary rl-download" data-share="save" data-autofocus onClick={() => onSave(password)}>
            <Ico name="download" />
            <span>{password ? 'Save locked review file' : 'Save review file'}</span>
          </button>
        </>
      )}
      <button type="button" className="mi" role="menuitem" data-share="open" onClick={onOpen}>
        <Ico name="open" />
        <span>Open a review file…</span>
      </button>
    </div>
  );
}
