/**
 * The audio tools, in the toolbar's three groups: the differences (stepping
 * through them, and how many), how the recordings are shown and compared
 * (the form, the sensitivity, the transcript), and the zoom.
 */
import { useCallback, useRef, useState } from 'react';
import { Ico } from '../../components/icons';
import { Segmented } from '../../components/ui/segmented';
import { GraduatedRangeSlider } from '../../components/ui/slider';
import { Dialog } from '../dialogs';
import { Popover } from '../menus';
import { Tool } from '../toolbar';
import type { AudioCompare, AudioVis, TranscribeWhere, TranscriptState } from './use-audio-compare';

export const AUDIO_VIS: ReadonlyArray<{ value: AudioVis; label: string; key: string; tip: string }> = [
  { value: 'wave', label: 'Waveform', key: '1', tip: 'Waveform (1)' },
  { value: 'spectrum', label: 'Spectrogram', key: '2', tip: 'Spectrogram: the pitches over time (2)' },
  { value: 'loudness', label: 'Loudness', key: '3', tip: 'Loudness over time (3)' },
];

export function AudioNav({ ctl }: { ctl: AudioCompare }) {
  const n = ctl.differences.length;
  const total = ctl.differences.reduce((s, d) => s + Math.max(d.aEnd - d.aStart, d.bEnd - d.bStart), 0);
  return (
    <>
      <div className="tgroup nav">
        <Tool id="btn-diff-prev" icon="up" label="Previous difference" kbd="P" disabled={!n} onClick={() => ctl.step(-1)} />
        <Tool id="btn-diff-next" icon="down" label="Next difference" kbd="N" disabled={!n} onClick={() => ctl.step(1)} />
      </div>
      <span className="media-stats" role="status" data-stats>
        {!ctl.sides || ctl.busy
          ? 'Comparing…'
          : n
            ? `${ctl.current >= 0 ? `${ctl.current + 1} of ` : ''}${n} ${n === 1 ? 'difference' : 'differences'} · ${total.toFixed(1)} s`
            : 'No differences heard'}
      </span>
    </>
  );
}

/** What the transcription is doing, in a few words. */
export function transcribing(t: TranscriptState, short = false): string {
  if (t.status !== 'working') return '';
  const p = t.progress;
  if (p.stage === 'server') return short ? 'On the server…' : 'Transcribing on the server…';
  if (p.stage === 'model') return short ? `Model ${Math.round(p.done * 100)}%` : `Loading the speech model… ${Math.round(p.done * 100)}%`;
  return `Transcribing ${t.side.toUpperCase()}…`;
}

const WHERE: Record<TranscribeWhere, { label: string; hint: string }> = {
  device: { label: 'On this device', hint: 'Private: nothing leaves your browser. Slower, and a smaller model.' },
  server: { label: 'On the transcription server', hint: 'Faster, with a larger model. The recordings are sent there, with your consent, and not kept.' },
};

