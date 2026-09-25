import type { Doc } from '../core/model';
import { readDocx } from './docx/read';
import { pasteSource, readHtml } from './html/read';
import { readMarkdown, readText } from './text/read';

export class LoadError extends Error {
  constructor(
    message: string,
    /** Google Docs document id, when the file was a Google Drive shortcut. */
    readonly googleDocId?: string,
  ) {
    super(message);
  }
}

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html|<body|<meta|<p[\s>]|<div[\s>]|<h[1-6][\s>])/i.test(text);
}

/** Reads a user-supplied file into a document. */
export async function loadFile(file: Blob & { name: string }): Promise<Doc> {
  const name = file.name || 'Untitled';
  const ext = extension(name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  switch (ext) {
    case 'doc':
      throw new LoadError(`"${name}" is an old Word 97–2003 file. Open it in Word and use File › Save As › Word Document (.docx), then load that file.`);
    case 'odt':
      throw new LoadError(`"${name}" is an OpenDocument file. Save it as Word Document (.docx) from LibreOffice or Google Docs, then load that file.`);
    case 'pdf':
      throw new LoadError(`"${name}" is a PDF. Load the original Word or Google Docs document instead (in Google Docs: File › Download › Microsoft Word).`);
    case 'rtf':
      throw new LoadError(`"${name}" is a Rich Text file. Save it as Word Document (.docx) and load that file.`);
    case 'gdoc': {
      let id: string | undefined;
      try {
        const info = JSON.parse(new TextDecoder().decode(bytes)) as { doc_id?: string; url?: string };
        id = info.doc_id ?? /\/d\/([\w-]+)/.exec(info.url ?? '')?.[1];
      } catch {
        /* not JSON */
      }
      throw new LoadError(`"${name}" is a shortcut to a Google Doc, not the document itself.`, id);
    }
  }
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx' || ext === 'dotm' || (isZip && !['html', 'htm', 'md', 'txt'].includes(ext))) {
    try {
      return readDocx(bytes, name);
    } catch (e) {
      throw new LoadError(`"${name}" could not be read as a Word document. ${(e as Error).message}`);
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return readHtml(text, name);
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown') return readMarkdown(text, name);
  if (ext === 'txt' || ext === 'text') return readText(text, name);
  if (text.includes('\u0000')) throw new LoadError(`"${name}" is not a document this tool can read. Use .docx, .html, .md or .txt.`);
  return looksLikeHtml(text) ? readHtml(text, name) : readText(text, name);
}

export interface PasteResult {
  doc: Doc;
  source: 'google-docs' | 'word' | 'web' | 'text';
}

/** Builds a document from clipboard contents (rich text preferred). */
export function loadPaste(html: string, text: string, name?: string): PasteResult {
  if (html.trim()) {
    const source = pasteSource(html);
    const label = name ?? (source === 'google-docs' ? 'Pasted from Google Docs' : source === 'word' ? 'Pasted from Word' : 'Pasted text');
    const doc = readHtml(html, label);
    if (doc.blocks.length) return { doc, source };
  }
  return { doc: readText(text, name ?? 'Pasted text'), source: 'text' };
}

/** Extracts a Google Docs document id from a link, or undefined. */
export function googleDocId(input: string): string | undefined {
  const s = input.trim();
  const m = /docs\.google\.com\/(?:a\/[^/]+\/)?document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(s) ?? /[?&]id=([\w-]{20,})/.exec(s);
  if (m) return m[1];
  if (/^[\w-]{25,}$/.test(s)) return s;
  return undefined;
}
