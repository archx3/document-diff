/** Saving files and writing to the clipboard, in a normal browser tab or inside a sandboxed viewer. */

type DownloadsApi = { save(req: { filename: string; data: Blob | Uint8Array | string }): Promise<{ status: string }> };
type ClaudeHost = { use?: (name: string) => Promise<unknown> };

let downloads: Promise<DownloadsApi | null> | null = null;
let known: boolean | undefined;

function hostDownloads(): Promise<DownloadsApi | null> {
  const claude = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!claude?.use) return Promise.resolve(null);
  downloads ??= claude
    .use('downloads')
    .then((d) => (d as DownloadsApi | null) ?? null)
    .catch(() => null)
    .then((d) => {
      known = !!d;
      return d;
    });
  return downloads;
}

/** Whether files are saved through a hosting viewer (which only accepts some file types). Best known answer now. */
export function inViewer(): boolean {
  if (known === undefined) void hostDownloads();
  return !!known;
}

/** Resolves once it is known whether a hosting viewer saves files. */
export async function viewerReady(): Promise<boolean> {
  return !!(await hostDownloads());
}

export type SaveOutcome = 'saved' | 'declined' | 'unsupported' | 'busy' | 'failed';

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const host = await hostDownloads();
  if (host) {
    try {
      await host.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return 'declined';
      if (code === 'rejected_extension' || code === 'extension_not_enabled') return 'unsupported';
      if (code === 'rate_limited') return 'busy';
      return 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export type CopyOutcome = 'rich' | 'plain' | 'failed';

/** Copies HTML with a plain-text alternative. Must be called from a click handler. */
export async function copyRich(html: string, text: string): Promise<CopyOutcome> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return 'rich';
    }
  } catch {
    /* fall through */
  }
  try {
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;opacity:0;pointer-events:none';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    holder.remove();
    if (ok) return 'rich';
  } catch {
    /* fall through */
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'plain';
  } catch {
    return 'failed';
  }
}
