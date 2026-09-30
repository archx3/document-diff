'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Icon } from '../icons';
import { asset } from '../site-header';
import { Frame } from './frame';
import { Region, useRegions } from './region';
import styles from './replica.module.css';

type Mode = 'side' | 'swipe' | 'onion' | 'diff';

const MODES: Array<[Mode, string]> = [
  ['side', 'Side by side'],
  ['swipe', 'Swipe'],
  ['onion', 'Onion skin'],
  ['diff', 'Difference'],
];

/** Where the sample charts differ, in percent of the picture: the new label, then the taller bar. */
const AREAS = [
  { left: 68, top: 28.5, width: 17, height: 8.5, small: true },
  { left: 73, top: 39.5, width: 13.5, height: 15.5, small: false },
];

const A = '/samples/chart-v1.png';
const B = '/samples/chart-v2.png';

const box = (a: (typeof AREAS)[number]): CSSProperties => ({ left: `${a.left}%`, top: `${a.top}%`, width: `${a.width}%`, height: `${a.height}%` });

/**
 * The picture workspace in miniature, comparing the sample charts. The modes,
 * sliders, zoom and stepping through the changed areas all work.
 */
export function ImageReplica() {
  const { focus } = useRegions();
  const [mode, setMode] = useState<Mode>('side');
  const [swipe, setSwipe] = useState(50);
  const [onion, setOnion] = useState(50);
  const [sensitivity, setSensitivity] = useState(60);
  const [outlines, setOutlines] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(-1);

  // A step about a mode's slider shows that mode.
  const shown: Mode = focus === 'slider' && mode !== 'swipe' && mode !== 'onion' ? 'swipe' : focus === 'save' ? 'diff' : mode;
  // Low sensitivity ignores the small change (the label).
  const areas = AREAS.filter((a) => sensitivity >= 35 || !a.small);
  const at = Math.min(area, areas.length - 1);
  const target = areas[at];
  const scale = target ? 2 : zoom;
  const origin = target ? `${target.left + target.width / 2}% ${target.top + target.height / 2}%` : '50% 50%';
  const ratio = areas.length === 2 ? '3.4' : '2.1';

  function step(d: number) {
    const n = areas.length;
    if (!n) return;
    setArea((i) => (i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n));
  }

  const boxes = outlines && (
    <Region name="areas" as="span" className={styles.areas}>
      {areas.map((a, i) => (
        <span
          key={i}
          className={styles.box}
          style={box(a)}
          data-current={i === at || undefined}
          onClick={() => setArea(i)}
        />
      ))}
    </Region>
  );

  const zoomer = (children: ReactNode) => (
    <div className={styles.zoomer} style={{ transform: `scale(${scale})`, transformOrigin: origin }}>
      {children}
    </div>
  );

  let view;
  if (shown === 'side')
    view = (
      <div className={styles.pics}>
        <div className={styles.pic}>
          <span className={styles.picLabel}>A</span>
          {zoomer(
            <>
              <img src={asset(A)} alt="Version A of the chart" />
              {boxes}
            </>,
          )}
        </div>
        <div className={styles.pic}>
          <span className={styles.picLabel}>B</span>
          {zoomer(
            <>
              <img src={asset(B)} alt="Version B of the chart" />
              {boxes}
            </>,
          )}
        </div>
      </div>
    );
  else
    view = (
      <div className={`${styles.pic} ${styles.single}`}>
        <span className={styles.picLabel}>{shown === 'swipe' ? 'A' : shown === 'onion' ? 'A + B' : 'A − B'}</span>
        {shown === 'swipe' && (
          <span className={styles.picLabel} data-end="">
            B
          </span>
        )}
        {zoomer(
          <>
            <img src={asset(A)} alt="Version A of the chart" style={shown === 'diff' ? { opacity: 0.28, filter: 'grayscale(1)' } : undefined} />
            {shown === 'swipe' && <img src={asset(B)} alt="" style={{ clipPath: `inset(0 0 0 ${swipe}%)` }} />}
            {shown === 'onion' && <img src={asset(B)} alt="" style={{ opacity: onion / 100 }} />}
            {shown === 'diff' && areas.map((a, i) => <span key={i} className={styles.diffPatch} style={box(a)} />)}
            {boxes}
          </>,
        )}
        {shown === 'swipe' && (
          <>
            <span className={styles.handle} style={{ left: `${swipe}%` }} />
            <input className={styles.swipeRange} type="range" min={0} max={100} value={swipe} onChange={(e) => setSwipe(Number(e.target.value))} aria-label="Swipe between A and B" />
          </>
        )}
      </div>
    );

  return (
    <Frame address="collate / compare" label="An interactive replica of the picture workspace">
      <div className={styles.toolbar}>
        <Region name="nav" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(-1)} title="Previous changed area (P)" aria-label="Previous changed area">
            <Icon name="up" size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(1)} title="Next changed area (N)" aria-label="Next changed area">
            <Icon name="down" size={13} />
          </button>
          <span className={styles.status}>
            {ratio}% changed · {at >= 0 ? `${at + 1} of ` : ''}
            {areas.length} {areas.length === 1 ? 'area' : 'areas'}
          </span>
        </Region>
        <span className={styles.spacer} />
        <Region name="modes" as="span" className={styles.seg}>
          {MODES.map(([m, label], i) => (
            <button key={m} type="button" aria-pressed={shown === m} onClick={() => setMode(m)} title={`${label} (${i + 1})`}>
              {label}
            </button>
          ))}
        </Region>
      </div>
      <div className={styles.toolbar}>
        {(shown === 'swipe' || shown === 'onion') && (
          <Region name="slider" as="span" className={styles.range}>
            {shown === 'swipe' ? 'Swipe' : 'B over A'}
            <input
              type="range"
              min={0}
              max={100}
              value={shown === 'swipe' ? swipe : onion}
              onChange={(e) => (shown === 'swipe' ? setSwipe : setOnion)(Number(e.target.value))}
              aria-label={shown === 'swipe' ? 'Swipe between A and B' : 'How much of B shows over A'}
            />
          </Region>
        )}
        <Region name="sensitivity" as="span" className={styles.range}>
          Sensitivity
          <input type="range" min={0} max={100} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Sensitivity" />
        </Region>
        <button type="button" className={`${styles.btn} ${styles.hideNarrow}`} aria-pressed={outlines} onClick={() => setOutlines(!outlines)} title="Outline the changed areas">
          Outlines
        </button>
        <span className={styles.spacer} />
        <Region name="zoom" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" onClick={() => (setArea(-1), setZoom((z) => Math.max(1, z - 0.5)))} aria-label="Zoom out" title="Zoom out">
            <Icon name="minus" size={13} />
          </button>
          <span className={styles.status}>{Math.round(scale * 100)}%</span>
          <button type="button" className={styles.btn} data-icon="" onClick={() => (setArea(-1), setZoom((z) => Math.min(3, z + 0.5)))} aria-label="Zoom in" title="Zoom in">
            <Icon name="plus" size={13} />
          </button>
        </Region>
        <Region name="save" as="span" className={styles.group}>
          <button type="button" className={styles.btn} title="Save the difference as a PNG">
            <Icon name="download" size={12} />
            <span className={styles.hideNarrow}>Save difference</span>
          </button>
        </Region>
      </div>

      <Region name="heads" className={styles.heads}>
        <div className={styles.head}>
          <span className={styles.siglum}>A</span>
          <span className={styles.headMain}>
            <span className={styles.headName}>chart-v1.png</span>
            <span className={styles.headMeta}>
              <span className={styles.badge}>PNG</span>
              640 × 400 px · 6.6 KB
            </span>
          </span>
        </div>
        <span />
        <div className={styles.head}>
          <span className={styles.siglum}>B</span>
          <span className={styles.headMain}>
            <span className={styles.headName}>chart-v2.png</span>
            <span className={styles.headMeta}>
              <span className={styles.badge}>PNG</span>
              640 × 400 px · 10 KB
            </span>
          </span>
        </div>
      </Region>
      <Region name="view" className={styles.picStage}>
        {view}
      </Region>
    </Frame>
  );
}
