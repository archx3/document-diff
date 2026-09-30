/**
 * What was said in the two recordings, compared as documents are: each
 * transcript becomes a document of its sentences, and the two are shown side
 * by side as the text view shows documents (with connection bands, or in
 * aligned rows), the changed words marked. Clicking a sentence plays it, in
 * the recording it is in.
 */
import { useMemo, useRef, useState } from 'react';
import type { Transcript } from '../../audio/transcribe';
import type { Comparison } from '../../core/compare';
import { compareDocs } from '../../core/compare';
import { Ico } from '../../components/icons';
import type { Block, Doc } from '../../core/model';
import { blockText, newId, para, textSpan, wordCount } from '../../core/model';
import { DEFAULT_OPTIONS } from '../../core/tokens';
import { diffWords, pairedSentences } from '../../audio/words';
import { Counter } from '../counter';
import { ElasticLayout } from '../elastic';
import { ElasticGrid } from '../elastic-grid';
import { saveFile } from '../files';
import { DocumentGrid } from '../grid';
import { useInstance } from '../hooks';
import { gridItems } from '../rows';
import type { Side } from '../util';
import { SIDE_NAME, plural } from '../util';
import { transcribing } from './audio-tools';
import type { AudioCompare, TranscriptState } from './use-audio-compare';

export interface SpokenDoc {
  doc: Doc;
  /** When each sentence starts in its recording. */
  starts: Map<Block, number>;
}

/**
 * The two transcripts as documents: a paragraph for each sentence, cut at the
 * same places in both (so each faces the one said in its place), each
 * knowing when it was said.
 */
export function spokenDocs(t: { a: Transcript; b: Transcript }, names: Record<Side, string>): Record<Side, SpokenDoc> {
  const out = {
    a: { doc: { id: newId('d'), name: names.a, kind: 'text', blocks: [], version: 0 } as Doc, starts: new Map<Block, number>() },
    b: { doc: { id: newId('d'), name: names.b, kind: 'text', blocks: [], version: 0 } as Doc, starts: new Map<Block, number>() },
  };
  for (const pair of pairedSentences(diffWords(t.a.words, t.b.words))) {
    for (const side of ['a', 'b'] as const) {
      const words = pair[side];
      if (!words.length) continue;
      const b = para([textSpan(words.map((w) => w.text.trim()).join(' '))]);
      out[side].starts.set(b, words[0]!.start);
      out[side].doc.blocks.push(b);
    }
  }
  return out;
}

/** Where one recording's transcript is while the two are being made. */
function sideStatus(t: TranscriptState, side: Side): string {
  if (t.status === 'error') return 'Not transcribed';
  if (t.status !== 'working') return '';
  if (t.ready === side) return 'Transcribed';
  // The server transcribes both at once; this device, A and then B.
  if (t.progress.stage === 'server' || t.side === side) return transcribing(t);
  return side === 'a' ? 'Transcribed' : 'Waiting…';
}

