import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/check-a.txt`, 'We will recieve teh files on Monday.\n\nThe the report is ready. an user asked for a apple.\n\nThe colour of the logo.\n');
writeFileSync(`${OUT}/check-b.txt`, 'We will receive the files on Monday.\n\nThe report is ready.\n\nThe color of the logo.\n');

async function chooseFile(page: Page, path: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).first().click();
  await (await chooser).setFiles(path);
}

/** The words underlined with a highlight of this name. */
const painted = (page: Page, name: string) =>
  page.evaluate((name) => {
    const h = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights.get(name);
    return h ? [...h].map((r) => r.toString()) : [];
  }, name);

/** Clicks the underlined words. */
async function clickWords(page: Page, name: string, words: string) {
  const at = await page.evaluate(
    ([name, words]) => {
      const h = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights.get(name!)!;
      const r = [...h].find((x) => x.toString() === words)!;
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    [name, words],
  );
  await page.mouse.click(at.x, at.y);
}

async function open(page: Page) {
  await page.goto('/compare/new/');
  await chooseFile(page, `${OUT}/check-a.txt`);
  await chooseFile(page, `${OUT}/check-b.txt`);
  await expect(page.locator('.slot-name')).toHaveText(['check-a.txt', 'check-b.txt']);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('opened')) return;
    sessionStorage.setItem('opened', '1');
    localStorage.clear();
    localStorage.setItem('collate.prefs.v1', JSON.stringify({ bands: false, lang: 'en-US' }));
  });
});

test('underlines mistakes, and a suggestion corrects the document', async ({ page }) => {
  await open(page);
  await expect(page.locator('#btn-check')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('g');
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['recieve', 'teh', 'colour']);
  expect(await painted(page, 'collate-grammar')).toEqual(expect.arrayContaining(['The the', 'an', 'a']));
  await expect(page.locator('#btn-check .tbadge')).toBeVisible();

  await clickWords(page, 'collate-spell', 'teh');
  const card = page.locator('#issue-card');
  await expect(card).toContainText('“teh” isn’t in the dictionary.');
  await expect(card.locator('[data-fix]').first()).toHaveText('the');
  await card.locator('[data-fix="the"]').click();
  await expect(page.locator('.cell.a').first()).toHaveText('We will recieve the files on Monday.');
  await expect(page.locator('.slot[data-side="a"] .edited')).toHaveText('1 edit applied');
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['recieve', 'colour']);

  // A grammar fix, then undo.
  await clickWords(page, 'collate-grammar', 'The the');
  await page.locator('#issue-card [data-fix="The"]').click();
  await expect(page.locator('.cell.a', { hasText: 'report is ready' })).toContainText('The report is ready.');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cell.a', { hasText: 'report is ready' })).toContainText('The the report is ready.');
});

test('words added to the dictionary stay spelled right, and British spelling can be chosen', async ({ page }) => {
  await open(page);
  await page.keyboard.press('g');
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['recieve', 'teh', 'colour']);
  await clickWords(page, 'collate-spell', 'recieve');
  await page.locator('#issue-card [data-issue="add"]').click();
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['teh', 'colour']);

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('#btn-check')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['teh', 'colour']);

  await page.locator('#btn-check-menu').click();
  await expect(page.locator('.check-menu')).toContainText('1 word in your dictionary');
  await page.locator('.check-menu [data-lang="en-GB"]').click();
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['teh', 'color']);
  await page.locator('.check-menu [data-check="clear-words"]').click();
  await expect.poll(() => painted(page, 'collate-spell')).toEqual(['recieve', 'teh', 'color']);
});

test('Claude is offered only in the Claude app, and its suggestions can be applied', async ({ page }) => {
  // Outside the Claude app it is not there.
  await open(page);
  await page.keyboard.press('g');
  await page.locator('#btn-check-menu').click();
  await expect(page.locator('.check-menu [data-check="claude"]')).toBeDisabled();
  await expect(page.locator('.check-menu')).toContainText('Available when Collate runs in the Claude app.');

  // In it, the runtime's sample function answers (here, a stand-in that finds one mistake).
  await page.addInitScript(() => {
    const asked: string[] = [];
    (window as unknown as { asked: string[] }).asked = asked;
    (window as unknown as { claude: unknown }).claude = {
      use: async (name: string) =>
        name === 'sample'
          ? {
              json: async (input: string) => {
                asked.push(input);
                const n = input.split('\n').find((l) => l.includes('on Monday'))?.match(/^\[(\d+)\]/)?.[1];
                return n ? [{ p: Number(n), text: 'on Monday', fix: 'by Monday', why: 'The files are due by then' }] : [];
              },
            }
          : null,
    };
  });
  await page.reload();
  await expect(page.locator('#btn-check')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-check-menu').click();
  const menu = page.locator('.check-menu');
  await menu.locator('[data-check="claude"]').check();
  await menu.locator('[data-check="claude-a"]').click();
  await expect(page.locator('.toast').last()).toContainText('Claude suggested 1 correction in A');
  expect(await page.evaluate(() => (window as unknown as { asked: string[] }).asked.length)).toBe(1);
  await expect.poll(() => painted(page, 'collate-grammar')).toContain('on Monday');

  await clickWords(page, 'collate-grammar', 'on Monday');
  const card = page.locator('#issue-card');
  await expect(card.locator('.ic-kind')).toHaveText('Claude');
  await expect(card).toContainText('The files are due by then');
  await card.locator('[data-fix="by Monday"]').click();
  await expect(page.locator('.cell.a').first()).toContainText('files by Monday.');
});

test('contract checks: a missing clause, and words and figures that disagree', async ({ page }) => {
  writeFileSync(`${OUT}/contract-a.txt`, '1. Services\n\n1.1 The work.\n\n2. Payment\n\n2.1 The fee is nine thousand dollars ($9,000).\n\n2.2 As set out in clause 1.1.\n');
  writeFileSync(`${OUT}/contract-b.txt`, '1. Services\n\n1.1 The work.\n\n2. Payment\n\n2.1 The fee is nine thousand dollars ($9,500).\n\n2.2 As set out in clause 3.4.\n');
  await page.goto('/compare/new/');
  await chooseFile(page, `${OUT}/contract-a.txt`);
  await chooseFile(page, `${OUT}/contract-b.txt`);
  await expect(page.locator('.slot-name')).toHaveText(['contract-a.txt', 'contract-b.txt']);
  await page.keyboard.press('g');
  await expect.poll(() => painted(page, 'collate-contract')).toEqual(['$9,500', 'clause 3.4']);
  await clickWords(page, 'collate-contract', 'clause 3.4');
  const card = page.locator('#issue-card');
  await expect(card.locator('.ic-kind')).toHaveText('Contract check');
  await expect(card).toContainText('There is no clause 3.4 in this document');
  await page.keyboard.press('Escape');
  await clickWords(page, 'collate-contract', '$9,500');
  await card.locator('[data-fix="$9,000"]').click();
  await expect(page.locator('.cell.b', { hasText: 'The fee is' }).first()).toContainText('($9,000)');
});
