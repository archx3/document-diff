import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const counter = (page: Page) => page.locator('#counter .vh');
const scroller = (page: Page) => page.locator('#scroller');
const box = async (l: Locator) => (await l.boundingBox())!;

async function openSample(page: Page, prefs?: Record<string, unknown>) {
  await page.addInitScript((p) => {
    localStorage.clear();
    if (p) localStorage.setItem('collate.prefs.v1', JSON.stringify(p));
  }, prefs ?? null);
  await page.goto('/compare/sample/');
  await expect(counter(page)).toContainText('of');
}

/** A line of the grid in one column, by its text. */
const line = (page: Page, side: 'a' | 'b', text: string) => page.locator(`.ecol.${side} > .row`, { hasText: text }).first();

test.describe('side by side with connection bands', () => {
  test.beforeEach(async ({ page }) => openSample(page));

  test('is how a new visitor sees the documents', async ({ page }) => {
    await expect(page.locator('#btn-view-split')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#btn-bands')).toHaveAttribute('aria-pressed', 'true');
    // The toggle's icon: two points joined, a divider, one point on its own.
    await expect(page.locator('#btn-bands circle')).toHaveCount(3);
    await expect(page.locator('.egrid .ecol')).toHaveCount(2);
    // A paragraph only in B leaves no gap in A, just a line where it would go.
    await expect(line(page, 'a', 'Accessibility review against')).toHaveCount(0);
    const gap = page.locator('.ecol.a > .row.gap.k-ins').first();
    expect((await box(gap)).height).toBe(0);
    await expect(page.locator('.bands .band').first()).toBeAttached();
  });

  test('joins each change on one side to the other with a band', async ({ page }) => {
    const bands = page.locator('.bands .band');
    await expect(bands.first()).toHaveAttribute('data-hunk', '0');
    await expect(page.locator('.bands .band.cur')).toHaveAttribute('data-hunk', '0');
    // The band of the list, where B has one more item, reaches further down on B's side.
    const list = await box(page.locator('.bands .band[data-hunk="2"]'));
    const itemsA = await box(page.locator('.ecol.a > .row[data-hunk="2"]').last());
    const itemsB = await box(page.locator('.ecol.b > .row[data-hunk="2"]').last());
    expect(itemsB.y + itemsB.height - (itemsA.y + itemsA.height)).toBeGreaterThan(30);
    expect(Math.abs(list.y + list.height - (itemsB.y + itemsB.height))).toBeLessThan(2);
    // Clicking a band makes its change the current one.
    await page.locator('.bands .band[data-hunk="1"]').dispatchEvent('click');
    await expect(counter(page)).toHaveText('Change 2 of 7');
  });

  test('keeps what is level with the middle of the screen matched as the page scrolls', async ({ page }) => {
    const levelled: number[] = [];
    // Between the first and last half screen, the sync point is the middle of the screen.
    for (const top of [360, 420, 480, 540, 600, 660, 720]) {
      await scroller(page).evaluate((el, y) => (el.scrollTop = y), top);
      await page.waitForTimeout(120);
      // Unchanged text (a paragraph or a row of a table) at the middle of the screen is at the same
      // height in both columns.
      const at = await page.evaluate(() => {
        const sc = document.getElementById('scroller')!;
        const heads = document.getElementById('colheads')!;
        const r = sc.getBoundingClientRect();
        const mid = r.top + heads.offsetHeight + (sc.clientHeight - heads.offsetHeight) / 2;
        for (const a of Array.from(document.querySelectorAll<HTMLElement>('.ecol.a > .row.k-eq, .ecol.a > .row.k-teq'))) {
          const ra = a.getBoundingClientRect();
          if (ra.top > mid || ra.bottom < mid) continue;
          const b = document.querySelector<HTMLElement>(`.ecol.b > .row[data-a="${CSS.escape(a.dataset.a!)}"]`)!;
          return Math.abs(b.getBoundingClientRect().top - ra.top);
        }
        return null;
      });
      if (at !== null) levelled.push(at);
    }
    expect(levelled.length).toBeGreaterThan(2);
    for (const d of levelled) expect(d).toBeLessThan(2);
    // Scrolled past B's extra list item, A's column has moved down to keep level.
    expect(await page.locator('.ecol.a').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(20);
  });

  test('scrolls no further than the end of the documents', async ({ page }) => {
    const reach = () =>
      scroller(page).evaluate(async (el) => {
        el.scrollTop = el.scrollHeight;
        await new Promise((r) => setTimeout(r, 150));
        return el.scrollHeight;
      });
    const first = await reach();
    for (let i = 0; i < 3; i++) expect(await reach()).toBe(first);
    // The page ends a little below the end caps.
    const grid = await box(page.locator('#grid'));
    const end = await box(page.locator('.ecol.b .ecap'));
    expect(Math.abs(end.y + end.height - (grid.y + grid.height))).toBeLessThan(2);
  });

  test('copies a whole change with the arrow at the end of its band', async ({ page }) => {
    // A's arrow sends A's version across to B (and B's brings B's into A).
    const toB = line(page, 'a', 'This agreement is made on').locator('.act.to-b');
    await expect(toB).toHaveAttribute('aria-label', 'Use A’s version in B');
    // Two chevrons, and no border or background until hovered, like the app bar's buttons.
    await expect(toB.locator('path')).toHaveAttribute('d', 'M8.67 4.67 12 8l-3.33 3.33M4 4.67 7.33 8 4 11.33');
    expect(await toB.evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).backgroundColor])).toEqual(['0px', 'rgba(0, 0, 0, 0)']);
    await toB.click();
    await expect(counter(page)).toHaveText('Change 1 of 6');
    await expect(line(page, 'b', 'This agreement is made on')).toContainText('12 May 2026');
    await expect(page.locator('.slot[data-side="b"] .edited')).toHaveText('1 edit applied');
    await page.keyboard.press('Control+z');
    await expect(counter(page)).toHaveText('Change 1 of 7');
    // One pair of arrows for each change.
    await expect(page.locator('.ecol.a .act.to-b')).toHaveCount(7);
    await expect(page.locator('.ecol.b .act.to-a')).toHaveCount(7);
  });

  test('shows line numbers beside each column and folds unchanged text', async ({ page }) => {
    await page.keyboard.press('l');
    const n = (l: Locator) => l.locator('.egut').evaluate((el) => getComputedStyle(el, '::before').content);
    expect(await n(line(page, 'a', 'This agreement is made on'))).toBe('"2"');
    expect(await n(line(page, 'b', 'Accessibility review against'))).toBe('"7"');
    await page.keyboard.press('c');
    await expect(page.locator('.ecol.a .row.fold').first()).toBeVisible();
    await expect(page.locator('.ecol.b .row.fold .fold-btn').first()).toHaveAttribute('aria-hidden', 'true');
  });

  test('in low contrast, neither the current change nor the bands have lines', async ({ page }) => {
    await expect(page.locator('.bands .band-edge').first()).toBeVisible();
    await page.locator('#btn-contrast').click();
    const cell = line(page, 'a', 'This agreement is made on').locator('.cell');
    await expect(line(page, 'a', 'This agreement is made on')).toHaveClass(/\bcur\b/);
    expect(await cell.evaluate((el) => getComputedStyle(el).borderRightColor)).toBe('rgba(0, 0, 0, 0)');
    // The bands are their colour alone.
    for (const edge of await page.locator('.bands .band-edge').all()) await expect(edge).toBeHidden();
    await expect(page.locator('.bands .band').first()).toBeVisible();
  });

  test('goes to each change in turn, and B turns the bands off', async ({ page }) => {
    for (let i = 2; i <= 7; i++) {
      await page.keyboard.press('n');
      await expect(counter(page)).toHaveText(`Change ${i} of 7`);
      await expect(page.locator('.ecol.a > .row.cur').first()).toBeInViewport();
    }
    await page.keyboard.press('b');
    await expect(page.locator('#btn-bands')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.egrid')).toHaveCount(0);
    await expect(page.locator('.grid > .row.cur').first()).toBeInViewport();
  });
});

