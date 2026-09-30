import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });
const files = ['draft v1.txt', 'draft v2.txt', 'draft v10.txt'].map((n) => `${OUT}/${n}`);
writeFileSync(files[0]!, 'Services.\n\nPayment is due in 30 days.\n\nEnd.\n');
writeFileSync(files[1]!, 'Services.\n\nPayment is due in 45 days.\n\nEnd.\n');
writeFileSync(files[2]!, 'Services.\n\nPayment is due in 60 days.\n\nLate fees apply.\n\nEnd.\n');

test('several drafts are versions: the last two are compared, pairs stepped through, and a paragraph followed', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('opened')) return;
    sessionStorage.setItem('opened', '1');
    localStorage.clear();
    localStorage.setItem('collate.prefs.v1', JSON.stringify({ bands: false }));
  });
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.slot[data-side="a"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="file"]').click();
  await (await chooser).setFiles(files);

  // In the order of their names: v10 is the last.
  const bar = page.locator('.version-bar');
  await expect(bar).toContainText('3 versions');
  await expect(page.locator('.slot-name')).toHaveText(['draft v2.txt', 'draft v10.txt']);
  await bar.locator('[data-version-step="-1"]').click();
  await expect(page.locator('.slot-name')).toHaveText(['draft v1.txt', 'draft v2.txt']);
  await bar.locator('select[data-version="b"]').selectOption({ label: '3. draft v10.txt' });
  await expect(page.locator('.slot-name')).toHaveText(['draft v1.txt', 'draft v10.txt']);

  await page.locator('.cell.b', { hasText: 'Payment is due' }).first().click({ button: 'right' });
  await page.locator('#change-menu [data-mark="history"]').click();
  const steps = page.locator('.history-step');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Payment is due in 30 days.');
  await expect(steps.nth(1).locator('ins')).toHaveText('45');
  await expect(steps.nth(2).locator('ins')).toHaveText('60');
});
