import { expect, test } from '@playwright/test';

const OUT = 'tests/fixtures/out';

test('a review is saved as a locked file, and opened again elsewhere with its password', async ({ page, browser }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('opened')) return;
    sessionStorage.setItem('opened', '1');
    localStorage.clear();
    localStorage.setItem('collate.prefs.v1', JSON.stringify({ sidebar: true }));
  });
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');
  await page.keyboard.press('a');
  await page.keyboard.press('x');

  await page.locator('#btn-share').click();
  const menu = page.locator('.share-menu');
  await menu.getByRole('textbox', { name: 'Your name on your notes' }).fill('Ada');
  await menu.locator('[data-share="password"]').fill('s3cret');
  const download = page.waitForEvent('download');
  await menu.locator('[data-share="save"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Agreement, draft 2 (review).collate');
  const path = `${OUT}/e2e-review.collate`;
  await file.saveAs(path);

  // Someone else, in another browser.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/compare/new/');
  const chooser = other.waitForEvent('filechooser');
  await other.goto('/compare/sample/');
  await other.locator('#btn-share').click();
  await other.locator('.share-menu [data-share="open"]').click();
  await (await chooser).setFiles(path);
  const dlg = other.locator('dialog.unlock');
  await expect(dlg).toContainText('This review file is locked');
  await dlg.locator('[data-unlock="password"]').fill('nope');
  await dlg.locator('[data-unlock="open"]').click();
  await expect(dlg.locator('.field-error')).toContainText('does not open');
  await dlg.locator('[data-unlock="password"]').fill('s3cret');
  await dlg.locator('[data-unlock="open"]').click();
  await expect(dlg).toBeHidden();
  await expect(other.locator('.toast').last()).toContainText('reviewed by Ada');
  await other.keyboard.press('s');
  await expect(other.locator('.decide-bar')).toContainText('2 of 7 decided');
  await expect(other.locator('.chg-item').nth(1).locator('.chg-status')).toHaveText('Rejected');
});
