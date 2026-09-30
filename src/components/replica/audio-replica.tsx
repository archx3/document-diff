'use client';

import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { Frame } from './frame';
import { Region, useRegions } from './region';
import styles from './replica.module.css';
import { Loudness, Spectrogram, Waveform, fakePeaks } from './wave';

type Vis = 'wave' | 'spectrum' | 'loudness';
type Side = 'a' | 'b';

const LENGTH = { a: 5.6, b: 7.6 };
/** The time scale both tracks are drawn on: the longer recording. */
const SCALE = 7.6;
const N = 190;

type Word = { w: string; t: [number, number]; k?: 'mod' | 'ins' };

const WORDS: Record<Side, Word[]> = {
  a: [
    { w: 'Please', t: [0.3, 0.8], k: 'mod' },
    { w: 'send', t: [0.95, 1.35] },
    { w: 'the', t: [1.45, 1.6] },
    { w: 'signed', t: [1.75, 2.3] },
    { w: 'contract', t: [2.4, 3.1] },
    { w: 'by', t: [3.3, 3.55] },
    { w: 'Friday,', t: [3.65, 4.3] },
    { w: 'thank', t: [4.6, 4.9] },
    { w: 'you.', t: [4.95, 5.3] },
  ],
  b: [
    { w: 'Please', t: [0.3, 0.8], k: 'mod' },
    { w: 'send', t: [0.95, 1.35] },
    { w: 'the', t: [1.45, 1.6] },
    { w: 'signed', t: [1.75, 2.3] },
    { w: 'contract', t: [2.4, 3.1] },
    { w: 'and', t: [3.25, 3.45], k: 'ins' },
    { w: 'the', t: [3.5, 3.65], k: 'ins' },
    { w: 'invoice', t: [3.75, 4.4], k: 'ins' },
    { w: 'by', t: [4.6, 4.85] },
    { w: 'Friday,', t: [4.95, 5.6] },
    { w: 'thank', t: [5.9, 6.2] },
    { w: 'you', t: [6.25, 6.6] },
    { w: 'so', t: [6.7, 6.95], k: 'ins' },
    { w: 'much.', t: [7.0, 7.35], k: 'ins' },
  ],
};

/** Where the recordings differ, in each one's own seconds. The first is small: low sensitivity lets it go. */
const DIFFS = [
  { k: 'mod' as const, a: [0.3, 0.8], b: [0.3, 0.8], small: true, label: 'Sounds different' },
  { k: 'ins' as const, a: [3.2, 3.2], b: [3.2, 4.5], small: false, label: 'Only in B' },
  { k: 'ins' as const, a: [5.3, 5.3], b: [6.65, 7.4], small: false, label: 'Only in B' },
];

/** The same moment in the other recording. */
function mapTime(t: number, from: Side): number {
  if (from === 'b') return Math.min(LENGTH.a, t < 3.2 ? t : t < 4.5 ? 3.2 : t < 6.65 ? t - 1.3 : 5.35);
  return Math.min(LENGTH.b, t < 3.2 ? t : t + 1.3);
}

const PEAKS = {
  a: fakePeaks(7, N, SCALE, WORDS.a.map((w) => w.t)),
  b: fakePeaks(11, N, SCALE, WORDS.b.map((w) => w.t)),
};

const pct = (s: number) => `${(s / SCALE) * 100}%`;
const clock = (s: number) => `0:${s.toFixed(1).padStart(4, '0')}`;
const SPEEDS = [1, 1.5, 2, 0.5];

/**
 * The audio workspace in miniature, comparing two takes of a spoken sentence.
 * Nothing is heard, but the playhead, A/B switch, loop, speed, the three ways
 * of drawing the tracks, the sensitivity and the transcript all work.
 */
