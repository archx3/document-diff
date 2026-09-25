import { existsSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { compareDocs, inlineDiff } from '../../src/core/compare';
import { applySelection, selectAll } from '../../src/core/merge';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { docxBackend } from '../../src/formats/docx/backend';
import { readDocx } from '../../src/formats/docx/read';
import { exportDocx } from '../../src/formats/docx/writer';

it.skipIf(!existsSync('tests/fixtures/out/big-a.docx'))('large documents stay fast', () => {
  const t0 = performance.now();
  const a = readDocx(readFileSync('tests/fixtures/out/big-a.docx'), 'a');
  const b = readDocx(readFileSync('tests/fixtures/out/big-b.docx'), 'b');
  const t1 = performance.now();
  const cmp = compareDocs(a, b, DEFAULT_OPTIONS);
  const t2 = performance.now();
  for (const r of cmp.rows) if (r.kind === 'mod') inlineDiff(r.l!, r.r!, DEFAULT_OPTIONS);
  const t3 = performance.now();
  const merged = applySelection(cmp, 'l2r', selectAll(cmp), docxBackend).doc;
  const t4 = performance.now();
  const bytes = exportDocx(merged);
  const t5 = performance.now();
  const t6 = performance.now();
  compareDocs(a, merged, DEFAULT_OPTIONS);
  const recompareMs = Math.round(performance.now() - t6);
  const again = compareDocs(a, readDocx(bytes, 'm'), DEFAULT_OPTIONS);
  console.log(
    JSON.stringify({
      blocks: [a.blocks.length, b.blocks.length],
      hunks: cmp.hunks.length,
      stats: cmp.stats,
      parseMs: Math.round(t1 - t0),
      compareMs: Math.round(t2 - t1),
      inlineMs: Math.round(t3 - t2),
      mergeAllMs: Math.round(t4 - t3),
      exportMs: Math.round(t5 - t4),
      recompareMs,
      remaining: again.hunks.length,
    }),
  );
  if (again.hunks.length) throw new Error('merge did not converge');
});
