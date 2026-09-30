/**
 * Comparing two recordings: decoding them, lining them up in time, finding
 * where they differ, transcribing them, and playing them — either one, and
 * switching between them at the same moment of the recording. The toolbar's
 * audio tools, the tracks and the playback bar all work from it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioDifference, TimeMap } from '../../audio/align';
import { alignFrames, findDifferences, timeMap } from '../../audio/align';
import type { Features } from '../../audio/analyze';
import { features } from '../../audio/analyze';
import type { DecodedAudio } from '../../audio/decode';
import { ANALYSIS_RATE, decodeAudio } from '../../audio/decode';
import type { TranscribeProgress, Transcript, Word } from '../../audio/transcribe';
import { canTranscribe, transcribe } from '../../audio/transcribe';
import { consentGiven, rememberConsent, serverTranscribes, transcribeOnServer, transcribeServer } from '../../audio/transcribe-server';
import type { WordsIgnore } from '../../audio/words';
import { heardWords } from '../../audio/words';
import type { Doc, InlineObject } from '../../core/model';
import type { Side } from '../util';
import { mediaObject } from '../facts';

export type AudioVis = 'wave' | 'spectrum' | 'loudness';

export interface AudioSide {
  name: string;
  obj: InlineObject;
  decoded: DecodedAudio;
}

/** Where recordings are transcribed: in this browser, or (with consent) on the transcription server. */
export type TranscribeWhere = 'device' | 'server';

export type TranscriptState =
  | { status: 'idle' }
  /** `ready`: a recording transcribed before, which isn't transcribed again. */
  | { status: 'working'; side: Side; progress: TranscribeProgress | { stage: 'server' }; ready?: Side }
  | { status: 'done'; a: Transcript; b: Transcript }
  | { status: 'error'; message: string };

export interface AudioCompare {
  sides: Record<Side, AudioSide> | null;
  error: string;
  /** Analysing (after decoding): lining up and comparing. */
  busy: boolean;
  vis: AudioVis;
  setVis(v: AudioVis): void;
  sensitivity: number;
  setSensitivity(v: number): void;
  differences: AudioDifference[];
  map: TimeMap | null;
  /** The difference selected (stepped to, or clicked), or -1. */
  current: number;
  /** Selects a difference and goes to its start: playing from a moment before it (by default), or just there. */
  goTo(i: number, play?: boolean): void;
  step(delta: 1 | -1): void;
  /** Pixels per second of the longer recording's width fitted to the view: 1 fits, higher zooms in. */
  zoom: number;
  setZoom(z: number): void;
  /* Playback. */
  heard: Side;
  /** Switches to the other recording at the same moment (by the alignment). */
  listen(side: Side): void;
  playing: boolean;
  toggle(): void;
  /** The time on the recording being heard, and each recording's time at that moment. */
  time: number;
  timeOf(side: Side): number;
  seek(side: Side, t: number): void;
  /**
   * Scrubbing: a drag along the playback bar or a track. The playheads follow
   * the pointer as it moves; with `scrubSound` on, the recording is heard
   * as it goes, and afterwards it plays on (or stays paused) as it was.
   */
  scrubStart(side: Side): void;
  scrubTo(t: number): void;
  scrubEnd(): void;
  scrubbing: boolean;
  /** Marking stretches for notes (a drag along a track), instead of scrubbing. */
  annotate: boolean;
  setAnnotate(v: boolean): void;
  scrubSound: boolean;
  setScrubSound(v: boolean): void;
  volume: number;
  setVolume(v: number): void;
  muted: boolean;
  setMuted(m: boolean): void;
  /** Plays the current difference over and over. */
  loop: boolean;
  setLoop(l: boolean): void;
  rate: number;
  setRate(r: number): void;
  /* Transcripts. */
  transcriptAvailable: boolean;
  transcript: TranscriptState;
  /**
   * Transcribes both recordings, where chosen (asking first, the first time,
   * before sending them to the server). A recording transcribed before isn't
   * transcribed again, unless `again`.
   */
  runTranscript(where?: TranscribeWhere, again?: boolean): void;
  /** Stops the transcription under way (what was shown before comes back). */
  stopTranscript(): void;
  where: TranscribeWhere;
  setWhere(w: TranscribeWhere): void;
  /** Whether each place can transcribe here. */
  can: Record<TranscribeWhere, boolean>;
  /** The server, asking whether the recordings may be sent to it (null when not asking). */
  consent: string | null;
  answerConsent(yes: boolean, remember: boolean): void;
  showTranscript: boolean;
  setShowTranscript(v: boolean): void;
  /** What comparing the transcripts leaves out (the punctuation, and the capitals that go with it, are the transcriber's guess). */
  ignore: WordsIgnore;
  setIgnore(i: WordsIgnore): void;
}

