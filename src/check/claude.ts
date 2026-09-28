/**
 * Grammar and style suggestions from Claude, for when the page runs in the
 * Claude app (as a published artifact that may ask Claude). The reader turns
 * it on, and it only ever runs when asked: each request sends the chosen
 * paragraphs to Claude on the reader's own account, after the app asks them
 * to allow it. Everywhere else it is simply not there.
 */
import type { Issue } from './check';
import type { Lang } from './spell';
import { LANG_NAME } from './spell';

/** The artifact runtime's `sample` function: ask Claude, get JSON back. */
export interface Sampler {
  json<T = unknown>(input: string, options?: { signal?: AbortSignal; modelTier?: 'quick' | 'default' | 'complex' }): Promise<T>;
}

let sampler: Promise<Sampler | null> | null = null;

/** Claude, where this page can ask it; null elsewhere. */
export function claudeSampler(): Promise<Sampler | null> {
  sampler ??= (async () => {
    const c = (globalThis as { claude?: { use?(name: string): Promise<unknown> } }).claude;
    if (typeof c?.use !== 'function') return null;
    try {
      const s = (await c.use('sample')) as Sampler | null;
      return s && typeof s.json === 'function' ? s : null;
    } catch {
      return null;
    }
  })();
  return sampler;
}

/** A paragraph to check, with a key to find its findings by. */
export interface Paragraph {
  key: string;
  text: string;
}

interface Finding {
  p?: unknown;
  text?: unknown;
  fix?: unknown;
  why?: unknown;
}

/** Characters of paragraph text in one request (well under the 64 KiB limit). */
const BATCH_CHARS = 6000;
const BATCH_PARAS = 40;

/** Paragraphs in requests of a sensible size. */
export function batches(paras: readonly Paragraph[]): Paragraph[][] {
  const out: Paragraph[][] = [];
  let cur: Paragraph[] = [];
  let size = 0;
  for (const p of paras) {
    const t = p.text.slice(0, BATCH_CHARS);
    if (cur.length && (size + t.length > BATCH_CHARS || cur.length >= BATCH_PARAS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push({ key: p.key, text: t });
    size += t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function prompt(paras: readonly Paragraph[], lang: Lang): string {
  return [
    `You are a careful copy editor for ${LANG_NAME[lang]}. Check each numbered paragraph below for mistakes in spelling, grammar, punctuation and word choice.`,
    'Flag only real mistakes: leave names, terms of art, tone and style alone, and do not rewrite sentences that are already correct.',
    'Reply with only a JSON array, one object per mistake: {"p": <paragraph number>, "text": "<the wrong words, copied exactly from the paragraph>", "fix": "<what to write instead>", "why": "<the reason, in at most 12 words>"}.',
    'Keep "text" as short as possible while still unique in its paragraph. Reply [] when there are no mistakes.',
    '',
    ...paras.map((p, i) => `[${i + 1}] ${p.text.replace(/\s+/g, ' ')}`),
  ].join('\n');
}

/** Claude's findings as issues, found in their paragraphs' text (findings whose words are not there are dropped). */
export function toIssues(paras: readonly Paragraph[], reply: unknown): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>(paras.map((p) => [p.key, []]));
  if (!Array.isArray(reply)) return out;
  for (const f of reply as Finding[]) {
    const n = typeof f?.p === 'number' ? f.p : Number(f?.p);
    const para = paras[n - 1];
    if (!para || typeof f.text !== 'string' || !f.text || typeof f.fix !== 'string' || f.fix === f.text) continue;
    const issues = out.get(para.key)!;
    // The first place with those words that no other finding has taken.
    let at = para.text.indexOf(f.text);
    while (at >= 0 && issues.some((i) => at < i.end && at + (f.text as string).length > i.start)) at = para.text.indexOf(f.text, at + 1);
    if (at < 0) continue;
    issues.push({
      kind: 'grammar',
      rule: 'claude',
      start: at,
      end: at + f.text.length,
      text: f.text,
      message: typeof f.why === 'string' && f.why ? f.why : 'Suggested by Claude',
      suggestions: [f.fix],
      source: 'claude',
    });
  }
  for (const issues of out.values()) issues.sort((x, y) => x.start - y.start);
  return out;
}

/**
 * Asks Claude about paragraphs, a batch at a time, reporting each batch's
 * findings as they come. Rejects with the runtime's error ({code, message})
 * when a request fails; an abort stops it.
 */
export async function claudeCheck(
  sample: Sampler,
  paras: readonly Paragraph[],
  lang: Lang,
  onBatch: (found: Map<string, Issue[]>, done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const all = batches(paras.filter((p) => /\p{L}/u.test(p.text)));
  let done = 0;
  for (const batch of all) {
    if (signal?.aborted) return;
    const reply = await sample.json(prompt(batch, lang), { signal, modelTier: 'default' });
    done++;
    onBatch(toIssues(batch, reply), done, all.length);
  }
}

/** What to tell the reader when Claude could not be asked. */
export function claudeError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  switch (code) {
    case 'cancelled':
      return 'Stopped.';
    case 'not_granted':
      return 'Claude wasn’t allowed to check the text.';
    case 'rate_limited':
      return 'Claude is busy. Try again in a minute.';
    case 'prompt_too_large':
      return 'That is too much text to send at once.';
    case 'invalid_json':
      return 'Claude’s answer could not be read. Try again.';
    default:
      return 'Claude could not be reached. Try again later.';
  }
}
