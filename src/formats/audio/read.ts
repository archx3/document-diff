/**
 * An audio file (MP3, WAV, M4A/AAC, Ogg/Opus, FLAC, WebM) as a document of one
 * recording, so two versions of it are compared (the audio view: waveforms,
 * where they differ, playback and a transcript) and it can be kept, shared and
 * saved like any other document. The sound itself is decoded by the browser
 * when it is shown (audio/decode.ts).
 */
import type { Doc } from '../../core/model';
import { OBJ_CHAR, hashBytes, newId } from '../../core/model';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

/** The audio format of a file, from its first bytes (and extension where the bytes are shared with video); null when it isn't one. */
export function audioMime(bytes: Uint8Array, ext = ''): string | null {
  const at = (i: number, s: string) => [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0));
  if (at(0, 'RIFF') && at(8, 'WAVE')) return MIME.wav!;
  if (at(0, 'fLaC')) return MIME.flac!;
  if (at(0, 'OggS')) return ext === 'opus' ? 'audio/ogg; codecs=opus' : MIME.ogg!;
  if (at(0, 'ID3')) return MIME.mp3!;
  // MPEG audio frames, or AAC in ADTS frames.
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return ((bytes[1] ?? 0) & 0x06) === 0 ? MIME.aac! : MIME.mp3!;
  // MP4 and WebM hold video as often as sound: the extension says which.
  if (at(4, 'ftyp') && ['m4a', 'aac', 'mp4'].includes(ext)) return MIME.m4a!;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && ext === 'webm') return MIME.webm!;
  return null;
}

export function readAudio(bytes: Uint8Array, name: string, mime: string): Doc {
  const src = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) : undefined;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return {
    id: newId('d'),
    name,
    kind: 'audio',
    formatLabel: (ext || mime.split('/')[1]!.replace(/^mpeg$/, 'mp3')).toUpperCase(),
    ext,
    version: 0,
    blocks: [
      {
        id: newId('p'),
        type: 'p',
        props: { role: 'p' },
        spans: [{ text: OBJ_CHAR, fmt: {}, obj: { kind: 'audio', key: `aud:${hashBytes(bytes)}`, label: name, src, data: bytes, mime } }],
      },
    ],
  };
}
