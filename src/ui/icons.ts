/** Inline SVG icons (16px, stroke uses currentColor). */
const svg = (body: string, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  toA: svg('<path d="M13 8H3.5M7 4.5 3.5 8 7 11.5"/>'),
  toB: svg('<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>'),
  up: svg('<path d="M4 10l4-4 4 4"/>'),
  down: svg('<path d="M4 6l4 4 4-4"/>'),
  undo: svg('<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7"/>'),
  redo: svg('<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3"/>'),
  swap: svg('<path d="M3 5.5h10M10.5 3 13 5.5 10.5 8"/><path d="M13 10.5H3M5.5 8 3 10.5 5.5 13"/>'),
  open: svg('<path d="M2.5 12.5v-9h4l1.5 1.5h5.5v7.5z"/>'),
  paste: svg('<rect x="3.5" y="3" width="9" height="11" rx="1"/><path d="M6 3V2h4v1"/><path d="M6 7h4M6 9.5h4"/>'),
  link: svg('<path d="M6.5 9.5l3-3"/><path d="M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1"/><path d="M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1"/>'),
  download: svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7"/><path d="M3 13.5h10"/>'),
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>'),
  help: svg('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.4.7c0 1.2-1.7 1.5-1.7 2.6"/><path d="M8 11.4v.1"/>'),
  sliders: svg('<path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  chevron: svg('<path d="M4.5 6.5 8 10l3.5-3.5"/>'),
  check: svg('<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>'),
  fold: svg('<path d="M4 6l4-3 4 3M4 10l4 3 4-3"/>'),
  print: svg('<path d="M4.5 6V2.5h7V6"/><rect x="2.5" y="6" width="11" height="5" rx="1"/><path d="M4.5 9.5h7v4h-7z"/>'),
  doc: svg('<path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3"/>'),
  eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/>'),
};
