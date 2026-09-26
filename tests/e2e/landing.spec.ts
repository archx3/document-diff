import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Drops files made in the page anywhere on it, as dragging them from the desktop would. */
async function dropFiles(page: Page, files: Array<{ name: string; text: string }>) {
  const data = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([f.text], f.name));
    return dt;
  }, files);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
}

async function chooseFile(page: Page, button: string, path: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).first().click();
  await (await chooser).setFiles(path);
}

const firstCard = (page: Page) => page.getByRole('region', { name: 'First version' });
const otherCard = (page: Page) => page.getByRole('region', { name: 'Other version' });
// (Next.js announces page changes in an alert of its own, outside <main>.)
const problem = (page: Page) => page.getByRole('main').getByRole('alert');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('the landing page asks for a file and leads to the sample', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/See every change,\s*word by word\./);
  await expect(page.getByRole('heading', { name: 'Drop your first document here' })).toBeVisible();
  await page.getByRole('link', { name: 'See a sample comparison' }).first().click();
  await expect(page).toHaveURL(/\/compare\/sample\/$/);
  await expect(page.locator('#counter')).toHaveText('Change 1 of 7');
});

test('compares a file chosen on the landing page with another of the same kind', async ({ page }) => {
  await page.goto('/');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1.docx');

  await expect(page).toHaveURL(/\/compare\/new\/$/);
  await expect(page.getByText('Step 2 of 2')).toBeVisible();
  await expect(firstCard(page).getByRole('heading')).toHaveText('contract-v1.docx');
  await expect(firstCard(page)).toContainText('Word document');
  // The other version must be a Word document too.
  await expect(otherCard(page)).toContainText('Word documents only (.docx, .doc)');
  await expect(page.locator('input[type="file"]').last()).toHaveAttribute('accept', '.docx,.doc,.docm,.dotx,.dotm,.dot');

  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v2.docx');
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.docx']);
  await expect(page.locator('#stats')).toContainText('changed');
  // The documents replace the samples.
  await expect(page.locator('.notice')).not.toContainText('Sample drafts');
});

test('files dropped on the landing page start a comparison', async ({ page }) => {
  await page.goto('/');
  await dropFiles(page, [{ name: 'plan-v1.md', text: '# Plan\n\nWe launch on 12 May with six pages.\n' }]);
  await expect(page).toHaveURL(/\/compare\/new\/$/);
  await expect(firstCard(page).getByRole('heading')).toHaveText('plan-v1.md');

  // A different kind of file is turned away.
  await dropFiles(page, [{ name: 'plan-v2.txt', text: 'Plan' }]);
  await expect(problem(page)).toHaveText('“plan-v2.txt” is a text file. Choose a Markdown file to compare with “plan-v1.md”.');
  await expect(page).toHaveURL(/\/compare\/new\/$/);

  await dropFiles(page, [{ name: 'plan-v2.md', text: '# Plan\n\nWe launch on 19 May with eight pages.\n' }]);
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['plan-v1.md', 'plan-v2.md']);
  await expect(page.locator('#counter')).toHaveText('Change 1 of 1');
});

test('two files dropped together go straight to the comparison', async ({ page }) => {
  await page.goto('/');
  await dropFiles(page, [
    { name: 'notes-a.txt', text: 'Alpha\nBeta\n' },
    { name: 'notes-b.txt', text: 'Alpha\nGamma\n' },
  ]);
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['notes-a.txt', 'notes-b.txt']);
});

test('explains a first file that cannot be read', async ({ page }) => {
  await page.goto('/');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1-password.pdf');
  await expect(page).toHaveURL(/\/compare\/new\/$/);
  await expect(problem(page)).toContainText('password protected');
  await expect(page.getByText('Step 1 of 2')).toBeVisible();
});

test('the new comparison page works on its own', async ({ page }) => {
  await page.goto('/compare/new/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose the first version');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v1.odt');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Now choose the other version');
  await expect(otherCard(page)).toContainText('OpenDocument texts only (.odt, .fodt)');
  await chooseFile(page, 'Choose a file', 'tests/fixtures/contract-v2.odt');
  await expect(page.locator('.colhead .badge')).toHaveText(['OpenDocument', 'OpenDocument']);
});

test('the workspace opened without documents asks for them', async ({ page }) => {
  await page.goto('/compare/');
  await expect(page).toHaveURL(/\/compare\/new\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose the first version');
  await expect(page.locator('.slot-name')).toHaveCount(0);
});

test('the chosen theme applies on every page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('collate.theme', 'dark'));
  for (const path of ['/', '/compare/new/', '/compare/sample/']) {
    await page.goto(path);
    await expect(page.locator('html'), path).toHaveAttribute('data-theme', 'dark');
  }
  // The site's header has the switch too.
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Dark theme' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(254, 241, 238)');
});

test('the workspace name leads back to the landing page', async ({ page }) => {
  await page.goto('/compare/sample/');
  await page.getByRole('link', { name: 'Collate home' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See every change');
});

test('the site pages have no horizontal scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/compare/new/']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
