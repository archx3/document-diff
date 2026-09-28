/**
 * Spelling: Hunspell's English dictionaries (US or UK) through nspell, loaded
 * the first time checking is turned on. Everything happens in the browser.
 */
import nspell from 'nspell';
import { unzlibSync } from 'fflate';

export type Lang = 'en-US' | 'en-GB';

export const LANG_NAME: Record<Lang, string> = { 'en-US': 'English (US)', 'en-GB': 'English (UK)' };

export interface Speller {
  lang: Lang;
  correct(word: string): boolean;
  /** Up to `max` corrections, the likeliest first. */
  suggest(word: string, max?: number): string[];
}

/** Typing slips nspell's suggestions miss or rank low. */
const TYPOS: Record<string, string> = {
  teh: 'the',
  adn: 'and',
  taht: 'that',
  hte: 'the',
  thier: 'their',
  recieve: 'receive',
  wich: 'which',
  becuase: 'because',
  alot: 'a lot',
  seperate: 'separate',
  untill: 'until',
  occured: 'occurred',
};

const decoded = (b64: string) => new TextDecoder().decode(unzlibSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));

const loading = new Map<Lang, Promise<Speller>>();

/** The speller for a language, loading its dictionary on first use. */
export function loadSpeller(lang: Lang): Promise<Speller> {
  let p = loading.get(lang);
  if (!p) {
    p = (async () => {
      const dict = lang === 'en-GB' ? await import('./dict/en-gb.gen') : await import('./dict/en-us.gen');
      return makeSpeller(lang, nspell(decoded(dict.aff), decoded(dict.dic)));
    })();
    p.catch(() => loading.delete(lang));
    loading.set(lang, p);
  }
  return p;
}

function makeSpeller(lang: Lang, spell: ReturnType<typeof nspell>): Speller {
  const seen = new Map<string, boolean>();
  const correct = (word: string) => {
    let ok = seen.get(word);
    if (ok === undefined) {
      ok = spell.correct(word);
      seen.set(word, ok);
    }
    return ok;
  };
  return {
    lang,
    correct,
    suggest(word, max = 5) {
      const out: string[] = [];
      const add = (w: string) => {
        if (w && w !== word && !out.includes(w)) out.push(w);
      };
      const lower = word.toLowerCase();
      const cap = (w: string) => (word[0] === word[0]!.toUpperCase() && word.slice(1) === word.slice(1).toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w);
      if (TYPOS[lower]) add(cap(TYPOS[lower]!));
      // Two letters the wrong way round.
      for (let i = 0; i < word.length - 1; i++) {
        const w = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
        if (correct(w)) add(w);
      }
      // nspell can take a while over long unknown words: only ask it for ordinary ones.
      if (word.length <= 16 && /^[\p{L}'’-]+$/u.test(word)) for (const w of spell.suggest(word)) add(w);
      return out.slice(0, max);
    },
  };
}
