import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Opens the sample with these view settings (unset ones as a new visitor has them). */
async function openSample(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('opened')) {
      localStorage.setItem('collate.prefs.v1', JSON.stringify(p));
      sessionStorage.setItem('opened', '1');
    }
  }, prefs);
  await page.goto('/compare/sample/');
  await expect(page.locator('#counter .vh')).toContainText('of');
}

/** The cell of one side showing some text (in whichever view). */
const cell = (page: Page, side: 'a' | 'b', text: string) => page.locator(`.cell.${side}`, { hasText: text }).first();
/** The margin beside it. */
const margin = (page: Page, side: 'a' | 'b', text: string) => page.locator('.row', { has: cell(page, side, text) }).first().locator(`.rail.${side}`);

/** Selects some words inside a cell, as dragging over them would. */
async function select(target: Locator, words: string) {
  await target.evaluate((el, words) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const i = n.data.indexOf(words);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + words.length);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    throw new Error(`"${words}" is not in one piece of text`);
  }, words);
}

/** The text painted with a highlight of this name. */
const painted = (page: Page, name: string) =>
  page.evaluate((name) => {
    const h = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights.get(name);
    return h ? [...h].map((r) => r.toString()) : [];
  }, name);

for (const [view, prefs] of [
  ['side by side with connection bands', {}],
  ['side by side in rows', { bands: false }],
  ['unified', { view: 'unified' }],
] as const) {
  test.describe(view, () => {
    test.beforeEach(async ({ page }) => {
      await openSample(page, prefs);
    });

    test('review mode adds margins outside the documents, and highlights selected text from them', async ({ page }) => {
      await expect(page.locator('.rail').first()).toBeHidden();
      await page.keyboard.press('r');
      await expect(page.locator('#btn-review')).toHaveAttribute('aria-pressed', 'true');
      // A's margin is on its far left, B's on its far right (in the unified view, right of the column).
      const [ra, ca] = [await margin(page, 'a', 'This agreement is made on').boundingBox(), await cell(page, 'a', 'This agreement is made on').boundingBox()];
      const [rb, cb] = [await margin(page, 'b', 'This agreement is made on').boundingBox(), await cell(page, 'b', 'This agreement is made on').boundingBox()];
      if (view === 'unified') expect(ra!.x).toBeGreaterThanOrEqual(ca!.x + ca!.width - 1);
      else expect(ra!.x + ra!.width).toBeLessThanOrEqual(ca!.x + 1);
      expect(rb!.x).toBeGreaterThanOrEqual(cb!.x + cb!.width - 1);

      await select(cell(page, 'b', 'The Contractor will design'), 'design and build');
      const buttons = margin(page, 'b', 'The Contractor will design');
      await expect(buttons.locator('[data-rail="highlight"]')).toBeVisible();
      await buttons.locator('[data-rail="highlight"]').click();
      await expect.poll(() => painted(page, 'collate-hl-yellow')).toEqual(['design and build']);
      await expect(margin(page, 'b', 'The Contractor will design').locator('.rh.yellow')).toBeVisible();
    });
  });
}

test.describe('marks', () => {
  test.beforeEach(async ({ page }) => {
    await openSample(page, { bands: false, review: true });
  });

  test('reactions and notes on a change show in both margins and in the list of changes', async ({ page }) => {
    const row = page.locator('.row', { hasText: 'This agreement is made on' }).first();
    // (The ruler sits in the middle of the row.)
    await row.locator('.cell.a').hover();
    await row.locator('.rail.a [data-rail="add"]').click();
    const card = page.locator('#review-card');
    await expect(card).toContainText('Change 1');
    await card.locator('[data-react="up"]').click();
    await expect(card.locator('[data-react="up"]')).toHaveAttribute('aria-pressed', 'true');
    // Thumbs up and down exclude each other; an idea goes with either.
    await card.locator('[data-react="down"]').click();
    await card.locator('[data-react="idea"]').click();
    await expect(card.locator('[aria-pressed="true"]')).toHaveCount(2);
    await card.getByRole('textbox', { name: 'A new note on this change' }).fill('Check the date with the client.');
    await card.getByRole('button', { name: 'Add note' }).click();
    await expect(card.locator('.rc-note')).toContainText('Check the date with the client.');
    await page.keyboard.press('Escape');

    for (const side of ['a', 'b'] as const) {
      const marks = row.locator(`.rail.${side} .rail-marks`);
      await expect(marks.locator('.rx')).toHaveCount(2);
      await expect(marks.locator('.rx.down')).toBeVisible();
      await expect(marks.locator('.rx.idea')).toBeVisible();
      await expect(marks.locator('.rn')).toBeVisible();
    }

    await page.keyboard.press('s');
    const first = page.locator('.chg-card[data-hunk="0"]');
    await expect(first.locator('.chg-marks .rx')).toHaveCount(2);
    await page.getByRole('tab', { name: /Notes/ }).click();
    await expect(page.locator('.mark-card')).toHaveCount(1);
    await expect(page.locator('.mark-card')).toContainText('Change 1');
    await expect(page.locator('.mark-card')).toContainText('Check the date with the client.');
  });

  test('a note on selected text colours it, and clicking the text opens the note', async ({ page }) => {
    await select(cell(page, 'a', 'Deliverables include'), 'Deliverables');
    await margin(page, 'a', 'Deliverables include').locator('[data-rail="note"]').click();
    const card = page.locator('#review-card');
    await expect(card).toContainText('Selected text in A');
    await expect(card.locator('.rc-quote')).toHaveText('“Deliverables”');
    const box = card.getByRole('textbox', { name: 'A new note on the selected text' });
    await expect(box).toBeFocused();
    await box.fill('List them in a schedule.');
    await box.press('Control+Enter');
    await page.keyboard.press('Escape');
    await expect.poll(() => painted(page, 'collate-note')).toEqual(['Deliverables']);

    const text = await cell(page, 'a', 'Deliverables include').boundingBox();
    await page.mouse.click(text!.x + 60, text!.y + text!.height / 2);
    await expect(card).toContainText('List them in a schedule.');
  });

  test('marks are kept across a reload, move with a swap, and are listed once their text is gone', async ({ page }) => {
    // "newsletter" is only in B.
    await select(cell(page, 'b', 'The Contractor will design'), 'newsletter');
    await margin(page, 'b', 'The Contractor will design').locator('[data-rail="highlight"]').click();
    await expect.poll(() => painted(page, 'collate-hl-yellow')).toEqual(['newsletter']);

    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.locator('#btn-review')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => painted(page, 'collate-hl-yellow')).toEqual(['newsletter']);
    await expect(margin(page, 'b', 'The Contractor will design').locator('.rh.yellow')).toBeVisible();

    await page.locator('#btn-swap').click();
    await expect(margin(page, 'a', 'The Contractor will design').locator('.rh.yellow')).toBeVisible();
    await expect.poll(() => painted(page, 'collate-hl-yellow')).toEqual(['newsletter']);
    await page.locator('#btn-swap').click();

    // Copying A's version over B's paragraph takes the highlighted word away.
    const row = page.locator('.row', { hasText: 'The Contractor will design' }).first();
    await row.locator('button[data-act="l2r"]').click();
    await expect.poll(() => painted(page, 'collate-hl-yellow')).toEqual([]);
    await page.keyboard.press('s');
    await page.getByRole('tab', { name: /Notes/ }).click();
    await expect(page.locator('.notes-lost-head')).toHaveText('No longer in the documents');
    await expect(page.locator('.mark-card.lost')).toContainText('newsletter');
    await page.locator('.mark-card.lost').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.mark-card')).toHaveCount(0);
  });
});
