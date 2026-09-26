/** Line icons for the site and the workspace: 16px grid, 1.5px strokes. */
const PATHS = {
  arrow: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
  upload: '<path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6"/><path d="M3 13.5h10"/>',
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>',
  bolt: '<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z"/>',
  columns: '<rect x="1.5" y="2.5" width="5.5" height="11" rx="1"/><rect x="9" y="2.5" width="5.5" height="11" rx="1"/><path d="M3.5 5.5h1.5M3.5 8h1.5M11 5.5h1.5M11 8h1.5"/>',
  swap: '<path d="M3 5.5h10M10.5 3 13 5.5 10.5 8"/><path d="M13 10.5H3M5.5 8 3 10.5 5.5 13"/>',
  doc: '<path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3"/>',
  newDoc: '<path d="M9.5 1.5H4v13h8.5V4.5z"/><path d="M9.5 1.5v3h3"/><path d="M8.25 7.25v4.5M6 9.5h4.5"/>',
  open: '<path d="M2.5 12.5v-9h4l1.5 1.5h5.5v7.5z"/>',
  download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7"/><path d="M3 13.5h10"/>',
  lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  keyboard: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4.5 6.5h0M7 6.5h0M9.5 6.5h0M12 6.5h0M5.5 9.5h5"/>',
  alert: '<circle cx="8" cy="8" r="6"/><path d="M8 5v3.5M8 11h0"/>',
  help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.4.7c0 1.2-1.7 1.5-1.7 2.6"/><path d="M8 11.4v.1"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  paste: '<rect x="3.5" y="3" width="9" height="11" rx="1"/><path d="M6 3V2h4v1"/><path d="M6 7h4M6 9.5h4"/>',
  link: '<path d="M6.5 9.5l3-3"/><path d="M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1"/><path d="M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1"/>',
  print: '<path d="M4.5 6V2.5h7V6"/><rect x="2.5" y="6" width="11" height="5" rx="1"/><path d="M4.5 9.5h7v4h-7z"/>',
  toA: '<path d="M13 8H3.5M7 4.5 3.5 8 7 11.5"/>',
  toB: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
  /** Copy changes across: both sides brought together. */
  merge: '<path d="M1.5 8h4.25M4 5.75 6.25 8 4 10.25M14.5 8h-4.25M12 5.75 9.75 8 12 10.25"/><path d="M8 3v10"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  chevron: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  fold: '<path d="M4 6l4-3 4 3M4 10l4 3 4-3"/>',
  undo: '<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7"/>',
  redo: '<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3"/>',
  sliders: '<path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  /** Two miniature pages side by side. */
  minimap: '<rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5"/><path d="M8 2.5v11"/><path d="M4 5.5h2M4 8h1.5M4 10.5h2M10 5.5h2M10 8h2M10 10.5h1"/>',
  lineNumbers: '<path d="M6.25 2.5 5 13.5M11 2.5 9.75 13.5M2.75 6h11M2.25 10h11"/>',
  /** A half-filled circle. */
  contrast: '<circle cx="8" cy="8" r="5.75"/><path d="M8 2.25v11.5a5.75 5.75 0 0 0 0-11.5z" fill="currentColor" stroke="none"/>',
  /** A panel on the right with a list in it. */
  sidebar: '<rect x="1.75" y="2.5" width="12.5" height="11" rx="1.5"/><path d="M9.25 2.5v11"/><path d="M11.1 5.5h1.3M11.1 8h1.3M11.1 10.5h1.3"/>',
  sun: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/>',
  moon: '<path d="M13.5 9.6A5.75 5.75 0 1 1 6.4 2.5a4.6 4.6 0 0 0 7.1 7.1z"/>',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: Readonly<{ name: IconName; size?: number; className?: string }>) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

/** An icon in the workspace, which styles icons by their `ico` class. */
export function Ico({ name, size }: { name: IconName; size?: number }) {
  return <Icon name={name} size={size} className="ico" />;
}