export function AudioModes({ ctl }: { ctl: AudioCompare }) {
  const t = ctl.transcript;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const both = ctl.can.device && ctl.can.server;
  return (
    <>
      <Segmented className="text" label="How to show the recordings" value={ctl.vis} onChange={ctl.setVis} segments={AUDIO_VIS.map((v) => ({ value: v.value, content: v.label, tip: v.tip, kbd: v.key, attrs: { 'data-vis': v.value } }))} />
      <label className="tool-field" data-tip="Sensitivity: how small a difference counts">
        <span className="tool-field-name">Sensitivity</span>
        <GraduatedRangeSlider className="tool-slider" label="Sensitivity" data-control="sensitivity" value={ctl.sensitivity} onChange={ctl.setSensitivity} step={10} labelStep={50} />
      </label>
      <Tool
        id="btn-annotate"
        icon="note"
        label="Notes on the recordings"
        tip={ctl.annotate ? 'Stop adding notes (C)' : 'Add notes: drag along a track to mark a stretch, or click a moment (C)'}
        kbd="C"
        toggle
        pressed={ctl.annotate}
        onClick={() => ctl.setAnnotate(!ctl.annotate)}
      />
      <span className="split-btn">
        <button
          type="button"
          className="btn sm"
          id="btn-transcribe"
          data-where={ctl.where}
          data-tip={
            !ctl.transcriptAvailable
              ? 'Transcripts aren’t available in this build'
              : t.status === 'done'
                ? 'Show or hide what was said (T)'
                : ctl.where === 'server'
                  ? 'Transcribe both recordings on the transcription server, and compare what was said (T)'
                  : 'Transcribe both recordings on this device (Whisper), and compare what was said (T)'
          }
          disabled={!ctl.sides || !ctl.transcriptAvailable || t.status === 'working'}
          onClick={() => (t.status === 'done' ? ctl.setShowTranscript(!ctl.showTranscript) : ctl.runTranscript())}
        >
          <Ico name="transcript" />
          <span>{t.status === 'working' ? transcribing(t, true) : t.status === 'done' ? (ctl.showTranscript ? 'Hide transcript' : 'Show transcript') : 'Transcribe'}</span>
        </button>
        {t.status === 'working' ? (
          // Started by mistake, or taking too long: it stops, and what was shown before comes back.
          <button type="button" className="btn sm split-more" id="btn-transcribe-stop" aria-label="Stop transcribing" data-tip="Stop transcribing (Esc)" onClick={ctl.stopTranscript}>
            <Ico name="close" size={12} />
          </button>
        ) : (
          ctl.transcriptAvailable && (
            <button
              type="button"
              className="btn sm split-more"
              id="btn-transcribe-where"
              aria-haspopup="true"
              aria-expanded={!!menu || undefined}
              aria-label="Transcript options"
              data-tip={both ? `Transcript options (transcribing ${WHERE[ctl.where].label.toLowerCase()})` : 'Transcript options'}
              onClick={(e) => setMenu(menu ? null : e.currentTarget)}
            >
              <Ico name="chevron" size={12} />
            </button>
          )
        )}
      </span>
      {menu && (
        <Popover anchor={menu} className="where-menu" onClose={closeMenu}>
          <div className="menu" role="dialog" aria-label="Transcript options">
            {(both || t.status === 'done') && (
              <>
                <p className="menu-title">Transcribe</p>
                {both && (
                  <div role="menu" aria-label="Where to transcribe">
                    {(['device', 'server'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        className="mi"
                        role="menuitemradio"
                        aria-checked={ctl.where === w}
                        data-where={w}
                        onClick={() => {
                          setMenu(null);
                          if (t.status === 'done') ctl.setWhere(w);
                          else ctl.runTranscript(w);
                        }}
                      >
                        <Ico name={ctl.where === w ? 'check' : w === 'device' ? 'lock' : 'upload'} />
                        <span>{WHERE[w].label}</span>
                        <small>{WHERE[w].hint}</small>
                      </button>
                    ))}
                  </div>
                )}
                {t.status === 'done' && (
                  <button
                    type="button"
                    className="mi"
                    data-transcribe-again
                    onClick={() => {
                      setMenu(null);
                      ctl.runTranscript(ctl.where, true);
                    }}
                  >
                    <Ico name="transcript" />
                    <span>Transcribe again</span>
                    <small>{WHERE[ctl.where].label}, in place of these transcripts</small>
                  </button>
                )}
                <div className="menu-sep" />
              </>
            )}
            <p className="menu-title">Ignore in the transcripts</p>
            <label className="opt">
              <input type="checkbox" data-ignore="punctuation" checked={ctl.ignore.punctuation} onChange={(e) => ctl.setIgnore({ ...ctl.ignore, punctuation: e.currentTarget.checked })} />
              <span>
                Punctuation<small>Full stops, commas and quotes: the transcriber guesses them</small>
              </span>
            </label>
            <label className="opt">
              <input type="checkbox" data-ignore="case" checked={ctl.ignore.case} onChange={(e) => ctl.setIgnore({ ...ctl.ignore, case: e.currentTarget.checked })} />
              <span>
                Upper and lower case<small>Capitals follow the guessed full stops</small>
              </span>
            </label>
          </div>
        </Popover>
      )}
      {ctl.consent && <ConsentDialog server={ctl.consent} onAnswer={ctl.answerConsent} />}
    </>
  );
}

