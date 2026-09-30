import { useMemo } from 'react';
import { Ico } from '../components/icons';
import { inlineDiff } from '../core/compare';
import type { Doc } from '../core/model';
import type { CompareOptions } from '../core/tokens';
import type { HistoryStep } from '../core/versions';
import { blockHtml, inlineSideHtml } from './render';
import type { Side } from './util';

interface VersionBarProps {
  versions: readonly Doc[];
  a: Doc;
  b: Doc;
  onPick(side: Side, index: number): void;
  /** Compares the pair before or after (version 2 with 3, then 3 with 4 …). */
  onStep(delta: 1 | -1): void;
  onAdd(): void;
}

/** Drafts of one document: which two are compared, and stepping through them in order. */
export function VersionBar({ versions, a, b, onPick, onStep, onAdd }: VersionBarProps) {
  const ia = versions.indexOf(a);
  const ib = versions.indexOf(b);
  const pick = (side: Side, index: number) => (
    <select
      className="vb-select"
      data-version={side}
      aria-label={`Version shown as ${side.toUpperCase()}`}
      value={index}
      onChange={(e) => onPick(side, Number(e.currentTarget.value))}
    >
      {index < 0 && <option value={-1}>{(side === 'a' ? a : b).name} (edited)</option>}
      {versions.map((v, i) => (
        <option key={i} value={i}>
          {i + 1}. {v.name}
        </option>
      ))}
    </select>
  );
  const pair = ia >= 0 && ib === ia + 1;
  return (
    <div className="version-bar" role="group" aria-label="Versions">
      <span className="vb-title">{versions.length} versions</span>
      <button type="button" className="btn ghost sm" data-version-step="-1" disabled={pair ? ia === 0 : false} onClick={() => onStep(-1)} aria-label="Compare the pair before">
        <Ico name="up" />
      </button>
      <span className="vb-pair">
        <span className="siglum sm">A</span>
        {pick('a', ia)}
        <Ico name="arrow" />
        <span className="siglum sm">B</span>
        {pick('b', ib)}
      </span>
      <button
        type="button"
        className="btn ghost sm"
        data-version-step="1"
        disabled={pair ? ib === versions.length - 1 : false}
        onClick={() => onStep(1)}
        aria-label="Compare the pair after"
      >
        <Ico name="down" />
      </button>
      <button type="button" className="btn ghost sm" data-version-add onClick={onAdd}>
        <Ico name="plus" />
        <span>Add versions…</span>
      </button>
    </div>
  );
}

/** One paragraph through every version, each with what changed since the one before. */
export function HistoryDialog({ versions, steps, opts, a, b }: { versions: readonly Doc[]; steps: readonly HistoryStep[]; opts: CompareOptions; a: Doc; b: Doc }) {
  const rows = useMemo(
    () =>
      steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1]!.block : null;
        let html = '';
        if (s.block) {
          html = prev?.type === 'p' && s.block.type === 'p' && !s.same ? `<div class="blk r-p">${inlineSideHtml(s.block.spans, inlineDiff(prev, s.block, opts), 'b')}</div>` : blockHtml(s.block, new Map());
        }
        return { ...s, html, gone: !s.block && !!prev, notYet: !s.block && !prev };
      }),
    [steps, opts],
  );
  return (
    <>
      <h2>History of the paragraph</h2>
      <p className="dlg-sub">The paragraph in each version, with what was added since the version before.</p>
      <ol className="history-list">
        {rows.map((r) => {
          const v = versions[r.version]!;
          const tag = v === a ? 'A' : v === b ? 'B' : null;
          return (
            <li key={r.version} className={`history-step${r.block ? '' : ' absent'}`} data-version={r.version}>
              <div className="history-head">
                <span className="history-n">{r.version + 1}.</span>
                <span className="history-name">{v.name}</span>
                {tag && <span className="siglum sm">{tag}</span>}
                <span className="history-state">{r.block ? (r.same ? 'Unchanged' : r.version === 0 || !steps[r.version - 1]?.block ? 'Added' : 'Changed') : r.gone ? 'Removed' : 'Not there yet'}</span>
              </div>
              {r.block && !r.same && <div className="history-text doc" dangerouslySetInnerHTML={{ __html: r.html }} />}
            </li>
          );
        })}
      </ol>
    </>
  );
}
