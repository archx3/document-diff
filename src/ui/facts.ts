/**
 * What a column head says about its document, by kind: a document's words and
 * paragraphs, a picture's size in pixels, a recording's length and sound —
 * each with the file's size. Facts that need the file decoded (a picture's
 * size when the file doesn't say, a recording's length) come a moment later.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Doc, InlineObject } from '../core/model';
import { isBlank, wordCount } from '../core/model';
import { decodeAudio } from '../audio/decode';
import { loadImage } from '../image/draw';
import { kindOf } from '../media/kinds';
import { plural } from './util';

/** The recording or picture a media document holds. */
export function mediaObject(doc: Doc): InlineObject | undefined {
  const b = doc.blocks[0];
  return b?.type === 'p' ? b.spans.find((s) => s.obj?.kind === 'image' || s.obj?.kind === 'audio')?.obj : undefined;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A length of time as 3:09, or 1:02:03. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const channelsName = (n: number) => (n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} channels`);

/** The facts for a document's head (text: words and paragraphs; images and audio: what they are). */
export function useFacts(doc: Doc): string[] {
  const kind = kindOf(doc);
  const obj = kind === 'text' ? undefined : mediaObject(doc);
  const [late, setLate] = useState<string[] | null>(null);

  useEffect(() => {
    setLate(null);
    if (!obj) return;
    let live = true;
    if (kind === 'image' && !(obj.width && obj.height) && obj.src) {
      loadImage(obj.src).then(
        (img) => live && setLate([`${img.naturalWidth} × ${img.naturalHeight} px`]),
        () => undefined,
      );
    } else if (kind === 'audio' && obj.data) {
      decodeAudio(obj.data).then(
        (d) =>
          live &&
          setLate([
            clock(d.duration),
            d.sampleRate ? `${+(d.sampleRate / 1000).toFixed(2)} kHz` : `${Math.round(d.bitrate / 1000)} kbps`,
            channelsName(d.channels),
          ]),
        (e) => live && setLate([(e as Error).message]),
      );
    }
    return () => {
      live = false;
    };
  }, [obj, kind]);

  return useMemo(() => {
    if (kind === 'text') {
      const paras = doc.blocks.filter((b) => b.type !== 'marker' && !isBlank(b)).length;
      return [plural(wordCount(doc), 'word'), `${paras.toLocaleString()} ¶`];
    }
    const size = obj?.data ? [fileSize(obj.data.length)] : [];
    if (kind === 'image') {
      const dims = obj?.width && obj.height ? [`${Math.round(obj.width)} × ${Math.round(obj.height)} px`] : (late ?? []);
      const mp = obj?.width && obj.height && obj.width * obj.height >= 1e6 ? [`${((obj.width * obj.height) / 1e6).toFixed(1)} MP`] : [];
      return [...dims, ...mp, ...size];
    }
    return [...(late ?? ['Reading…']), ...size];
  }, [doc, kind, obj, late]);
}
