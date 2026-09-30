import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('opened')) return;
    sessionStorage.setItem('opened', '1');
    localStorage.clear();
    localStorage.setItem('collate.prefs.v1', JSON.stringify({ bands: false, sidebar: true }));
  });
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');
});

test('changes are accepted and rejected from the keyboard, the list and the change menu', async ({ page }) => {
  const card = (n: number) => page.locator(`.chg-item:has(.chg-card[data-hunk="${n}"])`);
  const bar = page.locator('.decide-bar');
  await expect(bar).toContainText('0 of 7 decided');

  // A accepts the current change and goes to the next; X rejects.
  await page.keyboard.press('a');
  await expect(card(0).locator('.chg-status')).toHaveText('Accepted');
  await expect(page.locator('#counter .vh')).toContainText('Change 2 of 7');
  await page.keyboard.press('x');
  await expect(card(1).locator('.chg-status')).toHaveText('Rejected');
  await expect(bar).toContainText('2 of 7 decided');

  // The same decision again takes it back.
  await card(0).locator('[data-decide="accepted"]').click();
  await expect(card(0).locator('.chg-status')).toHaveCount(0);
  await card(0).locator('[data-decide="accepted"]').click();

  // From the change menu.
  const launch = page.locator('.cell.b', { hasText: 'Launch by week' }).first();
  // (Scrolling closes menus: scroll first.)
  await launch.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await launch.click({ button: 'right' });
  await page.locator('#change-menu [data-decide="accepted"]').click();
  await expect(bar).toContainText('3 of 7 decided');
  await page.keyboard.press('Escape');

  // Only the open changes (the current one, the third, is open too).
  await bar.locator('[data-filter="open"]').check();
  await expect(page.locator('.chg-item')).toHaveCount(4);
  await bar.locator('[data-filter="open"]').uncheck();

  // Applying the decisions puts A's text back where a change was rejected.
  await expect(page.locator('.cell.b', { hasText: 'The Contractor will design' }).first()).toContainText('up to eight pages');
  await bar.locator('[data-decisions="apply"]').click();
  await expect(page.locator('.cell.b', { hasText: 'The Contractor will design' }).first()).toContainText('up to six pages');
  await expect(page.locator('.toast').last()).toContainText('rejected change');
});
