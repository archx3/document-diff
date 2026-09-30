/**
 * What matters in the changes: what each one touches (amounts, dates,
 * obligations …), worked out here, and Claude's summary once asked for.
 */
import { useMemo, useRef, useState } from 'react';
import { claudeError, claudeSampler } from '../../check/claude';
import type { SummaryPoint } from '../../check/summary';
import { summarizeWithClaude } from '../../check/summary';
import type { Comparison } from '../../core/compare';
import { changeRisks } from '../../review/risk';
import type { ToastFn } from '../toasts';

export type Summary = ReturnType<typeof useSummary>;

export function useSummary(cmp: Comparison | null, toast: ToastFn) {
  /** Claude's summary of what matters in the changes, once asked for (kept for the comparison it was made for). */
  const [summary, setSummary] = useState<{ cmp: Comparison; points: SummaryPoint[] } | null>(null);
  const points = summary && summary.cmp === cmp ? summary.points : null;
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);
  /** What each change touches (amounts, dates, obligations …), worked out here. */
  const risks = useMemo(() => (cmp ? changeRisks(cmp) : []), [cmp]);

  const summarize = async () => {
    const sample = await claudeSampler();
    if (!sample || !cmp || running) return;
    const ctl = new AbortController();
    stop.current = ctl;
    setRunning(true);
    try {
      const found = await summarizeWithClaude(sample, cmp, ctl.signal);
      if (ctl.signal.aborted) return;
      setSummary({ cmp, points: found });
      if (!found.length) toast('Claude found no changes to the meaning, only wording or formatting.');
    } catch (e) {
      toast(claudeError(e), { error: (e as { code?: string }).code !== 'cancelled' });
    } finally {
      setRunning(false);
      stop.current = null;
    }
  };

  return { points, running, risks, summarize, stop: () => stop.current?.abort() };
}
