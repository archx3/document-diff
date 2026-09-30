import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test('a sample picture pair opens in the picture workspace', async ({ page }) => {
  await page.goto('/samples/');
  await page.getByRole('region', { name: 'Images' }).getByRole('listitem').filter({ hasText: 'Sales chart' }).getByRole('button', { name: 'Open the comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['chart-v1.png', 'chart-v2.png']);
  await expect(page.locator('#toolbar')).toHaveAttribute('data-kind', 'image');
});

test('a sample recording pair opens in the audio workspace', async ({ page }) => {
  await page.goto('/samples/');
  await page.getByRole('region', { name: 'Audio' }).getByRole('listitem').filter({ hasText: 'A short tune' }).getByRole('button', { name: 'Open the comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/$/);
  await expect(page.locator('.slot-name')).toHaveText(['melody-v1.wav', 'melody-v2.wav']);
  await expect(page.locator('#toolbar')).toHaveAttribute('data-kind', 'audio');
});

test('Word against PDF opens as a document comparison', async ({ page }) => {
  await page.goto('/samples/');
  await page.getByRole('listitem').filter({ hasText: 'Word against PDF' }).getByRole('button', { name: 'Open the comparison' }).click();
  await expect(page.locator('.slot-name')).toHaveText(['contract-v1.docx', 'contract-v2.pdf']);
  await expect(page.locator('#stats')).toContainText('changed');
});

test('a walkthrough step points at its part of the replica, and the replica works', async ({ page }) => {
  await page.goto('/guides/documents/');
  const replica = page.getByRole('figure', { name: 'An interactive replica of the document workspace' });
  await page.getByRole('button', { name: 'Copy a change across' }).click();
  await expect(replica.locator('[data-region="copy"][data-on]')).toBeVisible();
  // Clicking another part of the replica shows its step.
  await replica.getByRole('button', { name: 'List of changes' }).click();
  await expect(page.getByRole('button', { name: 'The list of changes' })).toHaveAttribute('aria-expanded', 'true');
  // Copying a change leaves one fewer.
  await expect(replica).toContainText('5 changed');
  await replica.getByRole('button', { name: "Use A's version in B" }).first().click();
  await expect(replica).toContainText('4 changed');
  await replica.getByRole('button', { name: 'Undo' }).click();
  await expect(replica).toContainText('5 changed');
});

test('the picture replica switches modes', async ({ page }) => {
  await page.goto('/guides/images/');
  const replica = page.getByRole('figure', { name: 'An interactive replica of the picture workspace' });
  await replica.getByRole('button', { name: 'Onion skin' }).click();
  await expect(replica.getByRole('slider', { name: 'How much of B shows over A' })).toBeVisible();
});

test('the help finds questions and shows shortcuts', async ({ page }) => {
  await page.goto('/help/');
  await page.getByRole('searchbox', { name: 'Search the help' }).fill('scanned');
  await expect(page.locator('details summary')).toHaveText(['My PDF says it has no text to compare']);
  await page.getByRole('heading', { name: 'Keyboard shortcuts' }).click();
  await page.keyboard.press('n');
  await expect(page.getByText('N: Next / previous change')).toBeVisible();
});

test('every legal page is linked from the footer', async ({ page }) => {
  await page.goto('/');
  const legal = page.getByRole('navigation', { name: 'Legal' });
  for (const [name, heading] of [
    ['Privacy', 'Privacy policy'],
    ['Terms of use', 'Terms of use'],
    ['Cookies and storage', 'Cookies and storage'],
    ['Accessibility', 'Accessibility statement'],
    ['Open-source licenses', 'Open-source licenses'],
  ]) {
    await legal.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await page.goBack();
  }
});