/**
 * Transcripts kept with the comparison (in its session, so a reload keeps
 * them): each recording's, by the recording (its content's key, so they follow
 * a swap and a replaced recording loses its own), and whether they were shown.
 */
export interface KeptTranscripts {
  byRecording: Record<string, Transcript>;
  shown: boolean;
}

/** Kept transcripts, from what was saved (null when there are none, or it isn't what was saved). */
export function readKeptTranscripts(x: unknown): KeptTranscripts | null {
  const k = x as Partial<KeptTranscripts> | null;
  if (!k || typeof k !== 'object' || !k.byRecording || typeof k.byRecording !== 'object') return null;
  const word = (w: unknown) => {
    const v = w as Word | null;
    return !!v && typeof v.text === 'string' && Number.isFinite(v.start) && Number.isFinite(v.end);
  };
  const byRecording: Record<string, Transcript> = {};
  for (const [key, t] of Object.entries(k.byRecording)) {
    if (t && typeof t.text === 'string' && Array.isArray(t.words) && t.words.every(word)) byRecording[key] = { text: t.text, words: t.words };
  }
  return { byRecording, shown: k.shown !== false };
}

/** The kept transcripts of these recordings (by their keys) only; null when there are none. */
export function keptFor(kept: KeptTranscripts | null, recordings: readonly string[]): KeptTranscripts | null {
  if (!kept) return null;
  const byRecording: Record<string, Transcript> = {};
  for (const key of recordings) if (key && kept.byRecording[key]) byRecording[key] = kept.byRecording[key];
  return Object.keys(byRecording).length ? { ...kept, byRecording } : null;
}

/** Where the transcripts are kept, and how to keep them (the workspace saves them with its session). */
export interface TranscriptKeeper {
  kept: KeptTranscripts | null;
  setKept(update: (k: KeptTranscripts | null) => KeptTranscripts | null): void;
}

/** Why a transcription is stopped when the recordings change under it. */
const REPLACED = 'replaced';

const WHERE_KEY = 'collate.transcribe-where';
const IGNORE_KEY = 'collate.transcript-ignore';

/** A transcript without the words made up where nothing was said (see heardWords). */
function heardOnly(t: Transcript, duration: number): Transcript {
  const words = heardWords(t.words, duration, t.quiet);
  // The same words, unless some were dropped or the last one brought back to the end.
  const same = words.length === t.words.length && words.every((w, i) => w === t.words[i]);
  return same ? t : { text: words.map((w) => w.text).join(' '), words };
}

/** A recording's player. */
function player(src: string | undefined): HTMLAudioElement | null {
  if (!src || typeof Audio === 'undefined') return null;
  const el = new Audio(src);
  el.preload = 'auto';
  return el;
}

