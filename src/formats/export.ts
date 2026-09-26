import type { Doc } from '../core/model';
import { DocxPackage } from './docx/package';
import { exportDocx } from './docx/writer';
import { docToHtml, docToMarkdown, docToText } from './html/write';
import { OdtPackage } from './odt/package';
import { exportOdt } from './odt/writer';
import { docToRtf } from './rtf/write';
import { docToDelimited, docToPlainLines, textFormat } from './text/plain';

/** A file a document can be saved as. */
export interface ExportFormat {
  id: string;
  label: string;
  hint?: string;
  ext: string;
  mime: string;
  build: (doc: Doc) => Uint8Array | string;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Formats for a document, its own format first. */
export function exportFormats(doc: Doc): ExportFormat[] {
  const inPlaceWord = doc.pkg instanceof DocxPackage;
  const odtPkg = doc.pkg instanceof OdtPackage ? doc.pkg : undefined;
  const word: ExportFormat = {
    id: 'docx',
    label: 'Word document',
    hint: inPlaceWord ? 'Keeps the original styles, headers and layout' : doc.kind === 'doc' ? 'Word 97–2003 files are saved in today’s Word format' : 'A new Word file',
    ext: 'docx',
    mime: DOCX_MIME,
    build: exportDocx,
  };
  const odt: ExportFormat = {
    id: 'odt',
    label: 'OpenDocument text',
    hint: odtPkg ? 'Keeps the original styles and layout' : 'For LibreOffice and other office apps',
    ext: odtPkg?.flat ? 'fodt' : 'odt',
    mime: odtPkg?.flat ? 'application/vnd.oasis.opendocument.text-flat-xml' : 'application/vnd.oasis.opendocument.text',
    build: exportOdt,
  };
  const rtf: ExportFormat = { id: 'rtf', label: 'Rich Text', hint: 'Opens in almost any word processor', ext: 'rtf', mime: 'application/rtf', build: docToRtf };
  const html: ExportFormat = { id: 'html', label: 'Web page', ext: 'html', mime: 'text/html', build: docToHtml };
  const md: ExportFormat = { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown', build: docToMarkdown };
  const txt: ExportFormat = { id: 'txt', label: 'Plain text', ext: 'txt', mime: 'text/plain', build: (d) => (d.kind === 'text' ? docToPlainLines(d) : docToText(d)) };
  switch (doc.kind) {
    case 'odt':
      return [odt, word, rtf, html, md, txt];
    case 'rtf':
      return [{ ...rtf, hint: 'Saved as a new Rich Text file' }, word, odt, html, md, txt];
    case 'markdown':
      return [md, word, odt, rtf, html, txt];
    case 'csv': {
      const tab = doc.delimiter === '\t';
      const own: ExportFormat = {
        id: 'csv',
        label: tab ? 'Tab-separated values' : 'Comma-separated values',
        hint: 'Same format, one row per line',
        ext: doc.ext === 'tsv' || doc.ext === 'tab' ? doc.ext : tab ? 'tsv' : 'csv',
        mime: tab ? 'text/tab-separated-values' : 'text/csv',
        build: (d) => docToDelimited(d),
      };
      return [own, word, odt, html, md, txt];
    }
    case 'text': {
      const ext = doc.ext && doc.ext !== 'txt' && textFormat(doc.ext) ? doc.ext : 'txt';
      if (ext === 'txt') return [txt, word, odt, rtf, html, md];
      const own: ExportFormat = { id: 'native', label: `${doc.formatLabel ?? 'Text'} file`, hint: `Same format (.${ext})`, ext, mime: 'text/plain', build: docToPlainLines };
      return [own, txt, word, odt, html, md];
    }
    default:
      return [word, odt, rtf, html, md, txt];
  }
}

/** File extensions a viewer's download capability accepts (see its allowlist). */
export const VIEWER_EXTENSIONS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip']);
