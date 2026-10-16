import { useRef } from 'react';
import { importSvg, newDocument, resizeCanvas, toast } from '../state/actions';
import { store, useEditor } from '../state/store';
import { IconButton } from './fields';
import { Icon } from './icons';
import { currentTheme, toggleTheme } from './theme';
import { useState } from 'react';

interface Props {
  codeOpen: boolean;
  onToggleCode(): void;
  onExport(): void;
  onHelp(): void;
}

export function TopBar({ codeOpen, onToggleCode, onExport, onHelp }: Props) {
  const name = useEditor((s) => s.name);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const width = useEditor((s) => s.doc.width);
  const height = useEditor((s) => s.doc.height);
  const file = useRef<HTMLInputElement>(null);
  const [theme, setThemeState] = useState(currentTheme());

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    if (importSvg(text, 'replace')) store.patch({ name: f.name.replace(/\.svg$/i, '') || 'untitled' });
  };

  return (
    <header className="topbar">
      <div className="brand" aria-label="SVG Studio">
        <span className="logo">
          <Icon name="pen" size={16} stroke={2} />
        </span>
        <strong>SVG Studio</strong>
      </div>
      <input className="input name" aria-label="Icon name" data-testid="icon-name" value={name} spellCheck={false} onChange={(e) => store.patch({ name: e.target.value })} />
      <select
        className="select"
        aria-label="Canvas size"
        data-testid="canvas-size"
        value={width === height && [16, 20, 24, 32, 48, 64].includes(width) ? width : 'custom'}
        onChange={(e) => {
          if (e.target.value !== 'custom') resizeCanvas(Number(e.target.value), Number(e.target.value));
        }}
      >
        {[16, 20, 24, 32, 48, 64].map((n) => (
          <option key={n} value={n}>
            {n} × {n}
          </option>
        ))}
        <option value="custom" disabled>
          {width} × {height}
        </option>
      </select>
      <span className="sep" />
      <IconButton icon="undo" title="Undo (Ctrl+Z)" onClick={() => store.undo()} disabled={!canUndo} testId="undo" />
      <IconButton icon="redo" title="Redo (Ctrl+Shift+Z)" onClick={() => store.redo()} disabled={!canRedo} testId="redo" />
      <span className="grow" />
      <button type="button" className="btn" onClick={() => newDocument(width)} title="Start a blank icon" data-testid="new">
        <Icon name="file" size={15} /> New
      </button>
      <input ref={file} type="file" accept=".svg,image/svg+xml" hidden data-testid="import-file" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ''))} />
      <button type="button" className="btn" onClick={() => file.current?.click()} title="Open an .svg file (or drop one on the page, or paste SVG)">
        <Icon name="upload" size={15} /> Import
      </button>
      <button type="button" className={`btn ${codeOpen ? 'on' : ''}`} aria-pressed={codeOpen} onClick={onToggleCode} data-testid="toggle-code" title="Show the SVG source">
        <Icon name="code" size={15} /> Code
      </button>
      <button type="button" className="btn primary" onClick={onExport} data-testid="export" title="Export (Ctrl+S)">
        <Icon name="download" size={15} /> Export
      </button>
      <IconButton
        icon={theme === 'dark' ? 'sun' : 'moon'}
        title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        onClick={() => {
          setThemeState(toggleTheme());
          toast(`${currentTheme() === 'dark' ? 'Dark' : 'Light'} theme`);
        }}
      />
      <IconButton icon="help" title="Keyboard shortcuts (?)" onClick={onHelp} />
    </header>
  );
}
