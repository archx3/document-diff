import { beforeAll, describe, expect, it } from 'vitest';
import { checkText, grammarIssues, spellingIssues } from '../../src/check/check';
import type { Speller } from '../../src/check/spell';
import { loadSpeller } from '../../src/check/spell';

let us: Speller;
let gb: Speller;
beforeAll(async () => {
  [us, gb] = await Promise.all([loadSpeller('en-US'), loadSpeller('en-GB')]);
});

const found = (issues: ReturnType<typeof checkText>) => issues.map((i) => `${i.rule}:${i.text}${i.suggestions.length ? `>${i.suggestions[0]}` : ''}`);

describe('spelling', () => {
  it('finds misspelled words and suggests the likely ones first', () => {
    const issues = spellingIssues('We will recieve teh files and definately reply.', us);
    expect(issues.map((i) => i.text)).toEqual(['recieve', 'teh', 'definately']);
    expect(us.suggest('teh')[0]).toBe('the');
    expect(us.suggest('recieve')[0]).toBe('receive');
    expect(us.suggest('definately')).toContain('definitely');
  });

  it('knows American and British spelling apart', () => {
    expect(spellingIssues('The organisation chose a colour.', us).map((i) => i.text)).toEqual(['organisation', 'colour']);
    expect(spellingIssues('The organisation chose a colour.', gb)).toEqual([]);
  });

  it('leaves acronyms, product names, addresses, codes and possessives alone', () => {
    expect(spellingIssues('Send the PDF to info@northwind.example or see https://northwind.example/qwzx — the iPhone app, form A4b, the contract’s terms.', us)).toEqual([]);
  });

  it('accepts words the reader added', () => {
    expect(spellingIssues('Northwind Studio', us).map((i) => i.text)).toEqual(['Northwind']);
    expect(spellingIssues('Northwind’s studio', us, { words: new Set(['northwind']), rules: new Set() })).toEqual([]);
  });
});

describe('grammar', () => {
  it('finds mistakes that are certain from the words alone', () => {
    expect(found(grammarIssues('We will send the the files. an user asked for a apple. then it ended.'))).toEqual([
      'repeat:the the>the',
      'article:an>a',
      'capital:an>An',
      'article:a>an',
      'capital:then>Then',
    ]);
    expect(found(grammarIssues('It could of been better then that, and i agree.'))).toEqual(['could-of:could of>could have', 'than:better then>better than', 'pronoun:i>I']);
    expect(found(grammarIssues('Fees,taxes and  costs ,paid..'))).toEqual(['space-after:,>, ', 'spaces:  > ', 'doubled:..>.']);
  });

  it('lets correct text pass', () => {
    const fine = 'An hour later, a university sent an email. E.g. the results, i.e. the scores (i) and (ii), etc. are in. He had had enough. A one-off fee is due… then paid. See www.example.com/a..b for more.';
    expect(found(grammarIssues(fine))).toEqual([]);
  });

  it('forgets what the reader dismissed', () => {
    expect(grammarIssues('the the', { words: new Set(), rules: new Set(['repeat:the the']) })).toEqual([]);
  });
});
