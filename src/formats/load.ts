import { unzipSync } from 'fflate';
import type { Doc } from '../core/model';
import { isCfb } from './doc/cfb';
import { readDoc } from './doc/read';
import { readDocx } from './docx/read';
import { readEpub } from './epub/read';
import { pasteSource, readHtml } from './html/read';
import { readOdt } from './odt/read';
import { readRtf } from './rtf/read';
import { isDelimited, readDelimited, readPlainText, textFormat } from './text/plain';
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

/** Every extension the file picker offers (other files can still be dropped). */
export const ACCEPTED_EXTENSIONS = [
  'docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'fodt', 'rtf', 'pdf', 'epub',
  'html', 'htm', 'xhtml', 'mht', 'mhtml', 'md', 'markdown', 'txt', 'csv', 'tsv', 'gdoc',
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'tex', 'bib', 'rst', 'adoc', 'org', 'srt', 'vtt', 'sql',
];

export type SniffedKind = 'pdf' | 'rtf' | 'cfb' | 'docx' | 'odt' | 'epub' | 'zip' | 'fodt' | 'text';

const decoder = new TextDecoder();

/** What a file really is, from its first bytes (extensions are often wrong: .doc files are frequently RTF or HTML). */
export function sniff(bytes: Uint8Array, ext = ''): { kind: SniffedKind; detail?: string } {
  const head = decoder.decode(bytes.subarray(0, 1024));
  // A PDF starts with its header, though some writers put a few bytes before it.
  if (/^\s*%PDF-\d/.test(head.replace(/^\ufeff/, '')) || (ext === 'pdf' && /%PDF-\d/.test(head))) return { kind: 'pdf' };
  if (/^\s*\{\\rtf/.test(head)) return { kind: 'rtf' };
  if (isCfb(bytes)) return { kind: 'cfb' };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let entries: Record<string, Uint8Array> = {};
    try {
      entries = unzipSync(bytes, { filter: (f) => f.name === 'mimetype' || f.name === '[Content_Types].xml' || f.name === 'META-INF/container.xml' });
    } catch {
      return { kind: 'zip', detail: 'damaged' };
    }
    if (entries['[Content_Types].xml']) {
      const types = decoder.decode(entries['[Content_Types].xml']);
      if (/wordprocessingml/.test(types)) return { kind: 'docx' };
      if (/spreadsheetml/.test(types)) return { kind: 'zip', detail: 'an Excel workbook' };
      if (/presentationml/.test(types)) return { kind: 'zip', detail: 'a PowerPoint presentation' };
      return { kind: 'docx' };
    }
    const mime = entries.mimetype ? decoder.decode(entries.mimetype).trim() : '';
    if (/opendocument\.text/.test(mime)) return { kind: 'odt' };
    if (mime === 'application/epub+zip' || entries['META-INF/container.xml']) return { kind: 'epub' };
    if (/opendocument\.spreadsheet/.test(mime)) return { kind: 'zip', detail: 'an OpenDocument spreadsheet' };
    if (/opendocument\.presentation/.test(mime)) return { kind: 'zip', detail: 'an OpenDocument presentation' };
    return { kind: 'zip' };
  }
  // (Comment markers are written as <!-{2} so this file can be inlined in a <script> element.)
  if (/^\s*(<\?xml[^>]*>\s*)?(<!-{2}[\s\S]*?-{2}>\s*)*<office:document\b/.test(head)) return { kind: 'fodt' };
  return { kind: 'text' };
}

/** Text of a file: UTF-8 or UTF-16 with a byte order mark, falling back to Windows-1252 for old files. */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The HTML part of a MIME web archive (.mht, and ".doc" files saved as web pages). */
export function mhtmlToHtml(text: string): string | undefined {
  const boundary = /boundary="?([^"\r\n;]+)"?/i.exec(text)?.[1];
  const parts = boundary ? text.split('--' + boundary) : [text];
  for (const part of parts) {
    const split = part.search(/\r?\n\r?\n/);
    if (split < 0) continue;
    const headers = part.slice(0, split);
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    let body = part.slice(split).replace(/^\r?\n\r?\n/, '');
    if (/content-transfer-encoding:\s*quoted-printable/i.test(headers)) {
      const bytes: number[] = [];
      const raw = body.replace(/=\r?\n/g, '');
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i] === '=' ? /^[0-9A-Fa-f]{2}/.exec(raw.slice(i + 1, i + 3)) : null;
        if (m) {
          bytes.push(parseInt(m[0], 16));
          i += 2;
        } else {
          const c = raw.charCodeAt(i);
          if (c < 0x80) bytes.push(c);
          else bytes.push(...new TextEncoder().encode(raw[i]!));
        }
      }
      const charset = /charset="?([\w-]+)/i.exec(headers)?.[1] ?? 'utf-8';
      try {
        body = new TextDecoder(charset).decode(new Uint8Array(bytes));
      } catch {
        body = new TextDecoder().decode(new Uint8Array(bytes));
      }
    } else if (/content-transfer-encoding:\s*base64/i.test(headers)) {
      body = decodeBytes(Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
    }
    return body;
  }
  return undefined;
}

