import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Ico } from '../components/icons';
import type { HistoryStep } from '../core/versions';
import type { ImageSide } from './image/use-image-compare';
import type { DriveRef, DriveRevision } from '../lib/cloud';
import { driveRevisions } from '../lib/cloud';
import { googleDocId } from '../formats/load';
import type { LoadKind } from './empty';
import type { Side } from './util';
import { SIDE_NAME } from './util';

export type DialogState =
  | { type: 'paste'; side: Side }
  | { type: 'gdoc'; side: Side; presetId?: string }
  | { type: 'help' }
  /** One paragraph through every version. */
  | { type: 'history'; steps: HistoryStep[] }
  /** A review file locked with a password. */
  | { type: 'unlock'; name: string; bytes: Uint8Array; error?: string }
  /** Two versions of a picture, compared. */
  | { type: 'pictures'; a: ImageSide; b: ImageSide }
  /** Earlier versions of a Google Drive file, to compare with; the one chosen goes in `side`. */
  | { type: 'revisions'; side: Side; ref: DriveRef };

interface DialogProps {
  className: string;
  /** It closed: Escape, the close button or a click on the backdrop. */
  onClose(): void;
  children: ReactNode;
  ref?: Ref<HTMLDialogElement>;
}

/**
 * A modal dialog. It opens in a layout effect, before its content's effects
 * run, so the content can move focus into itself.
 */
