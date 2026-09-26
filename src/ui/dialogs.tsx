import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Ico } from '../components/icons';
import { googleDocId } from '../formats/load';
import type { LoadKind } from './empty';
import type { Side } from './util';
import { SIDE_NAME } from './util';

export type DialogState = { type: 'paste'; side: Side } | { type: 'gdoc'; side: Side; presetId?: string } | { type: 'help' };

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
            Load two versions of a document as <b>A</b> and <b>B</b>. Paragraphs are lined up side by side. Words only in A are marked in red, words only in B in green; a caret marks
            where the other side has extra text.
          </p>
          <h3>Find your way</h3>
          <p>
            The ruler between the columns has a mark for every change: click one to go to it, or drag the frame to scroll. The minimap shows each document in miniature on either
            side of the ruler. The list of changes names every change with its words; click one to go there. Line numbers count the paragraphs of each document (the lines of a
            text file).
          </p>
          <h3>Copy changes</h3>
          <p>
            Use the arrows beside the ruler to copy a paragraph across:{' '}
            <span className="k">
              <Ico name="toB" />
            </span>{' '}
            makes B use A’s version,{' '}
            <span className="k">
              <Ico name="toA" />
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
            <Key keys={['C']} what="Show changes only" />
            <Key keys={['S']} what="List of changes" />
            <Key keys={['M']} what="Minimap" />
            <Key keys={['L']} what="Line numbers" />
            <Key keys={['?']} what="This help" />
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