function wrap<T>(name: string, what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof LoadError) throw e;
    throw new LoadError(`"${name}" could not be read as ${what}. ${(e as Error).message}`);
  }
}

const UNSUPPORTED: Record<string, string> = {
  pages: 'an Apple Pages document. In Pages, use File › Export To › Word, then load that file.',
  wpd: 'a WordPerfect document. Save it as Word (.docx) or RTF, then load that file.',
  hwp: 'a Hangul document. Save it as Word (.docx), then load that file.',
  xps: 'an XPS document. Print it to PDF, then load that file.',
  oxps: 'an XPS document. Print it to PDF, then load that file.',
};

/** Reads a user-supplied file into a document. */
export async function loadFile(file: Blob & { name: string }): Promise<Doc> {
  const name = file.name || 'Untitled';
  const ext = extension(name);
  if (ext === 'gdoc') {
    let id: string | undefined;
    try {
      const info = JSON.parse(await file.text()) as { doc_id?: string; url?: string };
      id = info.doc_id ?? /\/d\/([\w-]+)/.exec(info.url ?? '')?.[1];
    } catch {
      /* not JSON */
    }
    throw new LoadError(`"${name}" is a shortcut to a Google Doc, not the document itself.`, id);
  }
  if (UNSUPPORTED[ext]) throw new LoadError(`"${name}" is ${UNSUPPORTED[ext]}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { kind, detail } = sniff(bytes, ext);
  switch (kind) {
    case 'pdf': {
      const { PdfPasswordError, readPdf } = await import('./pdf/read');
      try {
        return await readPdf(bytes, name);
      } catch (e) {
        if (e instanceof PdfPasswordError) throw new LoadError(e.message);
        throw new LoadError(`"${name}" could not be read as a PDF. ${(e as Error).message}`);
      }
    }
    case 'rtf':
      return wrap(name, 'a Rich Text file', () => readRtf(bytes, name));
    case 'cfb':
      return wrap(name, 'a Word 97–2003 document', () => readDoc(bytes, name));
    case 'docx':
      return wrap(name, 'a Word document', () => readDocx(bytes, name));
    case 'odt':
    case 'fodt':
      return wrap(name, 'an OpenDocument text', () => readOdt(bytes, name));
    case 'epub':
      return wrap(name, 'an EPUB book', () => readEpub(bytes, name));
    case 'zip':
      throw new LoadError(
        detail === 'damaged'
          ? `"${name}" is damaged (it could not be unzipped).`
          : detail
            ? `"${name}" is ${detail}. Only text documents can be compared.`
            : `"${name}" is a zip archive, not a document. Unzip it and load the document inside.`,
      );
  }
  const text = decodeBytes(bytes);
  if (/^MIME-Version:/im.test(text.slice(0, 2000)) && /multipart\/related/i.test(text.slice(0, 4000))) {
    const html = mhtmlToHtml(text);
    if (html) return { ...readHtml(html, name), formatLabel: 'Web archive' };
  }
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml' || ((ext === 'doc' || ext === 'dot') && looksLikeHtml(text))) return readHtml(text, name);
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return readMarkdown(text, name);
  if (isDelimited(ext)) return readDelimited(text, name, ext);
  if (textFormat(ext)) return readPlainText(text, name, ext);
  if (ext === 'doc' || ext === 'dot') throw new LoadError(`"${name}" is not a Word document this tool can read.`);
  if (text.includes('\u0000') || /[\u0001-\u0008\u000e-\u001f]/.test(text.slice(0, 4000)))
    throw new LoadError(`"${name}" is not a document this tool can read. Use Word, OpenDocument, PDF, RTF, EPUB, HTML, Markdown, CSV or text files.`);
  if (looksLikeHtml(text)) return readHtml(text, name);
  return ext ? readPlainText(text, name, ext) : readText(text, name);
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
  return { doc: { ...readText(text, name ?? 'Pasted text'), formatLabel: 'Pasted' }, source: 'text' };
}

/** Extracts a Google Docs document id from a link, or undefined. */
export function googleDocId(input: string): string | undefined {
  const s = input.trim();
  const m = /docs\.google\.com\/(?:a\/[^/]+\/)?document\/(?:u\/\d+\/)?d\/([\w-]{20,})/.exec(s) ?? /[?&]id=([\w-]{20,})/.exec(s);
  if (m) return m[1];
  if (/^[\w-]{25,}$/.test(s)) return s;
  return undefined;
}
