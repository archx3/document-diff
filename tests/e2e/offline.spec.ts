import { expect, test } from '@playwright/test';

test('installable, and works without a connection once opened', async ({ page, context }) => {
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const m = await (await page.request.get(manifest!)).json();
  expect(m.short_name).toBe('Collate');
  expect(m.display).toBe('standalone');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');
  expect(Object.values(m.file_handlers[0].accept).flat()).toContain('.docx');

  // The service worker takes over, then the connection goes.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.locator('#counter .vh')).toContainText('of');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#counter .vh')).toContainText('of');
  await page.goto('/compare/new/');
  await expect(page.getByRole('button', { name: 'Choose a file' }).first()).toBeVisible();
  await context.setOffline(false);
});