export function TranscriptCompare({ ctl, bands }: { ctl: AudioCompare; bands: boolean }) {
  const t = ctl.transcript;
  const names = ctl.sides ? { a: ctl.sides.a.name, b: ctl.sides.b.name } : { a: 'A', b: 'B' };
  const spoken = useMemo(() => (t.status === 'done' ? spokenDocs(t, names) : null), [t, names.a, names.b]);
  const { punctuation, case: letterCase } = ctl.ignore;
  const cmp = useMemo<Comparison | null>(
    () => (spoken ? compareDocs(spoken.a.doc, spoken.b.doc, { ...DEFAULT_OPTIONS, ignorePunctuation: punctuation, ignoreCase: letterCase }) : null),
    [spoken, punctuation, letterCase],
  );
  const items = useMemo(() => (cmp ? gridItems(cmp.rows, false, new Set()) : []), [cmp]);
  const [current, setCurrent] = useState(0);
  const layout = useInstance(ElasticLayout, () => new ElasticLayout());
  /** The sentence last clicked (its row, and the side it was clicked on): played when the grid picks its change. */
  const clicked = useRef<{ key?: string; side: Side | null }>({ side: null });

  if (t.status === 'idle' || !ctl.showTranscript) return null;
  const silent = !!spoken && !spoken.a.doc.blocks.length && !spoken.b.doc.blocks.length;

  /** Plays a row: in the recording clicked, if the sentence is in it, or else in the one being heard first. */
  const playRow = (key: string, side = clicked.current.side) => {
    const row = cmp?.rows.find((r) => r.key === key);
    if (!row || !spoken) return;
    const first = side ?? ctl.heard;
    const order: Side[] = first === 'a' ? ['a', 'b'] : ['b', 'a'];
    for (const s of order) {
      const b = s === 'a' ? row.l : row.r;
      const at = b && spoken[s].starts.get(b);
      if (at !== undefined) {
        ctl.seek(s, Math.max(0, at - 0.2));
        if (!ctl.playing) ctl.toggle();
        return;
      }
    }
  };

  const head = (side: Side) => {
    const doc = spoken?.[side].doc;
    const name = SIDE_NAME[side];
    return (
      <div className={`colhead ${side}`}>
        <div className="slot" data-side={side}>
          <span className="siglum" aria-hidden="true">
            {name}
          </span>
          <div className="slot-main">
            <div className="slot-name" title={names[side]}>
              What {name} says <span className="said-of">· {names[side]}</span>
            </div>
            <div className="slot-meta">
              <span className="badge" data-kind="text">
                Transcript
              </span>
              {doc ? (
                doc.blocks.length ? (
                  <>
                    <span>{plural(wordCount(doc), 'word')}</span>
                    <span>{plural(doc.blocks.length, 'sentence')}</span>
                  </>
                ) : (
                  <span>No speech heard</span>
                )
              ) : (
                <span>{sideStatus(t, side)}</span>
              )}
            </div>
          </div>
          {doc && doc.blocks.length > 0 && (
            <div className="slot-actions">
              <button
                type="button"
                className="btn sm"
                data-said-export={side}
                title={`Download what ${name} says, as text`}
                onClick={() => void saveFile(`${names[side].replace(/\.[^.]+$/, '')} (transcript).txt`, new Blob([doc.blocks.map(blockText).join('\n\n') + '\n'], { type: 'text/plain' }))}
              >
                <Ico name="download" />
                <span>Export</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const pick = (hunk: number) => {
    setCurrent(hunk);
    const h = cmp?.hunks[hunk];
    if (!h) return;
    // The sentence clicked, or (for a band) the change's first.
    const rows = cmp.rows.slice(h.start, h.end);
    playRow(rows.find((r) => r.key === clicked.current.key)?.key ?? rows[0]!.key);
  };

  return (
    <section className="at-said-cmp" aria-label="What was said">
      <div className="colheads said-heads">
        {head('a')}
        <div className="colhead gut">
          {t.status === 'working' ? (
            <button type="button" className="btn sm" data-transcript-stop data-tip="Stop transcribing (Esc)" onClick={ctl.stopTranscript}>
              Stop
            </button>
          ) : (
            cmp && !silent && <Counter cmp={cmp} current={current} />
          )}
        </div>
        {head('b')}
      </div>
      {t.status === 'error' && <p className="field-error said-error">{t.message}</p>}
      {silent && <p className="said-none">No speech was heard in either recording.</p>}
      {cmp && !silent && (
        <div
          className="said-grid"
          onClickCapture={(e) => {
            const cell = (e.target as Element).closest('.cell');
            const row = (e.target as Element).closest<HTMLElement>('.row');
            clicked.current = { key: row?.dataset.key, side: cell ? (cell.classList.contains('a') ? 'a' : 'b') : null };
          }}
          // An unchanged sentence plays too (a changed one is picked, and plays, by the grid).
          onClick={(e) => {
            const row = (e.target as Element).closest<HTMLElement>('.row.k-eq');
            if (row?.dataset.key) playRow(row.dataset.key);
          }}
        >
          {bands ? (
            <ElasticGrid
              cmp={cmp}
              items={items}
              current={current}
              layout={layout}
              onCopyHunk={() => undefined}
              onFold={() => undefined}
              onInline={(_, rowKey) => playRow(rowKey)}
              onPick={pick}
              review={null}
            />
          ) : (
            <DocumentGrid
              cmp={cmp}
              items={items}
              current={current}
              onCopy={() => undefined}
              onFold={() => undefined}
              onInline={(_, rowKey) => playRow(rowKey)}
              onPick={pick}
              onRender={() => undefined}
              review={null}
            />
          )}
        </div>
      )}
      {!bands && !silent && <div className="endcap" />}
    </section>
  );
}