export function AudioReplica() {
  const { focus } = useRegions();
  const [vis, setVis] = useState<Vis>('wave');
  const [side, setSide] = useState<Side>('b');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [sensitivity, setSensitivity] = useState(60);
  const [transcriptOn, setTranscript] = useState(false);
  const [cur, setCur] = useState(-1);
  const frame = useRef(0);

  const transcript = transcriptOn || focus === 'transcript';
  const diffs = DIFFS.filter((d) => sensitivity >= 40 || !d.small);
  const at = Math.min(cur, diffs.length - 1);
  const current = diffs[at];
  const total = diffs.reduce((s, d) => s + Math.max(d.a[1]! - d.a[0]!, d.b[1]! - d.b[0]!), 0);
  const tOther = mapTime(t, side);
  const pos = { [side]: t, [side === 'a' ? 'b' : 'a']: tOther } as Record<Side, number>;

  // The playhead moves while playing, looping over the current difference when asked.
  const state = useRef({ t, loop, speed, side, current });
  state.current = { t, loop, speed, side, current };
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const s = state.current;
      let next = s.t + ((now - last) / 1000) * s.speed;
      last = now;
      const span = s.current?.[s.side];
      if (s.loop && span && next > span[1]! + 0.15) next = span[0]!;
      if (next >= LENGTH[s.side]) {
        setT(LENGTH[s.side]);
        setPlaying(false);
        return;
      }
      setT(next);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing]);

  function go(i: number) {
    const d = diffs[i];
    if (!d) return;
    setCur(i);
    setT(d[side][0]!);
  }

  function step(delta: number) {
    const n = diffs.length;
    if (n) go(at < 0 ? (delta > 0 ? 0 : n - 1) : (at + delta + n) % n);
  }

  function play() {
    if (!playing && t >= LENGTH[side]) setT(0);
    setPlaying(!playing);
  }

  function switchSide() {
    setT(tOther);
    setSide(side === 'a' ? 'b' : 'a');
  }

  function seek(s: Side, e: MouseEvent<HTMLElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const secs = Math.min(LENGTH[s], ((e.clientX - box.left) / box.width) * SCALE);
    setT(s === side ? secs : mapTime(secs, s));
  }

  const draw = (s: Side) => {
    const color = s === 'a' ? 'var(--a)' : 'var(--b)';
    if (vis === 'spectrum') return <Spectrogram peaks={PEAKS[s]} seed={s === 'a' ? 3 : 5} />;
    if (vis === 'loudness') return <Loudness peaks={PEAKS[s]} color={color} />;
    return <Waveform peaks={PEAKS[s]} color={color} />;
  };

  const track = (s: Side) => (
    <div className={styles.track} onClick={(e) => seek(s, e)} role="presentation">
      <span className={styles.trackTag}>{s.toUpperCase()}</span>
      {draw(s)}
      {diffs.map((d, i) => (
        <span
          key={i}
          className={styles.span}
          data-k={s === 'a' && d.k === 'ins' ? 'ins' : d.k}
          data-current={i === at || undefined}
          style={{ left: pct(d[s][0]!), width: `max(2px, ${pct(d[s][1]! - d[s][0]!)})` }}
          title={d.label}
        />
      ))}
      <span className={styles.playhead} style={{ left: pct(pos[s]) }} />
    </div>
  );

  const words = (s: Side) =>
    WORDS[s].map((w, i) => (
      <button
        key={i}
        type="button"
        className={styles.word}
        data-k={w.k === 'mod' ? (s === 'a' ? 'del' : 'ins') : w.k === 'ins' ? 'ins' : undefined}
        data-now={(pos[s] >= w.t[0] && pos[s] < w.t[1]) || undefined}
        onClick={() => {
          if (s !== side) setSide(s);
          setT(w.t[0]);
        }}
      >
        {w.w}
      </button>
    ));

  return (
    <Frame address="collate / compare" label="An interactive replica of the audio workspace">
      <div className={styles.toolbar}>
        <Region name="nav" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(-1)} title="Previous difference (P)" aria-label="Previous difference">
            <Icon name="up" size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(1)} title="Next difference (N)" aria-label="Next difference">
            <Icon name="down" size={13} />
          </button>
          <span className={styles.status}>
            {at >= 0 ? `${at + 1} of ` : ''}
            {diffs.length} differences · {total.toFixed(1)} s
          </span>
        </Region>
        <span className={styles.spacer} />
        <Region name="vis" as="span" className={styles.seg}>
          {(
            [
              ['wave', 'Waveform'],
              ['spectrum', 'Spectrogram'],
              ['loudness', 'Loudness'],
            ] as const
          ).map(([v, label], i) => (
            <button key={v} type="button" aria-pressed={vis === v} onClick={() => setVis(v)} title={`${label} (${i + 1})`}>
              {label}
            </button>
          ))}
        </Region>
      </div>
      <div className={styles.toolbar}>
        <Region name="sensitivity" as="span" className={styles.range}>
          Sensitivity
          <input type="range" min={0} max={100} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Sensitivity" />
        </Region>
        <span className={styles.spacer} />
        <Region name="transcribe" as="span" className={styles.group}>
          <button type="button" className={styles.btn} aria-pressed={transcript} onClick={() => setTranscript(!transcriptOn)}>
            <Icon name="transcript" size={13} />
            Transcribe
          </button>
        </Region>
      </div>

      <Region name="heads" className={styles.heads}>
        {(['a', 'b'] as const).map((s, i) => (
          <div key={s} className={styles.head} style={{ gridColumn: i === 0 ? 1 : 3 }}>
            <span className={styles.siglum}>{s.toUpperCase()}</span>
            <span className={styles.headMain}>
              <span className={styles.headName}>take-{i + 1}.wav</span>
              <span className={styles.headMeta}>
                <span className={styles.badge}>WAV</span>
                {clock(LENGTH[s])} · 22.05 kHz · mono
              </span>
            </span>
          </div>
        ))}
      </Region>

      <Region name="tracks" className={styles.tracks}>
        {track('a')}
        <Region name="bands">
          <svg className={styles.bandsSvg} viewBox={`0 0 ${SCALE} 36`} preserveAspectRatio="none" aria-hidden="true">
            {diffs.map((d, i) => (
              <polygon
                key={i}
                points={`${d.a[0]},0 ${d.a[1]},0 ${d.b[1]},36 ${d.b[0]},36`}
                fill={d.k === 'mod' ? 'var(--chg)' : 'var(--b)'}
                fillOpacity={i === at ? 0.35 : 0.18}
                stroke={d.k === 'mod' ? 'var(--chg)' : 'var(--b)'}
                strokeWidth={0.02}
              />
            ))}
          </svg>
        </Region>
        {track('b')}
      </Region>

      <Region name="playback" className={styles.playbar}>
        <span className={styles.time}>{clock(t)}</span>
        <span
          className={styles.scrub}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setT(((e.clientX - box.left) / box.width) * LENGTH[side]);
          }}
          role="presentation"
        >
          <span className={styles.scrubFill} style={{ width: `${(t / LENGTH[side]) * 100}%` }} />
          {diffs.map((d, i) => (
            <span key={i} className={styles.scrubMark} data-k={d.k} style={{ left: `${(d[side][0]! / LENGTH[side]) * 100}%`, width: `max(3px, ${((d[side][1]! - d[side][0]!) / LENGTH[side]) * 100}%)` }} />
          ))}
        </span>
        <span className={styles.time}>{clock(LENGTH[side])}</span>
        <span className={styles.controls}>
          <Region name="ab" as="span" className={styles.group}>
            <button type="button" className={styles.btn} onClick={switchSide} title="Switch to the other recording at the same moment">
              Playing <b>{side.toUpperCase()}</b>
            </button>
          </Region>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(-1)} aria-label="Previous difference" title="Previous difference">
            <Icon name="chevronsLeft" size={13} />
          </button>
          <button type="button" className={`${styles.btn} ${styles.play}`} data-icon="" onClick={play} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" onClick={() => step(1)} aria-label="Next difference" title="Next difference">
            <Icon name="chevronsRight" size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" aria-pressed={loop} onClick={() => setLoop(!loop)} aria-label="Loop the difference" title="Loop the difference">
            <Icon name="loop" size={13} />
          </button>
          <button type="button" className={styles.btn} onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)} title="Speed">
            {speed}×
          </button>
          <button type="button" className={styles.btn} data-icon="" aria-pressed={muted} onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'} title="Volume">
            <Icon name={muted ? 'mute' : 'volume'} size={13} />
          </button>
        </span>
      </Region>

      {transcript && (
        <Region name="transcript" className={styles.transcript}>
          <p>
            <b>A</b>
            {words('a')}
          </p>
          <p>
            <b>B</b>
            {words('b')}
          </p>
        </Region>
      )}
      <p className={styles.hintLine}>A replica: nothing plays here. Click a track, a difference or a word to move the playhead.</p>
    </Frame>
  );
}
