import type { Metadata } from 'next';
import Link from 'next/link';
import { GuidePage } from '../../../components/guide-page';
import type { Step } from '../../../components/replica/walkthrough';

export const metadata: Metadata = {
  title: 'Comparing audio',
  description: 'A step-by-step walkthrough of comparing two recordings in Collate: tracks lined up in time, differences marked, A/B playback and transcripts.',
};

const STEPS: Step[] = [
  {
    title: 'Two recordings, A and B',
    focus: 'heads',
    body: <p>Choose two recordings and they are compared as sound. The column heads give each one’s length, sample rate and channels.</p>,
  },
  {
    title: 'Lined up in time',
    focus: 'tracks',
    body: (
      <p>
        A is drawn over B on one time scale. The recordings are lined up first, so a pause or phrase added in one doesn’t make everything after it look different. Click a track to move the
        playhead there.
      </p>
    ),
  },
  {
    title: 'What differs, and where',
    focus: 'bands',
    body: (
      <p>
        Each difference is marked on both tracks and joined by a band between them: blue where the recordings <i>sound different</i>, green where something is <i>only in B</i>, red where it is{' '}
        <i>only in A</i>.
      </p>
    ),
  },
  {
    title: 'Three ways to draw it',
    focus: 'vis',
    body: (
      <p>
        <b>Waveform</b> shows the shape of the sound, <b>Spectrogram</b> its pitches over time, and <b>Loudness</b> how loud it is. Switch with <kbd>1</kbd> to <kbd>3</kbd>.
      </p>
    ),
  },
  {
    title: 'Step through the differences',
    focus: 'nav',
    body: (
      <p>
        The arrows, or <kbd>N</kbd> and <kbd>P</kbd>, go from one difference to the next and put the playhead at its start. The count gives how many there are and how long they last together.
      </p>
    ),
  },
  {
    title: 'Listen',
    focus: 'playback',
    body: <p>Under the tracks: the time, a scrubber with the differences marked on it, and the controls. Play, jump between differences, loop the current one, and change the speed and volume.</p>,
  },
  {
    title: 'Switch between A and B',
    focus: 'ab',
    body: <p>The A/B switch jumps to the other recording at the same moment of what is being said or played, so you can hear a difference back to back.</p>,
  },
  {
    title: 'How small a difference counts',
    focus: 'sensitivity',
    body: <p>Sensitivity sets how small a difference has to be to be marked. Lower it in the replica and the slightly different “Please” is no longer counted.</p>,
  },
  {
    title: 'Compare what was said',
    focus: 'transcript',
    body: (
      <>
        <p>
          <b>Transcribe</b> runs a speech model on this device and compares the two transcripts word by word. Click any word to play from there. Started by mistake? Stop it with the × beside it, or press Esc.
        </p>
        <p>Nothing is sent anywhere. The model is about 41 MB and is downloaded once, then kept by the browser.</p>
      </>
    ),
  },
];

export default function AudioGuide() {
  return (
    <GuidePage
      kind="audio"
      href="/guides/audio/"
      title={
        <>
          Comparing <em>audio</em>
        </>
      }
      lead="Hear exactly what changed between two takes, two edits or two exports of a recording. The replica is silent, but everything else works."
      steps={STEPS}
      formats={[
        ['WAV', '.wav', 'Uncompressed, the most exact comparison.'],
        ['MP3, M4A/AAC', '.mp3 .m4a .aac', 'Compressed formats are decoded by your browser first.'],
        ['Ogg, Opus, FLAC', '.ogg .oga .opus .flac', ''],
        ['WebM', '.webm', 'Audio only.'],
      ]}
      tips={[
        ['Mixed formats are fine', 'A WAV can be compared with an M4A of the same take. Both are decoded by your browser before comparing.'],
        ['Speech and music', 'The alignment works on any sound. The transcript is for speech, and works best on clear recordings.'],
        ['Keyboard', 'N and P step through the differences, and 1 to 3 switch between waveform, spectrogram and loudness.'],
      ]}
      sample={
        <>
          Try the <Link href="/samples/#audio">audio samples</Link>: two takes of a spoken sentence, the same takes as WAV and M4A, and a short tune with one note changed.
        </>
      }
    />
  );
}
