import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

const OUT = 'tests/fixtures/out';

test('downloads the comparison as a Word redline, with the reader’s name on the changes', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('opened')) return;
    sessionStorage.setItem('opened', '1');
    localStorage.clear();
  });
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');

  // A reaction to a change goes in as a comment.
  await page.locator('.cell.b [data-c]', { hasText: 'eight' }).first().click({ button: 'right' });
  await page.locator('#change-menu [data-react="down"]').click();
  await page.keyboard.press('Escape');

  await page.locator('#btn-redline').click();
  const menu = page.locator('.redline-menu');
  await expect(menu.locator('[data-redline="notes"]')).toBeChecked();
  await expect(menu).toContainText('Accept them all to get B');
  const name = menu.getByRole('textbox', { name: 'Your name on the changes' });
  await expect(name).toBeFocused();
  await name.fill('Ada Reviewer');
  const download = page.waitForEvent('download');
  await menu.locator('[data-redline="download"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Agreement, draft 2 (redline).docx');
  const path = `${OUT}/e2e-redline.docx`;
  await file.saveAs(path);

  const files = unzipSync(readFileSync(path));
  const xml = new TextDecoder().decode(files['word/document.xml']);
  const comments = new TextDecoder().decode(files['word/comments.xml']);
  expect(comments).toContain('Needs work');
  expect(comments).toContain('w:author="Ada Reviewer"');
  expect(xml).toContain('<w:commentRangeStart');
  expect(xml).toContain('<w:ins ');
  expect(xml).toContain('<w:delText');
  expect(xml).toContain('w:author="Ada Reviewer"');
  // A changed number: A's struck out, B's added.
  expect(xml).toMatch(/<w:delText[^>]*>12<\/w:delText>/);

  // The name is remembered.
  await page.reload();
  await page.locator('#btn-redline').click();
  await expect(page.locator('.redline-menu').getByRole('textbox')).toHaveValue('Ada Reviewer');
});
