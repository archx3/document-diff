/**
 * Spelling and grammar findings for the documents being compared: each
 * paragraph's text is checked once (per language) and the findings are
 * placed on the rows of the comparison, with Claude's where it was asked.
 */
import type { Comparison } from '../core/compare';
import type { Block } from '../core/model';
import type { Side } from '../review/anchor';
import { blockStream, hashText } from '../review/anchor';
import type { Ignores, Issue } from './check';
import { checkText, ignoreKey } from './check';
import { contractFindings } from './contract';
import type { Speller } from './spell';

export interface PlacedIssue {
  /** Identifies the finding while the documents stay as they are. */
  key: string;
  side: Side;
  rowKey: string;
  block: Block;
  issue: Issue;
}

/** Claude's findings, by the hash of the text they are about. */
export type ClaudeFindings = Readonly<Record<string, readonly Issue[]>>;

const cache = new Map<Speller, Map<string, Issue[]>>();

function localIssues(text: string, sp: Speller): Issue[] {
  let m = cache.get(sp);
  if (!m) cache.set(sp, (m = new Map()));
  let issues = m.get(text);
  if (!issues) {
    issues = checkText(text, sp);
    m.set(text, issues);
  }
  return issues;
}

/** Whether the reader dismissed a finding. */
export function isIgnored(i: Issue, ignores: Ignores): boolean {
  if (i.kind === 'spelling') {
    const w = i.text.replace(/’/g, "'").toLowerCase();
    return ignores.words.has(w) || ignores.words.has(w.replace(/'s$/, ''));
  }
  return ignores.rules.has(ignoreKey(i));
}

/**
 * Every finding in both documents, row by row. Code and data files (shown in
 * a monospace font) are not checked.
 */
export function placeIssues(cmp: Comparison, sp: Speller, ignores: Ignores, claude: ClaudeFindings): PlacedIssue[] {
  const out: PlacedIssue[] = [];
  const contract = contractFindings(cmp);
  for (const row of cmp.rows) {
    for (const side of ['a', 'b'] as const) {
      const block = side === 'a' ? row.l : row.r;
      const doc = side === 'a' ? cmp.left : cmp.right;
      if (!block || doc.mono) continue;
      const text = blockStream(block);
      if (!text) continue;
      const fromClaude = claude[hashText(text)] ?? [];
      const issues = [...localIssues(text, sp), ...fromClaude, ...(contract.get(block) ?? [])].filter((i) => !isIgnored(i, ignores));
      for (const issue of issues) out.push({ key: `${side}|${row.key}|${issue.source}|${issue.rule}|${issue.start}|${issue.end}`, side, rowKey: row.key, block, issue });
    }
  }
  return out;
}

/** How many findings each side has. */
export function countIssues(placed: readonly PlacedIssue[]): Record<Side, number> {
  const n = { a: 0, b: 0 };
  for (const p of placed) n[p.side]++;
  return n;
}
