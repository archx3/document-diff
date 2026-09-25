import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const counter = (page: Page) => page.locator('#counter');
const rowByText = (page: Page, text: string) => page.locator('.row', { hasText: text }).first();

async function loadFile(page: Page, side: 'a' | 'b', path: string) {
  // Either a "Choose file" button (opens the picker directly) or a "Replace" menu.
  const chooser = page.waitForEvent('filechooser');
  await page
    .locator(`.slot[data-side="${side}"] [data-menu="load"], .dropcard[data-side="${side}"] [data-load="file"], .dropcard[data-side="${side}"] [data-menu="load"]`)
    .filter({ visible: true })
    .first()
    .click();
  const menuItem = page.locator('.pop [data-load="file"]');
  if (await menuItem.isVisible().catch(() => false)) await menuItem.click();
  await (await chooser).setFiles(path);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(counter(page)).toContainText('of');
});

test('shows the sample comparison', async ({ page }) => {
  await expect(page.locator('#stats')).toContainText('12 changed');
  await expect(page.locator('#stats')).toContainText('1 only in A');
  await expect(page.locator('#stats')).toContainText('4 only in B');
  await expect(counter(page)).toHaveText('Change 1 of 7');
  await expect(page.locator('.row.k-mod')).toHaveCount(11);
  await expect(page.locator('.row.k-del')).toHaveCount(1);
  await expect(page.locator('.row.k-ins')).toHaveCount(3);
});

test('copies a paragraph across and undoes it', async ({ page }) => {
  const row = rowByText(page, 'This agreement is made on');
  await row.locator('button[data-act="l2r"]').click();
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(0);
  await expect(page.locator('.cell.b', { hasText: '12 May 2026' })).toHaveCount(1);
  await expect(page.locator('.slot[data-side="b"] .edited')).toHaveText('1 edit applied');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(0);
});

test('copies a single word-level change', async ({ page }) => {
  const row = rowByText(page, 'marketing website with up to');
  await row.locator('del.chg', { hasText: 'six' }).click();
  await expect(page.locator('.pop .chg-preview')).toContainText('six');
  await page.locator('.pop [data-inline="l2r"]').click();
  const b = page.locator('.cell.b', { hasText: 'marketing website with up to' });
  await expect(b).toContainText('up to six pages, a blog, a newsletter sign-up and a contact form.');
  // The other change in the paragraph is still pending.
  await expect(page.locator('.row.k-mod', { hasText: 'marketing website' })).toHaveCount(1);
});

test('keyboard navigation and copying', async ({ page }) => {
  await page.keyboard.press('n');
  await expect(counter(page)).toHaveText('Change 2 of 7');
  await page.keyboard.press('p');
  await expect(counter(page)).toHaveText('Change 1 of 7');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(counter(page)).toHaveText('Change 1 of 6');
});

test('copies table rows', async ({ page }) => {
  const row = page.locator('.row.k-tins', { hasText: 'Accessibility review' });
  await row.locator('button[data-act="r2l"]').click();
  await expect(page.locator('.row.k-tins')).toHaveCount(0);
  await expect(page.locator('.cell.a .tcell', { hasText: '$1,200' })).toHaveCount(1);
});

test('changes-only view folds unchanged paragraphs', async ({ page }) => {
  await page.locator('#btn-changes').click();
  await expect(page.locator('.row.fold').first()).toBeVisible();
  await page.locator('.fold-btn').first().click();
  await expect(page.locator('#btn-changes')).toHaveAttribute('aria-pressed', 'true');
});

test('options change what counts as a difference', async ({ page }) => {
  await page.locator('#btn-options').click();
  await page.locator('.pop input[data-opt="ignoreFormatting"]').check();
  // "Launch support for 30 days" differs only in bold.
  await expect(page.locator('#stats')).toContainText('11 changed');
  await page.locator('.pop input[data-opt="ignoreFormatting"]').uncheck();
  await expect(page.locator('#stats')).toContainText('12 changed');
});

test('pastes rich text from Google Docs', async ({ page }) => {
  await page.locator('.slot[data-side="a"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="paste"]').click();
  const box = page.locator('.pastebox');
  await expect(box).toBeFocused();
  await box.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h1 dir="ltr"><span style="font-weight:400">Project brief</span></h1><p dir="ltr"><span style="font-weight:400">Launch on </span><span style="font-weight:700">March 3</span></p></b>',
    );
    dt.setData('text/plain', 'Project brief\nLaunch on March 3');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  // Loading over the samples clears the other side.
  await expect(page.locator('.dropcard[data-side="a"] h2')).toHaveText('Pasted from Google Docs');
  await expect(page.locator('.dropcard[data-side="b"] h2')).toHaveText('Second version');
});

test('builds the Google Docs download link', async ({ page }) => {
  await page.locator('.slot[data-side="b"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="gdoc"]').click();
  await page.locator('#gd-url').fill('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
  await expect(page.locator('#gd-dl')).toHaveAttribute('href', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=docx');
});

test('loads two Word files, copies everything and exports a valid .docx', async ({ page }) => {
  await loadFile(page, 'a', 'tests/fixtures/contract-v1.docx');
  await expect(page.locator('.dropcard[data-side="a"] h2')).toHaveText('contract-v1.docx');
  await loadFile(page, 'b', 'tests/fixtures/contract-v2.docx');
  await expect(page.locator('.slot[data-side="b"] .slot-name')).toHaveText('contract-v2.docx');
  await expect(page.locator('#stats')).toContainText('changed');

  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-r2l"]').click();
  await expect(page.locator('#counter')).toHaveText('No differences');

  await page.locator('.slot[data-side="a"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="docx"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('contract-v1 (merged).docx');
  const path = `${OUT}/e2e-merged.docx`;
  await file.saveAs(path);

  const text = execFileSync('python3', ['-c', 'import sys, docx; print("\\n".join(p.text for p in docx.Document(sys.argv[1]).paragraphs))', path], {
    encoding: 'utf8',
  });
  expect(text).toContain('Accessibility review');
  expect(text).toContain('within 15 days');
  expect(text).not.toContain('Late payments');
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', OUT, path], { stdio: 'pipe', timeout: 120_000 });
    expect(readFileSync(path.replace(/\.docx$/, '.txt'), 'utf8')).toContain('Appendix A');
  } catch (e) {
    if (!String(e).includes('ENOENT')) throw e;
  }
});

test('has no horizontal scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
