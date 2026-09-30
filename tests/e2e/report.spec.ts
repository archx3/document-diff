import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const OUT = 'tests/fixtures/out';

test('flags changes, summarises them with Claude, and downloads a report with the summary', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('opened')) {
      sessionStorage.setItem('opened', '1');
      localStorage.clear();
      localStorage.setItem('collate.prefs.v1', JSON.stringify({ sidebar: true }));
    }
    // The Claude app's runtime (a stand-in): the summary of the sample's changes.
    (window as unknown as { claude: unknown }).claude = {
      use: async (name: string) =>
        name === 'sample' ? { json: async () => [{ text: 'The agreement date moved a week later.', changes: [1] }, { text: 'The site grows from six to eight pages.', changes: [2, 3] }] } : null,
    };
  });
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');

  // Flags, worked out here: the first change is a date.
  await expect(page.locator('.chg-card[data-hunk="0"] [data-risk="date"]')).toBeVisible();
  await page.locator('[data-filter="flagged"]').check();
  const flagged = await page.locator('.chg-item').count();
  expect(flagged).toBeLessThan(7);
  await page.locator('[data-filter="flagged"]').uncheck();

  await page.locator('[data-summary="ask"]').click();
  const points = page.locator('.summary-points li');
  await expect(points).toHaveCount(2);
  await expect(points.first()).toContainText('The agreement date moved a week later.');
  await points.nth(1).locator('[data-go="2"]').click();
  await expect(page.locator('#counter .vh')).toContainText('Change 3 of 7');

  await page.keyboard.press('a');
  await page.locator('#btn-report').click();
  const menu = page.locator('.report-menu');
  await expect(menu.locator('[data-report="summary"]')).toBeChecked();
  await menu.locator('[data-format="docx"]').click();
  const download = page.waitForEvent('download');
  await menu.locator('[data-report="download"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Agreement, draft 2 (report).docx');
  const path = `${OUT}/e2e-report.docx`;
  await file.saveAs(path);
  const xml = new TextDecoder().decode(unzipSync(readFileSync(path))['word/document.xml']);
  expect(xml).toContain('Comparison report');
  expect(xml).toContain('What matters');
  expect(xml).toContain('The site grows from six to eight pages.');
  expect(xml).toContain('Change 3: Changed');
  expect(xml).toContain('Accepted');
});
