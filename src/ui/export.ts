import { zipSync } from 'fflate';
import type { Doc } from '../core/model';
import { VIEWER_EXTENSIONS, exportFormats } from '../formats/export';
import { blocksToHtml, docToText } from '../formats/html/write';
import { copyRich, saveFile, viewerReady } from './files';
import type { ToastFn } from './toasts';

interface ExportUi {
  toast: ToastFn;
  /** Shows (or, with '', hides) a message over the page while work is under way. */
  busy(message: string): void;
}

/**
 * Saves a document in one of its export formats as `base`.ext, or copies it
 * with its formatting ("copy"), and says how that went. Copying must start
 * from a click, so it happens before anything is awaited.
 */
export async function exportDocument(doc: Doc, sideName: string, format: string, base: string, ui: ExportUi): Promise<void> {
  const { toast } = ui;
  try {
    if (format === 'copy') {
      const html = `<meta charset="utf-8">${blocksToHtml(doc.blocks)}`;
      const res = await copyRich(html, docToText(doc));
      if (res === 'rich') toast(`Copied ${sideName} with formatting. Paste it into Google Docs or Word.`);
      else if (res === 'plain') toast(`Copied ${sideName} as plain text (this browser blocked formatted copying).`);
      else toast('The clipboard is not available here. Use Download instead.', { error: true });
      return;
    }
    const fmt = exportFormats(doc).find((f) => f.id === format);
    if (!fmt) return;
    let name = `${base}.${fmt.ext}`;
    if (fmt.id === 'pdf') ui.busy('Making the PDF…');
    let out: Uint8Array | string;
    try {
      out = await fmt.build(doc);
    } finally {
      ui.busy('');
    }
    let blob = new Blob([out as BlobPart], { type: fmt.mime });
    if ((await viewerReady()) && !VIEWER_EXTENSIONS.has(fmt.ext)) {
      // This viewer only saves some file types; the file travels inside a zip.
      const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
      blob = new Blob([zipSync({ [name]: [bytes, { level: 6 }] }) as BlobPart], { type: 'application/zip' });
      name += '.zip';
    }
    const res = await saveFile(name, blob);
    if (res === 'saved') toast(`Downloaded “${name}”`);
    else if (res === 'unsupported') toast(`This viewer can’t save .${name.split('.').pop()} files. Choose another format.`, { error: true });
    else if (res === 'busy') toast('A save is already waiting for your answer.', { error: true });
    else if (res === 'failed') toast('The file could not be saved from this page.', { error: true });
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${(err as Error).message}`, { error: true });
  }
}

/** Prints one document on its own (the print dialog can also save it as PDF). */
export function printDocument(doc: Doc, title: string, unavailable: () => void): void {
  const root = document.createElement('div');
  root.id = 'print-root';
  root.innerHTML = `<article class="print-doc">${blocksToHtml(doc.blocks)}</article>`;
  document.body.appendChild(root);
  const oldTitle = document.title;
  document.title = title;
  document.documentElement.classList.add('printing');
  let opened = false;
  const before = () => {
    opened = true;
  };
  const cleanup = () => {
    root.remove();
    document.title = oldTitle;
    document.documentElement.classList.remove('printing');
    window.removeEventListener('beforeprint', before);
  };
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', cleanup, { once: true });
  try {
    window.print();
  } catch {
    /* blocked */
  }
  // A page shown inside a viewer may not be allowed to open the print dialog.
  setTimeout(() => {
    if (opened) return;
    cleanup();
    unavailable();
  }, 400);
}