/** The comparison of two recordings (with null, an idle one: hooks can't be called conditionally). */
export function useAudioCompare(docs: { a: Doc; b: Doc } | null, keeper?: TranscriptKeeper): AudioCompare {
  const objA = docs ? mediaObject(docs.a) : undefined;
  const objB = docs ? mediaObject(docs.b) : undefined;
  const [sides, setSides] = useState<Record<Side, AudioSide> | null>(null);
  const [error, setError] = useState('');
  const [feats, setFeats] = useState<{ a: Features; b: Features; map: TimeMap; path: ReturnType<typeof alignFrames> } | null>(null);
  const [vis, setVis] = useState<AudioVis>('wave');
  const [sensitivity, setSensitivity] = useState(70);
  const [current, setCurrent] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [heard, setHeard] = useState<Side>('a');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [transcript, setTranscript] = useState<TranscriptState>({ status: 'idle' });
  const [showTranscript, setShown] = useState(true);
  // Read when the recordings change, and when transcribing (what is kept doesn't itself start anything).
  const keep = useRef(keeper);
  keep.current = keeper;
  const setShowTranscript = useCallback((v: boolean) => {
    setShown(v);
    keep.current?.setKept((k) => (k ? { ...k, shown: v } : k));
  }, []);
  const [ignore, setIgnoreState] = useState<WordsIgnore>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IGNORE_KEY) ?? '{}') as Partial<WordsIgnore>;
      return { punctuation: saved.punctuation !== false, case: saved.case !== false };
    } catch {
      return { punctuation: true, case: true };
    }
  });
  const setIgnore = useCallback((i: WordsIgnore) => {
    setIgnoreState(i);
    try {
      localStorage.setItem(IGNORE_KEY, JSON.stringify(i));
    } catch {
      /* For this page only. */
    }
  }, []);
  // The server says whether it transcribes, a moment after the page opens.
  const [server, setServer] = useState(false);
  useEffect(() => {
    let live = true;
    void serverTranscribes().then((yes) => live && setServer(yes));
    return () => {
      live = false;
    };
  }, []);
  const can = useMemo(() => ({ device: canTranscribe(), server }), [server]);
  const [chosen, setWhereState] = useState<TranscribeWhere>(() => {
    try {
      return localStorage.getItem(WHERE_KEY) === 'server' ? 'server' : 'device';
    } catch {
      return 'device';
    }
  });
  // The choice, where it can be had (on this device when the server doesn't transcribe, and the other way round).
  const where: TranscribeWhere = chosen === 'server' ? (can.server || !can.device ? 'server' : 'device') : can.device ? 'device' : 'server';
  const setWhere = useCallback((w: TranscribeWhere) => {
    setWhereState(w);
    try {
      localStorage.setItem(WHERE_KEY, w);
    } catch {
      /* For this page only. */
    }
  }, []);
  const [consent, setConsent] = useState<string | null>(null);
  /** Said yes for this page only (not remembered). */
  const consentedNow = useRef(false);
  const [scrubSound, setScrubSound] = useState(false);
  const [annotate, setAnnotate] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  /** The scrub under way: the recording scrubbed, whether it was playing, and when it was last moved to be heard. */
  const scrub = useRef<{ side: Side; wasPlaying: boolean; heardAt: number; t: number } | null>(null);
  const players = useRef<Record<Side, HTMLAudioElement | null>>({ a: null, b: null });
  /** The transcription under way, to stop it. */
  const running = useRef<AbortController | null>(null);

  // Decoding.
  useEffect(() => {
    // A transcription under way was of the recordings before.
    running.current?.abort(REPLACED);
    setSides(null);
    setFeats(null);
    setError('');
    setCurrent(-1);
    setTime(0);
    setPlaying(false);
    setTranscript({ status: 'idle' });
    if (!docs || !objA?.data || !objB?.data) return;
    let live = true;
    Promise.all([decodeAudio(objA.data), decodeAudio(objB.data)]).then(
      ([da, db]) => {
        if (!live) return;
        setSides({ a: { name: docs.a.name, obj: objA, decoded: da }, b: { name: docs.b.name, obj: objB, decoded: db } });
        // These recordings' transcripts, if they were made before (this session, or before a reload), checked again against them.
        const kept = keep.current?.kept;
        const ka = kept?.byRecording[objA.key];
        const kb = kept?.byRecording[objB.key];
        if (!kept || !ka || !kb) return;
        setTranscript({ status: 'done', a: heardOnly(ka, da.duration), b: heardOnly(kb, db.duration) });
        setShown(kept.shown);
      },
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
    // The objects say which recordings these are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objA, objB]);

  // Lining up (a moment's work for long recordings: after the tracks are drawn).
  useEffect(() => {
    if (!sides) return;
    let live = true;
    const t = setTimeout(() => {
      const fa = features(sides.a.decoded.mono, ANALYSIS_RATE);
      const fb = features(sides.b.decoded.mono, ANALYSIS_RATE);
      const path = alignFrames(fa, fb);
      if (live) setFeats({ a: fa, b: fb, path, map: timeMap(path, fa.fps, fb.fps) });
    }, 30);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sides]);

  const differences = useMemo(() => (feats ? findDifferences(feats.a, feats.b, feats.path, { sensitivity }) : []), [feats, sensitivity]);

  // The players.
  useEffect(() => {
    const p = { a: player(sides?.a.obj.src), b: player(sides?.b.obj.src) };
    players.current = p;
    for (const el of [p.a, p.b]) el?.addEventListener('ended', () => setPlaying(false));
    return () => {
      p.a?.pause();
      p.b?.pause();
    };
  }, [sides]);
  useEffect(() => {
    for (const el of [players.current.a, players.current.b]) {
      if (!el) continue;
      el.volume = volume / 100;
      el.muted = muted;
      el.playbackRate = rate;
    }
  }, [volume, muted, rate, sides]);

  const map = feats?.map ?? null;
  const timeOf = useCallback((side: Side) => (side === heard ? time : !map ? time : heard === 'a' ? map.aToB(time) : map.bToA(time)), [heard, time, map]);

  // The clock, while playing; a looped difference starts again at its end.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = players.current[heard];
      // While scrubbing, the pointer sets the time.
      if (el && !scrub.current) {
        const d = differences[current];
        const [from, to] = d ? (heard === 'a' ? [d.aStart, Math.max(d.aEnd, d.aStart + 0.5)] : [d.bStart, Math.max(d.bEnd, d.bStart + 0.5)]) : [0, 0];
        if (loop && d && el.currentTime >= to) el.currentTime = Math.max(0, from - 0.3);
        setTime(el.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, heard, loop, current, differences]);

  const seek = useCallback(
    (side: Side, t: number) => {
      const other: Side = side === 'a' ? 'b' : 'a';
      const el = players.current[side];
      if (!el) return;
      if (side !== heard) {
        players.current[other]?.pause();
        setHeard(side);
      }
      el.currentTime = Math.max(0, t);
      setTime(el.currentTime);
      if (playing) void el.play().catch(() => setPlaying(false));
    },
    [heard, playing],
  );

  const listen = useCallback(
    (side: Side) => {
      if (side === heard) return;
      seek(side, timeOf(side));
    },
    [heard, seek, timeOf],
  );

  const toggle = useCallback(() => {
    const el = players.current[heard];
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
  }, [heard, playing]);

  const goTo = useCallback(
    (i: number, play = true) => {
      const d = differences[i];
      if (!d) return;
      setCurrent(i);
      // Played, from a moment before it, so it is heard coming in.
      const start = heard === 'a' ? d.aStart : d.bStart;
      const el = players.current[heard];
      if (!el) return;
      el.currentTime = Math.max(0, play ? start - 0.3 : start);
      setTime(el.currentTime);
      if (play)
        void el.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
    },
    [differences, heard],
  );

  const step = useCallback((delta: 1 | -1) => {
    if (!differences.length) return;
    goTo(current < 0 ? (delta > 0 ? 0 : differences.length - 1) : (current + delta + differences.length) % differences.length);
  }, [differences, current, goTo]);

  const scrubStart = useCallback(
    (side: Side) => {
      const other: Side = side === 'a' ? 'b' : 'a';
      const el = players.current[side];
      if (!el) return;
      if (side !== heard) {
        players.current[other]?.pause();
        setHeard(side);
      }
      scrub.current = { side, wasPlaying: playing, heardAt: 0, t: el.currentTime };
      setScrubbing(true);
      if (scrubSound) void el.play().catch(() => undefined);
      else el.pause();
    },
    [heard, playing, scrubSound],
  );

  const scrubTo = useCallback(
    (t: number) => {
      const s = scrub.current;
      const el = s && players.current[s.side];
      if (!s || !el) return;
      s.t = Math.min(Math.max(0, t), el.duration || Infinity);
      setTime(s.t);
      // Heard as it goes: moved to where the pointer is a few times a second, playing in between.
      const now = performance.now();
      if (scrubSound && now - s.heardAt > 70) {
        s.heardAt = now;
        el.currentTime = s.t;
      }
    },
    [scrubSound],
  );

  const scrubEnd = useCallback(() => {
    const s = scrub.current;
    scrub.current = null;
    setScrubbing(false);
    const el = s && players.current[s.side];
    if (!s || !el) return;
    el.currentTime = s.t;
    setTime(s.t);
    if (s.wasPlaying)
      void el.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    else el.pause();
  }, []);

  const run = useCallback(
    (w: TranscribeWhere, again = false) => {
      if (!sides) return;
      // A recording transcribed before (the other one was replaced) isn't transcribed again, unless asked.
      const kept = (!again && keep.current?.kept?.byRecording) || {};
      const [keyA, keyB] = [sides.a.obj.key, sides.b.obj.key];
      const ctl = new AbortController();
      running.current = ctl;
      const { signal } = ctl;
      let ta = kept[keyA] && heardOnly(kept[keyA], sides.a.decoded.duration);
      let tb = kept[keyB] && heardOnly(kept[keyB], sides.b.decoded.duration);
      void (async () => {
        try {
          const ready: Side | undefined = ta ? 'a' : tb ? 'b' : undefined;
          if (w === 'server') {
            // The service transcribes two at once.
            setTranscript({ status: 'working', side: ta ? 'b' : 'a', progress: { stage: 'server' }, ready });
            [ta, tb] = await Promise.all([
              ta ?? transcribeOnServer(sides.a.decoded.mono, undefined, signal).then((t) => (ta = heardOnly(t, sides.a.decoded.duration))),
              tb ?? transcribeOnServer(sides.b.decoded.mono, undefined, signal).then((t) => (tb = heardOnly(t, sides.b.decoded.duration))),
            ]);
          } else {
            if (!ta) {
              setTranscript({ status: 'working', side: 'a', progress: { stage: 'model', done: 0 }, ready });
              const t = await transcribe(sides.a.decoded.mono, (progress) => setTranscript({ status: 'working', side: 'a', progress, ready }), undefined, signal);
              ta = heardOnly(t, sides.a.decoded.duration);
            }
            if (!tb) {
              setTranscript({ status: 'working', side: 'b', progress: { stage: 'transcribing' }, ready });
              const t = await transcribe(sides.b.decoded.mono, (progress) => setTranscript({ status: 'working', side: 'b', progress, ready }), undefined, signal);
              tb = heardOnly(t, sides.b.decoded.duration);
            }
          }
          setTranscript({ status: 'done', a: ta, b: tb });
          setShown(true);
          // Kept for these two recordings only.
          keep.current?.setKept(() => ({ byRecording: { [keyA]: ta!, [keyB]: tb! }, shown: true }));
        } catch (e) {
          if (!signal.aborted) {
            setTranscript({ status: 'error', message: (e as Error).message });
            return;
          }
          // Stopped: for other recordings, nothing more; for these, what was shown before comes back, and a recording
          // transcribed before the stop isn't transcribed again next time.
          if (signal.reason === REPLACED) return;
          const before = keep.current?.kept?.byRecording ?? {};
          const pa = before[keyA];
          const pb = before[keyB];
          if (pa && pb) setTranscript({ status: 'done', a: heardOnly(pa, sides.a.decoded.duration), b: heardOnly(pb, sides.b.decoded.duration) });
          else setTranscript({ status: 'idle' });
          const done = { ...(ta && !pa ? { [keyA]: ta } : {}), ...(tb && !pb ? { [keyB]: tb } : {}) };
          if (Object.keys(done).length) keep.current?.setKept((k) => ({ byRecording: { ...(k?.byRecording ?? {}), ...done }, shown: k?.shown ?? true }));
        } finally {
          if (running.current === ctl) running.current = null;
        }
      })();
    },
    [sides],
  );

  const stopTranscript = useCallback(() => running.current?.abort(), []);

  /** Transcribing again (not keeping either transcript), once the reader has said the recordings may be sent. */
  const askedAgain = useRef(false);
  const runTranscript = useCallback(
    (w: TranscribeWhere = where, again = false) => {
      if (!sides || transcript.status === 'working' || !can[w]) return;
      if (w !== where) setWhere(w);
      // Nothing leaves the device without the reader's say-so.
      if (w === 'server' && !consentedNow.current && !consentGiven()) {
        askedAgain.current = again;
        setConsent(transcribeServer());
        return;
      }
      run(w, again);
    },
    [sides, transcript.status, can, where, setWhere, run],
  );

  const answerConsent = useCallback(
    (yes: boolean, remember: boolean) => {
      setConsent(null);
      if (!yes) return;
      consentedNow.current = true;
      rememberConsent(remember);
      run('server', askedAgain.current);
    },
    [run],
  );

  return {
    sides,
    error,
    busy: !!sides && !feats,
    vis,
    setVis,
    sensitivity,
    setSensitivity,
    differences,
    map,
    current,
    goTo,
    step,
    zoom,
    setZoom,
    heard,
    listen,
    playing,
    toggle,
    time,
    timeOf,
    seek,
    scrubStart,
    scrubTo,
    scrubEnd,
    scrubbing,
    annotate,
    setAnnotate,
    scrubSound,
    setScrubSound,
    volume,
    setVolume,
    muted,
    setMuted,
    loop,
    setLoop,
    rate,
    setRate,
    transcriptAvailable: can.device || can.server,
    transcript,
    runTranscript,
    stopTranscript,
    where,
    setWhere,
    can,
    consent,
    answerConsent,
    showTranscript,
    setShowTranscript,
    ignore,
    setIgnore,
  };
}
