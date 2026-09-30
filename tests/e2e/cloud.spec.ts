import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The services' scripts and file downloads, answered by stand-ins. */
async function standIns(page: Page) {
  await page.route('https://www.dropbox.com/static/api/2/dropins.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `window.Dropbox = { choose(o) { o.success([{ name: 'db-a.txt', link: 'https://files.test/db-a.txt' }, { name: 'db-b.txt', link: 'https://files.test/db-b.txt' }]); } };`,
    }),
  );
  await page.route('https://files.test/**', (r) => r.fulfill({ contentType: 'text/plain', body: r.request().url().endsWith('db-a.txt') ? 'Rent is 900.\n' : 'Rent is 950.\n' }));
  await page.route('https://accounts.google.com/gsi/client', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `window.google = window.google || {}; google.accounts = { oauth2: { initTokenClient(o) { return { requestAccessToken() { o.callback({ access_token: 'tok' }); } }; } } };`,
    }),
  );
  await page.route('https://apis.google.com/js/api.js', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `window.gapi = { load(n, cb) { cb(); } };
        google.picker = { ViewId: { DOCS: 'docs' }, Feature: { MULTISELECT_ENABLED: 'multi' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
          PickerBuilder: class { addView() { return this; } enableFeature() { return this; } setOAuthToken() { return this; } setDeveloperKey() { return this; } setAppId() { return this; }
            setCallback(cb) { this.cb = cb; return this; } build() { return { setVisible: () => this.cb({ action: 'picked', docs: [{ id: 'f1', name: 'lease.txt', mimeType: 'text/plain' }] }) }; } } };`,
    }),
  );
  await page.route('https://www.googleapis.com/drive/v3/**', (r) => {
    const url = r.request().url();
    expect(r.request().headers().authorization).toBe('Bearer tok');
    if (url.includes('/revisions?')) return r.fulfill({ json: { revisions: [{ id: 'r1', modifiedTime: '2026-01-05T10:00:00Z', lastModifyingUser: { displayName: 'Sam' } }, { id: 'r2', modifiedTime: '2026-03-01T10:00:00Z' }] } });
    if (url.includes('/revisions/r1')) return r.fulfill({ contentType: 'text/plain', body: 'The lease runs one year.\n' });
    return r.fulfill({ contentType: 'text/plain', body: 'The lease runs two years.\n' });
  });
}

test('documents come from Dropbox and Google Drive pickers, and a Drive file is compared with an earlier version', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { COLLATE_CONFIG: unknown }).COLLATE_CONFIG = { dropbox: { appKey: 'k' }, google: { clientId: 'c', apiKey: 'k' } };
  });
  await standIns(page);
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');

  await page.locator('.slot[data-side="a"] [data-menu="load"]').click();
  await expect(page.locator('.pop [data-load="onedrive"]')).toHaveCount(0);
  await page.locator('.pop [data-load="dropbox"]').click();
  await expect(page.locator('.slot-name')).toHaveText(['db-a.txt', 'db-b.txt']);

  await page.locator('.slot[data-side="b"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="gdrive"]').click();
  await expect(page.locator('.slot-name')).toHaveText(['db-a.txt', 'lease.txt']);

  await page.locator('.slot[data-side="b"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="drive-version"]').click();
  const dlg = page.locator('dialog.revisions');
  await expect(dlg.locator('[data-revision]')).toHaveCount(2);
  await expect(dlg.locator('[data-revision="r1"]')).toContainText('Sam');
  await dlg.locator('[data-revision="r1"]').click();
  await expect(page.locator('.slot[data-side="a"] .slot-name')).toContainText('lease (');
  await expect(page.locator('.cell.a').first()).toContainText('one year');
  await expect(page.locator('.cell.b').first()).toContainText('two years');
});

test('services without keys are not offered', async ({ page }) => {
  await page.goto('/compare/sample/');
  await page.locator('.slot[data-side="a"] [data-menu="load"]').click();
  await expect(page.locator('.pop [data-load="dropbox"], .pop [data-load="gdrive"], .pop [data-load="onedrive"]')).toHaveCount(0);
});