test.describe('unified view', () => {
  test.beforeEach(async ({ page }) => openSample(page));

  test('puts A’s version above B’s in one column, with the overview beside it', async ({ page }) => {
    await page.locator('#btn-view-unified').click();
    await expect(page.locator('.app')).toHaveClass(/\bunified\b/);
    await expect(page.locator('#btn-view-unified')).toHaveAttribute('aria-checked', 'true');
    // Connection bands are for side by side.
    await expect(page.locator('#btn-bands')).toBeDisabled();
    const row = page.locator('.row.k-mod', { hasText: 'This agreement is made on' });
    const [a, b] = [await box(row.locator('.cell.a')), await box(row.locator('.cell.b'))];
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
    expect(a.y + a.height).toBeLessThanOrEqual(b.y + 1);
    // The arrows sit beside each version, each sending it to the other.
    const [toA, toB] = [await box(row.locator('.act.to-a')), await box(row.locator('.act.to-b'))];
    expect(toB.x + toB.width).toBeLessThanOrEqual(a.x);
    expect(toB.y).toBeLessThan(b.y);
    expect(toA.y).toBeGreaterThanOrEqual(b.y);
    // Unchanged paragraphs once.
    await expect(page.locator('.row.k-eq .cell.b').first()).toBeHidden();
    const overview = await box(page.locator('#overview'));
    expect(overview.x).toBeGreaterThanOrEqual(a.x + a.width);
    // V goes back, keeping the place.
    await page.keyboard.press('v');
    await expect(page.locator('#btn-view-split')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.egrid')).toHaveCount(1);
  });

  test('the view switch moves with the arrow keys', async ({ page }) => {
    await page.locator('#btn-view-split').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#btn-view-unified')).toBeFocused();
    await expect(page.locator('#btn-view-unified')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#btn-view-split')).toHaveAttribute('aria-checked', 'true');
  });

  test('is the only view on a phone, with the counter in the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.app')).toHaveClass(/\bunified\b/);
    await expect(page.locator('#view')).toBeHidden();
    await expect(page.locator('#btn-bands')).toBeHidden();
    await expect(page.locator('.counter-m .c-short')).toHaveText('1/7');
    // The choice made on a wider screen is kept for it.
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('.egrid')).toHaveCount(1);
  });
});