/** Asks before the recordings are sent anywhere. */
function ConsentDialog({ server, onAnswer }: { server: string; onAnswer(yes: boolean, remember: boolean): void }) {
  const [remember, setRemember] = useState(false);
  const answered = useRef(false);
  const answer = (yes: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onAnswer(yes, remember);
  };
  let host = server;
  try {
    host = new URL(server).host;
  } catch {
    /* Shown as it is. */
  }
  return (
    <Dialog className="consent" onClose={() => answer(false)}>
      <h2>Send the recordings to be transcribed?</h2>
      <p>
        Both recordings will be sent to this site’s server (<b>{host}</b>), transcribed there, and the text sent back. Until now, they haven’t left this browser.
      </p>
      <ul className="consent-list">
        <li>What is sent: the sound only (16 kHz, one channel), not the files’ names.</li>
        <li>The server deletes each recording as soon as it has transcribed it, and keeps no copy.</li>
        <li>Transcribing on this device instead keeps everything here; it is slower.</li>
      </ul>
      <label className="consent-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-consent="remember" />
        <span>Don’t ask again in this browser</span>
      </label>
      <div className="dlg-actions">
        <button type="button" className="btn" data-consent="no" onClick={() => answer(false)}>
          Keep them here
        </button>
        <button type="button" className="btn primary" data-consent="yes" data-autofocus onClick={() => answer(true)}>
          Send and transcribe
        </button>
      </div>
    </Dialog>
  );
}

export function AudioZoom({ ctl }: { ctl: AudioCompare }) {
  const set = (z: number) => ctl.setZoom(Math.min(64, Math.max(1, z)));
  return (
    <div className="tgroup zoom" role="group" aria-label="Zoom">
      <Tool id="btn-zoom-out" icon="minus" label="Zoom out" kbd="-" disabled={ctl.zoom <= 1} onClick={() => set(ctl.zoom / 1.5)} />
      <button type="button" className="btn ghost text-btn zoom-level" data-zoom="fit" data-tip="The whole recordings (0)" onClick={() => ctl.setZoom(1)}>
        {ctl.zoom === 1 ? 'Fit' : `${ctl.zoom.toFixed(ctl.zoom < 10 ? 1 : 0)}×`}
      </button>
      <Tool id="btn-zoom-in" icon="plus" label="Zoom in" kbd="+" onClick={() => set(ctl.zoom * 1.5)} />
    </div>
  );
}

/** Keys for the audio tools; true when a key did something. */
export function audioKey(ctl: AudioCompare, e: { key: string; shiftKey?: boolean }): boolean {
  const v = AUDIO_VIS.find((x) => x.key === e.key);
  if (v) ctl.setVis(v.value);
  else if (e.key === ' ') ctl.toggle();
  else if (e.key === 'n' || e.key === 'j') ctl.step(1);
  else if (e.key === 'p' || e.key === 'k') ctl.step(-1);
  else if (e.key === 'a' || e.key === 'b') ctl.listen(e.key);
  else if (e.key === 'l') ctl.setLoop(!ctl.loop);
  else if (e.key === 'c') ctl.setAnnotate(!ctl.annotate);
  else if (e.key === 'm') ctl.setMuted(!ctl.muted);
  // T transcribes, shows and hides the transcript, and stops a transcription under way; so does Esc.
  else if (e.key === 't') ctl.transcript.status === 'working' ? ctl.stopTranscript() : ctl.transcript.status === 'done' ? ctl.setShowTranscript(!ctl.showTranscript) : ctl.runTranscript();
  else if (e.key === 'Escape' && ctl.transcript.status === 'working') ctl.stopTranscript();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') ctl.seek(ctl.heard, ctl.time + (e.key === 'ArrowRight' ? 5 : -5));
  else if (e.key === '+' || e.key === '=') ctl.setZoom(Math.min(64, ctl.zoom * 1.5));
  else if (e.key === '-') ctl.setZoom(Math.max(1, ctl.zoom / 1.5));
  else if (e.key === '0') ctl.setZoom(1);
  else return false;
  return true;
}
