import { useEffect, useState } from 'react';
import { importSvg, deleteSelection, pasteNodes, selectionAsSvg, toast } from '../state/actions';
import { handleKeyDown, isTyping } from '../state/shortcuts';
import { store, useEditor } from '../state/store';
import { Canvas } from './Canvas';
import { CodePanel } from './CodePanel';
import { ExportDialog, HelpDialog } from './Dialogs';
import { Inspector } from './Inspector';
import { Layers } from './Layers';
import { Preview } from './Preview';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

const looksLikeSvg = (t: string) => /<svg[\s>]|<(path|rect|circle|ellipse|line|polyline|polygon|g)[\s>/]/i.test(t) || /^\s*[Mm][\s\d.-]/.test(t);

function Toast() {
  const toast = useEditor((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite" key={toast.id} data-testid="toast">
      {toast.text}
    </div>
  );
}

export function App() {
  const [codeOpen, setCodeOpen] = useState(false);
  const [dialog, setDialog] = useState<'export' | 'help' | null>(null);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => handleKeyDown(e, { openHelp: () => setDialog('help'), openExport: () => setDialog('export') });
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (isTyping(e.target) || window.getSelection()?.toString()) return;
      const svg = selectionAsSvg();
      if (!svg || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', svg);
      e.clipboardData.setData('image/svg+xml', svg);
      e.preventDefault();
      if (cut) deleteSelection();
      toast(cut ? 'Cut' : 'Copied');
    };
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text && looksLikeSvg(text)) {
        e.preventDefault();
        importSvg(text, 'insert');
      } else {
        const clip = store.get().clipboard;
        if (clip) {
          e.preventDefault();
          pasteNodes(clip);
        }
      }
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') return toast('That is not an SVG file', true);
      // Dropping with Alt held adds the file to the drawing instead of replacing it.
      if (importSvg(await f.text(), e.altKey ? 'insert' : 'replace') && !e.altKey) store.patch({ name: f.name.replace(/\.svg$/i, '') || 'untitled' });
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    window.addEventListener('keydown', keydown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', paste);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', paste);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="studio">
      <TopBar codeOpen={codeOpen} onToggleCode={() => setCodeOpen((v) => !v)} onExport={() => setDialog('export')} onHelp={() => setDialog('help')} />
      <div className="workspace">
        <Toolbar />
        <main className="stage">
          <Canvas />
          {codeOpen && <CodePanel onClose={() => setCodeOpen(false)} />}
        </main>
        <aside className="side" aria-label="Panels">
          <Preview />
          <Layers />
          <div className="side-scroll">
            <Inspector />
          </div>
        </aside>
      </div>
      <Toast />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
