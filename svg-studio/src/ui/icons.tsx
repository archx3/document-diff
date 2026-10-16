import type { ReactNode } from 'react';

/* Interface icons, drawn on a 24-unit grid with round strokes. */

const P = (d: string, key?: string) => <path key={key ?? d} d={d} />;

const ICONS = {
  select: [P('M5 3l14 7-6.5 2.5L10 19z')],
  node: [P('M4 3l9 4.5-3.5 1.2L8 12z'), <rect key="r" x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />],
  pen: [P('M4 20l1.5-5L16 4.5 19.5 8 9 18.5z'), P('M13.5 7l3.5 3.5'), P('M5.5 15L9 18.5')],
  line: [P('M5 19L19 5'), <circle key="a" cx="5" cy="19" r="1.6" />, <circle key="b" cx="19" cy="5" r="1.6" />],
  rect: [<rect key="r" x="4" y="5" width="16" height="14" rx="2" />],
  ellipse: [<circle key="c" cx="12" cy="12" r="8" />],
  scale: [P('M14 4h6v6'), P('M20 4l-7 7'), P('M10 20H4v-6'), P('M4 20l7-7')],
  scaleH: [P('M3 12h18'), P('M7 8l-4 4 4 4'), P('M17 8l4 4-4 4')],
  scaleV: [P('M12 3v18'), P('M8 7l4-4 4 4'), P('M8 17l4 4 4-4')],
  rotate: [P('M20 12a8 8 0 1 1-2.6-5.9'), P('M20 3.5V8h-4.5')],
  hand: [P('M8 13V6.5a1.5 1.5 0 0 1 3 0V11'), P('M11 10.5V4.5a1.5 1.5 0 0 1 3 0V11'), P('M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2L3.7 14.3a1.5 1.5 0 0 1 2.3-1.8L8 14.5')],
  group: [P('M3 7V5a2 2 0 0 1 2-2h2'), P('M17 3h2a2 2 0 0 1 2 2v2'), P('M21 17v2a2 2 0 0 1-2 2h-2'), P('M7 21H5a2 2 0 0 1-2-2v-2'), <rect key="r" x="8" y="8" width="8" height="8" rx="1" />],
  ungroup: [<rect key="a" x="3" y="3" width="8" height="8" rx="1.5" />, <rect key="b" x="13" y="13" width="8" height="8" rx="1.5" />, P('M15 5h4v4'), P('M5 15v4h4')],
  alignLeft: [P('M4 3v18'), P('M8 7h12'), P('M8 14h7')],
  alignCenter: [P('M12 3v18'), P('M5 7h14'), P('M8 14h8')],
  alignRight: [P('M20 3v18'), P('M4 7h12'), P('M9 14h7')],
  alignTop: [P('M3 4h18'), P('M7 8v12'), P('M14 8v7')],
  alignMiddle: [P('M3 12h18'), P('M7 5v14'), P('M14 8v8')],
  alignBottom: [P('M3 20h18'), P('M7 4v12'), P('M14 9v7')],
  distributeH: [P('M4 3v18'), P('M20 3v18'), <rect key="r" x="9" y="8" width="6" height="8" rx="1" />],
  distributeV: [P('M3 4h18'), P('M3 20h18'), <rect key="r" x="8" y="9" width="8" height="6" rx="1" />],
  flipH: [P('M12 3v18', 'axis'), P('M9 6L3 18h6z'), P('M15 6l6 12h-6z')],
  flipV: [P('M3 12h18', 'axis'), P('M6 9L18 3v6z'), P('M6 15l12 6v-6z')],
  undo: [P('M9 14L4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [P('M15 14l5-5-5-5'), P('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
  eye: [P('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'), <circle key="c" cx="12" cy="12" r="3" />],
  eyeOff: [P('M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8'), P('M6.6 6.6A16 16 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1'), P('M9.9 9.9a3 3 0 0 0 4.2 4.2'), P('M3 3l18 18')],
  lock: [<rect key="r" x="5" y="11" width="14" height="10" rx="2" />, P('M8 11V7a4 4 0 0 1 8 0v4')],
  unlock: [<rect key="r" x="5" y="11" width="14" height="10" rx="2" />, P('M8 11V7a4 4 0 0 1 7.6-1.7')],
  trash: [P('M4 7h16'), P('M10 11v6'), P('M14 11v6'), P('M6 7l1 13h10l1-13'), P('M9 7V4h6v3')],
  copy: [<rect key="r" x="9" y="9" width="12" height="12" rx="2" />, P('M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1')],
  download: [P('M12 4v11'), P('M7 11l5 5 5-5'), P('M5 20h14')],
  upload: [P('M12 16V5'), P('M7 9l5-5 5 5'), P('M5 20h14')],
  code: [P('M8 7l-5 5 5 5'), P('M16 7l5 5-5 5'), P('M14 4l-4 16')],
  grid: [<rect key="r" x="3" y="3" width="18" height="18" rx="1" />, P('M3 9h18'), P('M3 15h18'), P('M9 3v18'), P('M15 3v18')],
  keylines: [<circle key="c" cx="12" cy="12" r="9" />, <rect key="r" x="5" y="5" width="14" height="14" rx="1" />],
  magnet: [P('M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0z'), P('M5 7h4'), P('M15 7h4')],
  zoomIn: [<circle key="c" cx="11" cy="11" r="7" />, P('M20 20l-4-4'), P('M11 8v6'), P('M8 11h6')],
  zoomOut: [<circle key="c" cx="11" cy="11" r="7" />, P('M20 20l-4-4'), P('M8 11h6')],
  fit: [P('M4 9V4h5'), P('M20 9V4h-5'), P('M4 15v5h5'), P('M20 15v5h-5')],
  sun: [<circle key="c" cx="12" cy="12" r="4" />, P('M12 2v2'), P('M12 20v2'), P('M4.9 4.9l1.4 1.4'), P('M17.7 17.7l1.4 1.4'), P('M2 12h2'), P('M20 12h2'), P('M6.3 17.7l-1.4 1.4'), P('M19.1 4.9l-1.4 1.4')],
  moon: [P('M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z')],
  plus: [P('M12 5v14'), P('M5 12h14')],
  x: [P('M6 6l12 12'), P('M18 6L6 18')],
  chevronDown: [P('M6 9l6 6 6-6')],
  chevronRight: [P('M9 6l6 6-6 6')],
  link: [P('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1'), P('M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1')],
  unlink: [P('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1'), P('M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'), P('M4 4l16 16')],
  help: [<circle key="c" cx="12" cy="12" r="9" />, P('M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7'), P('M12 17h.01')],
  front: [P('M12 3v11'), P('M7.5 7.5L12 3l4.5 4.5'), P('M4 20h16')],
  forward: [P('M12 4v14'), P('M6 10l6-6 6 6')],
  backward: [P('M12 6v14'), P('M6 14l6 6 6-6')],
  back: [P('M12 21V10'), P('M7.5 16.5L12 21l4.5-4.5'), P('M4 4h16')],
  file: [P('M6 3h8l4 4v14H6z'), P('M14 3v4h4')],
  keyboard: [<rect key="r" x="2" y="6" width="20" height="12" rx="2" />, P('M6 10h.01'), P('M10 10h.01'), P('M14 10h.01'), P('M18 10h.01'), P('M7 14h10')],
  encompass: [<rect key="a" x="3" y="3" width="18" height="18" rx="1" strokeDasharray="3 2.5" />, <rect key="b" x="8" y="8" width="8" height="8" rx="1" />],
  touch: [<rect key="a" x="3" y="3" width="13" height="13" rx="1" strokeDasharray="3 2.5" />, <rect key="b" x="10" y="10" width="11" height="11" rx="1" />],
  convert: [P('M4 18c4 0 4-12 8-12s4 12 8 12'), <circle key="a" cx="4" cy="18" r="1.5" />, <circle key="b" cx="20" cy="18" r="1.5" />],
  smooth: [P('M3 15c4-8 14-8 18 0'), <circle key="a" cx="12" cy="9" r="1.6" />],
  corner: [P('M4 18L12 6l8 12'), <rect key="a" x="10.4" y="4.4" width="3.2" height="3.2" />],
  addNode: [P('M3 17c5-9 13-9 18 0'), P('M12 14v6'), P('M9 17h6')],
  closePath: [P('M5 18l3-12 8 2 3 10z'), <circle key="a" cx="5" cy="18" r="1.4" />],
  pivot: [<circle key="c" cx="12" cy="12" r="3" />, P('M12 3v4'), P('M12 17v4'), P('M3 12h4'), P('M17 12h4')],
  image: [<rect key="r" x="3" y="3" width="18" height="18" rx="2" />, <circle key="c" cx="9" cy="9" r="1.6" />, P('M21 15l-4-4L6 21')],
} satisfies Record<string, ReactNode[]>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, stroke = 1.75 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
