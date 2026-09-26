import { Ico } from '../components/icons';
import type { Comparison } from '../core/compare';

/**
 * Which change is current, as "3/12" (its tooltip, and what screen readers
 * hear, says "Change 3 of 12"). A tick when there are no differences.
 */
export function Counter({ cmp, current, id, className }: Readonly<{ cmp: Comparison | null; current: number; id?: string; className?: string }>) {
  const n = cmp?.hunks.length ?? 0;
  const full = !cmp ? '' : n === 0 ? 'No differences' : `Change ${current + 1} of ${n}`;
  return (
    <span className={['counter', n === 0 && 'none', className].filter(Boolean).join(' ')} id={id} data-tip={full || undefined} aria-live="polite">
      {cmp && (
        <span className="c-short" aria-hidden="true">
          {n === 0 ? (
            <Ico name="check" />
          ) : (
            <>
              <b>{current + 1}</b>
              <span className="c-sep">/</span>
              {n}
            </>
          )}
        </span>
      )}
      <span className="vh">{full}</span>
    </span>
  );
}