export function Dialog({ className, onClose, children, ref }: DialogProps) {
  const el = useRef<HTMLDialogElement | null>(null);
  useLayoutEffect(() => {
    if (el.current && !el.current.open) el.current.showModal();
  }, []);
  return (
    <dialog
      className={`dlg ${className}`}
      id="dlg"
      ref={(d) => {
        el.current = d;
        if (typeof ref === 'function') ref(d);
        else if (ref) ref.current = d;
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <button type="button" className="dlg-x btn ghost icon-only" data-close aria-label="Close" onClick={() => el.current?.close()}>
        <Ico name="close" />
      </button>
      {children}
    </dialog>
  );
}

/** A Drive file's earlier versions: the one chosen is compared with the file as it is now. */
export function RevisionsDialog({ file, onPick }: { file: DriveRef; onPick(rev: DriveRevision): void }) {
  const [list, setList] = useState<DriveRevision[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    driveRevisions(file).then(
      (l) => live && setList(l),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return (
    <>
      <h2>Earlier versions of “{file.name}”</h2>
      <p>Choose a version to compare with the file as it is now.</p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="hint">Getting the versions from Google Drive…</p>}
      {list && !list.length && <p className="hint">Google Drive has no earlier versions of this file.</p>}
      {list && list.length > 0 && (
        <ul className="revisions">
          {list.map((r, i) => (
            <li key={r.id}>
              <button type="button" className="mi" data-revision={r.id} onClick={() => onPick(r)}>
                <Ico name="undo" />
                <span>{new Date(r.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <small>{[i === 0 && 'The latest', r.by].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The password for a locked review file. */
export function UnlockDialog({ name, error, onUnlock }: { name: string; error?: string; onUnlock(password: string): void }) {
  const [password, setPassword] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (password) onUnlock(password);
      }}
    >
      <h2>Open “{name}”</h2>
      <p>This review file is locked. Enter the password it was saved with.</p>
      <input className="field" type="password" aria-label="Password" data-unlock="password" value={password} ref={input} onChange={(e) => setPassword(e.currentTarget.value)} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="dlg-actions">
        <button type="submit" className="btn primary" data-unlock="open" disabled={!password}>
          Open
        </button>
      </div>
    </form>
  );
}

/** Rich text pasted from Google Docs or Word, which keeps its headings, lists, tables and links. */
export function PasteDialog({ side, onPaste }: { side: Side; onPaste(html: string, text: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    <>
      <h2>Paste into {SIDE_NAME[side]}</h2>
      <p>
        In Google Docs or Word, select the whole document (<kbd>Ctrl</kbd>+<kbd>A</kbd>, or <kbd>⌘</kbd>+<kbd>A</kbd> on a Mac) and copy it. Then paste it into the box below.
        Headings, lists, tables, bold, italic and links are kept.
      </p>
      <div
        className="pastebox"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Paste area"
        data-side={side}
        ref={box}
        onPaste={(e) => {
          e.preventDefault();
          onPaste(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'));
        }}
        // Browsers that insert the content without a usable paste event.
        onInput={(e) => {
          const el = e.currentTarget;
          if (el.innerText.trim()) onPaste(el.innerHTML, el.innerText);
        }}
      />
      <p className="hint">To keep page layout, headers and styles when you export, load a .docx file instead.</p>
    </>
  );
}

/**
 * Browsers don't let other sites read Google Docs, so this builds the link that
 * downloads the document as Word, then takes the downloaded file.
 */
export function GoogleDocDialog({ side, presetId, onLoad }: { side: Side; presetId?: string; onLoad(kind: LoadKind, side: Side): void }) {
  const [url, setUrl] = useState(presetId ? `https://docs.google.com/document/d/${presetId}/edit` : '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!presetId) input.current?.focus();
  }, [presetId]);
  const id = googleDocId(url);
  return (
    <>
      <h2>Load a Google Doc as {SIDE_NAME[side]}</h2>
      <p>
        Browsers don’t let other sites read Google Docs directly, so this takes two quick steps. Private documents work too, because the download uses your own Google sign-in.
      </p>
      <label className="form-field">
        <span>Google Docs link</span>
        <input
          id="gd-url"
          ref={input}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://docs.google.com/document/d/…"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
      </label>
      <ol className="steps">
        <li>
          <span className="step-n">1</span>
          <div>
            <a
              id="gd-dl"
              className="btn primary"
              target="_blank"
              rel="noopener noreferrer"
              href={id ? `https://docs.google.com/document/d/${id}/export?format=docx` : undefined}
              aria-disabled={id ? undefined : 'true'}
            >
              <Ico name="download" />
              <span>Download it as Word (.docx)</span>
            </a>
            <p className="hint" id="gd-hint">
              {id ? 'Opens a new tab; your browser saves the .docx file.' : url.trim() ? 'That doesn’t look like a Google Docs link.' : 'Paste the link above first.'}
            </p>
          </div>
        </li>
        <li>
          <span className="step-n">2</span>
          <div className="dropzone" data-side={side}>
            <span>Drop the downloaded file here, or</span>{' '}
            <button type="button" className="btn sm" data-load="file" data-side={side} onClick={() => onLoad('file', side)}>
              <Ico name="open" />
              <span>choose it</span>
            </button>
          </div>
        </li>
      </ol>
      <p className="hint">
        Or open the document, copy all of it, and use{' '}
        <button type="button" className="linkbtn" data-load="paste" data-side={side} onClick={() => onLoad('paste', side)}>
          Paste text
        </button>{' '}
        instead.
      </p>
    </>
  );
}

export function HelpDialog() {
  return (
    <>
      <h2>How Collate works</h2>
      <div className="help-cols">
        <section>
          <h3>Compare</h3>
          <p>
            Load two versions of a document as <b>A</b> and <b>B</b>. Words only in A are marked in red, words only in B in green; a caret marks where the other side has extra text.
          </p>
          <p>
            <b>Side by side</b> shows each document in its own column. With <b>connection bands</b> on, each runs on unbroken and the columns slide against each other as you scroll,
            so what is level with the middle of the screen matches; a band joins each change to the other side. With them off, the paragraphs are lined up in rows, with a gap where
            one side has nothing. <b>Unified</b> shows one column, with A’s version above B’s wherever they differ.
          </p>
          <h3>Find your way</h3>
          <p>
            The ruler between the columns has a mark for every change: click one to go to it, or drag the frame to scroll. The minimap shows each document in miniature on either
            side of the ruler. The list of changes names every change with its words; click one to go there. Line numbers count the paragraphs of each document (the lines of a
            text file).
          </p>
          <h3>Copy changes</h3>
          <p>
            Use the arrows beside the ruler to copy a paragraph (with connection bands, a whole change) across:{' '}
            <span className="k">
              <Ico name="chevronsRight" />
            </span>{' '}
            makes B use A’s version,{' '}
            <span className="k">
              <Ico name="chevronsLeft" />
            </span>{' '}
            makes A use B’s version. Click a highlighted word to copy just that edit. Tables can be copied row by row.
          </p>
          <h3>Get the result</h3>
          <p>
            <b>Export</b> saves a document in its own format first. Word (.docx) and OpenDocument (.odt) files keep their own styles, headers, footers and page setup, with only the
            copied paragraphs changed. Any document can also be saved as Word, PDF, OpenDocument, RTF, a web page, Markdown or plain text. A PDF is laid out afresh on A4 pages;
            saving the first one loads the PDF maker, which needs an internet connection.
          </p>
          <p>
            For Google Docs, either upload the .docx to Drive and open it with Google Docs, or use <b>Copy formatted text</b> and paste over the document’s contents.
          </p>
          <h3>File types</h3>
          <p>
            Word (.docx and older .doc), Google Docs, PDF, OpenDocument (.odt), RTF, EPUB, web pages, Markdown, CSV and plain text files, including code and data. PDFs, EPUBs and .doc
            files can be compared and copied from. A PDF is saved as a new PDF (or in another format); EPUB and .doc files are saved in another format.
          </p>
        </section>
        <section>
          <h3>Keyboard</h3>
          <dl className="keys">
            <Key keys={['N', 'P']} what="Next / previous change" />
            <Key keys={['Page Down', 'Page Up']} what="Next / previous page" />
            <Key keys={['Alt', '→']} plus what="Use A’s version in B" />
            <Key keys={['Alt', '←']} plus what="Use B’s version in A" />
            <Key keys={['Ctrl', 'Z']} plus what="Undo" />
            <Key keys={['Ctrl', 'Shift', 'Z']} plus what="Redo" />
            <Key keys={['A']} what="Accept the change and go to the next" />
            <Key keys={['X']} what="Reject the change and go to the next" />
            <Key keys={['R']} what="Review mode: notes, highlights and reactions" />
            <Key keys={['G']} what="Spelling and grammar" />
            <Key keys={['C']} what="Show changes only" />
            <Key keys={['S']} what="List of changes" />
            <Key keys={['V']} what="Side by side / unified" />
            <Key keys={['B']} what="Connection bands" />
            <Key keys={['M']} what="Minimap" />
            <Key keys={['L']} what="Line numbers" />
            <Key keys={['?']} what="This help" />
          </dl>
          <h3>Pictures</h3>
          <dl className="keys">
            <Key keys={['1', '2', '3', '4']} what="Side by side, swipe, onion skin, difference" />
            <Key keys={['N', 'P']} what="Next / previous changed area (zoomed in)" />
            <Key keys={['+', '−', '0']} what="Zoom in, out, fit" />
          </dl>
          <h3>Audio</h3>
          <dl className="keys">
            <Key keys={['Space']} what="Play / pause" />
            <Key keys={['N', 'P']} what="Next / previous difference" />
            <Key keys={['A', 'B']} what="Listen to A or B, at the same moment" />
            <Key keys={['L']} what="Loop the difference" />
            <Key keys={['T']} what="Transcribe, or show the transcripts" />
            <Key keys={['T', 'Esc']} what="Stop transcribing" />
            <Key keys={['1', '2', '3']} what="Waveform, spectrogram, loudness" />
            <Key keys={['←', '→']} what="Back or on 5 seconds" />
          </dl>
          <h3>What is compared</h3>
          <p>
            The text of the document body: paragraphs, headings, lists, tables, links, images, footnote text and basic formatting. Headers, footers and comments are left as they are.
            A PDF stores laid-out text rather than paragraphs, so Collate rebuilds them; its pictures and page numbers can’t be matched to another format’s.
          </p>
          <h3>Privacy</h3>
          <p>Documents are read and written inside this browser tab. Nothing is uploaded. The first PDF you open or save may download a PDF library; your document stays here.</p>
        </section>
      </div>
    </>
  );
}

/** A shortcut: keys pressed together (`plus`) or alternatives. */
function Key({ keys, plus, what }: { keys: string[]; plus?: boolean; what: string }) {
  return (
    <>
      <dt>
        {keys.map((k, i) => (
          <span key={k}>
            {i > 0 && (plus ? '+' : ' / ')}
            <kbd>{k}</kbd>
          </span>
        ))}
      </dt>
      <dd>{what}</dd>
    </>
  );
}
