/**
 * The playback bar under the tracks: the time heard so far, the scrubber (with
 * the differences marked on it) and the length; below, the controls — the
 * transcript, which recording is heard (A or B, switched at the same moment),
 * the previous difference, play, the next difference, looping the difference,
 * hearing the sound while scrubbing, the speed and the volume. Dragging along
 * the bar scrubs (the playheads on the tracks follow); a difference's mark
 * goes to its start.
 */
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioDifference } from '../../audio/align';
import { Ico } from '../../components/icons';
import { Slider } from '../../components/ui/slider';
import { clock } from '../facts';
import type { AudioCompare } from './use-audio-compare';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const KIND_NAME: Record<AudioDifference['kind'], string> = { changed: 'Sounds different', added: 'Only in B', removed: 'Only in A' };

export function PlaybackBar({ ctl }: { ctl: AudioCompare }) {
  const { sides, heard, differences } = ctl;
  const duration = sides ? sides[heard].decoded.duration : 0;
  const t = Math.min(ctl.time, duration);
  const track = useRef<HTMLDivElement>(null);
  const shown = t;

  const timeAt = (e: ReactPointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
  };
  const pct = duration ? (shown / duration) * 100 : 0;

  return (
    <div className="playback" role="group" aria-label="Playback">
      <div className="pb-line">
        <span className="pb-time" data-time="elapsed">
          {clock(shown)}
        </span>
        <div
          className="pb-track"
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={`Position in ${heard.toUpperCase()}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
          data-scrubbing={ctl.scrubbing || undefined}
          onPointerDown={(e) => {
            if (!duration || e.button !== 0 || (e.target as Element).closest('.pb-mark')) return;
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            ctl.scrubStart(heard);
            ctl.scrubTo(timeAt(e));
          }}
          onPointerMove={(e) => ctl.scrubbing && ctl.scrubTo(timeAt(e))}
          onPointerUp={() => ctl.scrubbing && ctl.scrubEnd()}
          onPointerCancel={() => ctl.scrubbing && ctl.scrubEnd()}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
            if (!d) return;
            e.preventDefault();
            ctl.seek(heard, Math.min(duration, Math.max(0, t + d)));
          }}
        >
          <span className="pb-rail" />
          {duration > 0 &&
            differences.map((d, i) => {
              const [s, e] = heard === 'a' ? [d.aStart, d.aEnd] : [d.bStart, d.bEnd];
              return (
                <button
                  type="button"
                  key={i}
                  tabIndex={-1}
                  className={`pb-mark ${d.kind}`}
                  data-mark={i}
                  data-on={i === ctl.current || undefined}
                  data-tip={`${KIND_NAME[d.kind]} · ${clock(s)}`}
                  aria-label={`Go to the difference at ${clock(s)}`}
                  style={{ left: `${(s / duration) * 100}%`, width: `max(4px, ${((e - s) / duration) * 100}%)` }}
                  onClick={() => ctl.goTo(i, false)}
                />
              );
            })}
          <span className="pb-progress" style={{ width: `${pct}%` }} />
          <span className="pb-thumb" style={{ left: `${pct}%` }} />
        </div>
        <span className="pb-time" data-time="duration">
          {clock(duration)}
        </span>
      </div>
      <div className="pb-controls">
        <button
          type="button"
          className="pb-btn"
          data-pb="transcript"
          aria-pressed={ctl.showTranscript && ctl.transcript.status === 'done'}
          aria-label="Transcript"
          data-tip={ctl.transcript.status === 'done' ? 'Show or hide the transcripts (T)' : 'Transcribe both recordings (T)'}
          disabled={!ctl.transcriptAvailable}
          onClick={() => (ctl.transcript.status === 'done' ? ctl.setShowTranscript(!ctl.showTranscript) : ctl.runTranscript())}
        >
          <Ico name="transcript" />
        </button>
        <button
          type="button"
          className="pb-btn pb-ab"
          data-pb="switch"
          aria-label={`Listening to ${heard.toUpperCase()}: switch to ${heard === 'a' ? 'B' : 'A'}`}
          data-tip="Switch to the other recording, at the same moment (A / B)"
          onClick={() => ctl.listen(heard === 'a' ? 'b' : 'a')}
        >
          <Ico name="abSwitch" />
          <b data-side={heard}>{heard.toUpperCase()}</b>
        </button>
        <button type="button" className="pb-btn" data-pb="prev" aria-label="Previous difference" data-tip="Previous difference (P)" disabled={!differences.length} onClick={() => ctl.step(-1)}>
          <Ico name="skipBack" />
        </button>
        <button type="button" className="pb-btn pb-play" data-pb="play" aria-label={ctl.playing ? 'Pause' : 'Play'} data-tip={ctl.playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!sides} onClick={ctl.toggle}>
          <Ico name={ctl.playing ? 'pause' : 'play'} size={22} />
        </button>
        <button type="button" className="pb-btn" data-pb="next" aria-label="Next difference" data-tip="Next difference (N)" disabled={!differences.length} onClick={() => ctl.step(1)}>
          <Ico name="skipForward" />
        </button>
        <button
          type="button"
          className="pb-btn"
          data-pb="loop"
          aria-pressed={ctl.loop}
          aria-label="Loop the difference"
          data-tip="Play the difference over and over (L)"
          disabled={ctl.current < 0}
          onClick={() => ctl.setLoop(!ctl.loop)}
        >
          <Ico name="loop" />
        </button>
        <button
          type="button"
          className="pb-btn"
          data-pb="scrub"
          aria-pressed={ctl.scrubSound}
          aria-label="Hear while scrubbing"
          data-tip={ctl.scrubSound ? 'Scrubbing is heard: turn it off' : 'Hear the recording while scrubbing'}
          onClick={() => ctl.setScrubSound(!ctl.scrubSound)}
        >
          <Ico name="scrub" />
        </button>
        <button
          type="button"
          className="pb-btn pb-rate"
          data-pb="rate"
          aria-label={`Speed ${ctl.rate}×`}
          data-tip="Playback speed"
          onClick={() => ctl.setRate(RATES[(RATES.indexOf(ctl.rate) + 1) % RATES.length]!)}
        >
          {ctl.rate}×
        </button>
        <span className="pb-volume">
          <button type="button" className="pb-btn" data-pb="mute" aria-pressed={ctl.muted} aria-label={ctl.muted ? 'Unmute' : 'Mute'} data-tip={ctl.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => ctl.setMuted(!ctl.muted)}>
            <Ico name={ctl.muted || ctl.volume === 0 ? 'mute' : 'volume'} />
          </button>
          <span className="pb-vol-slider">
            <Slider label="Volume" value={ctl.volume} onChange={ctl.setVolume} step={25} fine showLabels={false} minorTicks={0} data-pb="volume" />
          </span>
        </span>
      </div>
    </div>
  );
}
