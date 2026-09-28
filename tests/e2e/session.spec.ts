import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** What the counter says in full ("Change 1 of 7"). */
const counter = (page: Page) => page.locator('#counter .vh');
const rowByText = (page: Page, text: string) => page.locator('.row', { hasText: text }).first();

async function chooseFile(page: Page, button: string, path: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).first().click();
  await (await chooser).setFiles(path);
}

/** Reloads once the session has been written (it is written a moment after each change). */
async function reload(page: Page) {
  await page.waitForTimeout(700);
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('collate.prefs.v1', JSON.stringify({ bands: false })));
});

test('a reload keeps the changes copied in the sample, and the place in the documents', async ({ page }) => {
  await page.goto('/compare/sample/');
  await expect(counter(page)).toHaveText('Change 1 of 7');
  await rowByText(page, 'This agreement is made on').locator('button[data-act="l2r"]').click();
  await expect(page.locator('.slot[data-side="b"] .edited')).toHaveText('1 edit applied');
  await page.keyboard.press('n');
  await page.keyboard.press('n');
  await expect(counter(page)).toHaveText('Change 3 of 6');

  await reload(page);
  await expect(counter(page)).toHaveText('Change 3 of 6');
  await expect(page.locator('.slot[data-side="b"] .edited')).toHaveText('1 edit applied');
  await expect(page.locator('.cell.b', { hasText: '12 May 2026' })).toHaveCount(1);
  // The history of edits starts again.
  await expect(page.locator('#btn-undo')).toBeDisabled();
});

test('a reload keeps two Word files and the changes copied between them', async ({ page }) => {
  await page.goto('/compare/new/');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1.docx');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v2.docx');
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.docx']);
  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-r2l"]').click();
  await expect(page.locator('#toolbar')).toHaveClass(/\bsame\b/);

  await reload(page);
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.docx']);
  await expect(page.locator('.colhead .badge')).toHaveText(['Word', 'Word']);
  await expect(page.locator('#toolbar')).toHaveClass(/\bsame\b/);
  await expect(page.locator('.slot[data-side="a"] .edited')).toContainText('applied');

  // The comparison page opened afresh, in another tab, carries on with it too.
  const other = await page.context().newPage();
  await other.goto('/compare/');
  await expect(other).toHaveURL(/\/compare\/$/);
  await expect(other.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.docx']);
  await expect(other.locator('#toolbar')).toHaveClass(/\bsame\b/);
});

test('a new comparison replaces the one kept', async ({ page }) => {
  await page.goto('/compare/new/');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1.docx');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v2.docx');
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.docx']);
  await page.waitForTimeout(700);
  await page.goto('/compare/new/');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1.odt');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v2.odt');
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.odt', 'contract-v2.odt']);
  await reload(page);
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.odt', 'contract-v2.odt']);
});
