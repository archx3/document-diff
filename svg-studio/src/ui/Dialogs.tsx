import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { serializeSvg } from '../core/svg-io';
import { toast } from '../state/actions';
import { useEditor } from '../state/store';
import { Artwork } from './Artwork';
import { copyText, download, downloadSvg, fileBase, iconNodeForExport, jsxForExport, renderPng, svgForExport } from './export';
import { Icon } from './icons';

export function Dialog({ title, onClose, children, wide, testId }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="btn icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose(): void }) {
  const doc = useEditor((s) => s.doc);
  const name = useEditor((s) => s.name);
  const code = useMemo(() => svgForExport(doc), [doc]);
  const [size, setSize] = useState(256);
  const [color, setColor] = useState('#111827');
  const [bg, setBg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async (text: string, what: string) => toast((await copyText(text)) ? `${what} copied` : 'Could not copy', false);
  const png = async () => {
    setBusy(true);
    try {
      download(`${fileBase(name)}.png`, await renderPng(doc, { size, color, background: bg }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not make the PNG', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Export" onClose={onClose} wide testId="export-dialog">
      <div className="export-grid">
        <div className="export-preview">
          <svg viewBox={`0 0 ${doc.width} ${doc.height}`} width="160" height="160" aria-label="Preview">
            <Artwork doc={doc} />
          </svg>
          <span className="muted">
            {doc.width} × {doc.height} · {serializeSvg(doc).length} bytes
          </span>
        </div>
        <div className="export-actions">
          <h4>SVG</h4>
          <div className="row gap wrap">
            <button type="button" className="btn primary" data-testid="download-svg" onClick={() => (downloadSvg(doc, name), toast('Downloaded'))}>
              <Icon name="download" size={15} /> Download .svg
            </button>
            <button type="button" className="btn" data-testid="copy-svg" onClick={() => copy(code, 'SVG')}>
              <Icon name="copy" size={15} /> Copy SVG
            </button>
          </div>
          <h4>Code</h4>
          <div className="row gap wrap">
            <button type="button" className="btn" data-testid="copy-jsx" onClick={() => copy(jsxForExport(doc, name), 'React component')}>
              <Icon name="code" size={15} /> Copy React component
            </button>
            <button type="button" className="btn" data-testid="copy-node" onClick={() => copy(iconNodeForExport(doc), 'Icon node')}>
              <Icon name="code" size={15} /> Copy Lucide icon node
            </button>
          </div>
          <h4>PNG</h4>
          <div className="row gap wrap">
            <label className="field">
              <span className="field-label">Size</span>
              <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="PNG size">
                {[24, 48, 64, 128, 256, 512, 1024].map((n) => (
                  <option key={n} value={n}>
                    {n}px
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Colour</span>
              <input type="color" className="swatch" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Icon colour" />
            </label>
            <label className="check">
              <input type="checkbox" checked={bg !== null} onChange={(e) => setBg(e.target.checked ? '#ffffff' : null)} />
              <span>White background</span>
            </label>
            <button type="button" className="btn" disabled={busy} data-testid="download-png" onClick={png}>
              <Icon name="download" size={15} /> Download .png
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  [
    'Tools',
    [
      ['V', 'Select'],
      ['A', 'Edit points'],
      ['P', 'Pen'],
      ['L', 'Line'],
      ['R', 'Rectangle'],
      ['E', 'Ellipse'],
      ['S', 'Scale (both)'],
      ['X', 'Scale horizontally'],
      ['Y', 'Scale vertically'],
      ['T', 'Rotate'],
      ['H / Space', 'Pan'],
    ],
  ],
  [
    'Selecting',
    [
      ['Drag', 'Select what is inside the rectangle'],
      ['Alt + drag', 'Switch to “touch” while dragging'],
      ['Shift + click/drag', 'Add to the selection'],
      ['Double-click', 'Open a group / edit points'],
      ['Ctrl/⌘ + click', 'Pick inside a group'],
      ['Ctrl/⌘ + A', 'Select all'],
      ['Enter', 'Open the selected group'],
      ['Esc', 'Cancel / back out one level'],
    ],
  ],
  [
    'Editing',
    [
      ['Ctrl/⌘ + G', 'Group'],
      ['Ctrl/⌘ + Shift + G', 'Ungroup'],
      ['Ctrl/⌘ + D', 'Duplicate'],
      ['Alt + drag', 'Drag a copy'],
      ['Shift + H / V', 'Flip horizontally / vertically'],
      ['[ ] (Shift)', 'Send back / bring forward (to the end)'],
      ['Arrows', 'Nudge (Shift for 0.1)'],
      ['Delete', 'Delete'],
      ['Ctrl/⌘ + Z / Shift + Z', 'Undo / redo'],
      ['Ctrl/⌘ + C X V', 'Copy, cut, paste SVG'],
    ],
  ],
  [
    'While dragging',
    [
      ['Shift', 'Keep proportions / constrain angle / snap rotation to 15°'],
      ['Alt', 'Scale or draw from the centre'],
      ['Ctrl/⌘', 'Switch grid snapping off (or on)'],
    ],
  ],
  [
    'View',
    [
      ['+ / −', 'Zoom'],
      ['Shift + 1', 'Fit the canvas'],
      ['O', 'Outline view'],
      ['Ctrl/⌘ + wheel', 'Zoom at the pointer'],
      ['Ctrl/⌘ + S', 'Export'],
    ],
  ],
];

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} wide testId="help-dialog">
      <div className="shortcuts">
        {SHORTCUTS.map(([title, rows]) => (
          <section key={title}>
            <h4>{title}</h4>
            <dl>
              {rows.map(([k, v]) => (
                <div key={k + v}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
