import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

/** A chart as a PNG, drawn in the browser: `tall` is the last bar's height, `label` an optional note, `scale` its size. */
async function chart(page: Page, tall: number, label: string, scale = 1): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([tall, label, scale]) => {
      const c = document.createElement('canvas');
      c.width = 640 * scale;
      c.height = 400 * scale;
      const x = c.getContext('2d')!;
      x.scale(scale, scale);
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 640, 400);
      x.fillStyle = '#2f6fb3';
      [80, 140, 100, tall].forEach((h, i) => x.fillRect(80 + i * 130, 340 - h, 80, h));
      if (label) {
        x.fillStyle = '#c0392b';
        x.font = '24px sans-serif';
        x.fillText(label, 440, 140);
      }
      return c.toDataURL('image/png').split(',')[1]!;
    },
    [tall, label, scale] as const,
  );
  return Buffer.from(b64, 'base64');
}

async function open(page: Page, files: string[]) {
  await page.goto('/compare/new/');
  for (const f of files) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).first().click();
    await (await chooser).setFiles(f);
  }
}

test('two picture files are compared as pictures: side by side, swipe, onion skin and difference', async ({ page }) => {
  await page.goto('/compare/new/');
  writeFileSync(`${OUT}/chart-v1.png`, await chart(page, 120, ''));
  writeFileSync(`${OUT}/chart-v2.png`, await chart(page, 180, 'Q4 target'));
  await open(page, [`${OUT}/chart-v1.png`, `${OUT}/chart-v2.png`]);
  const view = page.locator('#app');
  await expect(view.locator('[data-stats]')).toContainText('% changed · 1 area');
  await expect(view.locator('.ic-boxes rect')).toHaveCount(2);
  // The heads say what the pictures are.
  await expect(page.locator('.slot[data-side="a"] .slot-meta')).toContainText('640 × 400 px');
  // The image tools are in the toolbar.
  await expect(page.locator('#toolbar')).toHaveAttribute('data-kind', 'image');
  for (const mode of ['swipe', 'onion', 'diff', 'side']) {
    await page.locator(`#toolbar .ic-modes [data-mode="${mode}"]`).click();
    await expect(page.locator('.image-view')).toHaveAttribute('data-mode', mode);
  }
  await page.locator('#toolbar .ic-modes [data-mode="swipe"]').click();
  await view.locator('[data-control="swipe"]').fill('20');
  await expect(view.locator('img.ic-top')).toHaveAttribute('style', /inset\(0px 0px 0px 20%\)/);
  // The swipe's slider is under the pictures, not in the toolbar; its handle drags the divide, not the pictures.
  await expect(page.locator('#toolbar [data-control="swipe"]')).toHaveCount(0);
  const stage = page.locator('.ic-stage');
  const stageAt = (await stage.boundingBox())!;
  const handle = (await page.locator('.ic-handle').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageAt.x + stageAt.width * 0.7, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await view.locator('[data-control="swipe"]').inputValue())).toBeGreaterThan(60);
  expect((await stage.boundingBox())!.x).toBeCloseTo(stageAt.x, 0);
  // Which picture is on top can be swapped.
  await expect(view.locator('img.ic-top')).toHaveAttribute('alt', /^B:/);
  await page.locator('#btn-stack').click();
  await expect(view.locator('img.ic-top')).toHaveAttribute('alt', /^A:/);
  await expect(page.locator('#btn-stack .stack-icon')).toHaveAttribute('data-top', 'a');
  await page.locator('#btn-stack').click();
  // The areas are stepped through, zoomed in on.
  await page.locator('#btn-area-next').click();
  await expect(view.locator('[data-stats]')).toContainText('1 of 1 area');
  await expect(view.locator('[data-zoom="fit"]')).not.toHaveText('Fit');
  // At the lowest sensitivity, only complete changes of colour count.
  await view.locator('[data-control="sensitivity"]').fill('0');
  await expect(view.locator('[data-stats]')).toContainText('No visible difference');
  await view.locator('[data-control="sensitivity"]').fill('90');
  const download = page.waitForEvent('download');
  await page.locator('#btn-save-diff').click();
  expect((await download).suggestedFilename()).toBe('chart-v2 (difference).png');
});

test('a changed picture in a document opens the picture comparison; a resized one is not a change', async ({ page }) => {
  await page.goto('/compare/new/');
  const v1 = (await chart(page, 120, '')).toString('base64');
  const v2 = (await chart(page, 180, 'Q4 target')).toString('base64');
  const small = (await chart(page, 120, '', 0.5)).toString('base64');
  const html = (img: string, words: string) => `<html><body><h1>Report</h1><p>${words}</p><p><img src="data:image/png;base64,${img}" alt="Revenue chart"></p><p>End.</p></body></html>`;
  writeFileSync(`${OUT}/report-a.html`, html(v1, 'Revenue grew.'));
  writeFileSync(`${OUT}/report-b.html`, html(v2, 'Revenue grew.'));
  writeFileSync(`${OUT}/report-small.html`, html(small, 'Revenue grew.'));

  await open(page, [`${OUT}/report-a.html`, `${OUT}/report-b.html`]);
  await expect(page.locator('#counter .vh')).toContainText('Change 1 of 1');
  await page.locator('.cell.b img.obj-img').first().click();
  const dlg = page.locator('dialog.pictures');
  await expect(dlg.locator('[data-stats]')).toContainText('% changed');
  await page.keyboard.press('Escape');

  await page.locator('.cell.b img.obj-img').first().click({ button: 'right' });
  await page.locator('#change-menu [data-mark="pictures"]').click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  if (!(await page.locator('#changes').isVisible())) await page.keyboard.press('s');
  await expect(page.locator('.chg-pics img')).toHaveCount(2);

  // The same chart, only smaller: the same picture.
  await page.locator('.slot[data-side="b"] [data-menu="load"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.pop [data-load="file"]').click();
  await (await chooser).setFiles(`${OUT}/report-small.html`);
  await expect(page.locator('.slot-name')).toHaveText(['report-a.html', 'report-small.html']);
  await expect(page.locator('#counter .vh')).toContainText('No differences');
});

test('notes on pictures: an area drawn, written on, listed and zoomed to', async ({ page }) => {
  await page.goto('/compare/new/');
  writeFileSync(`${OUT}/chart-v1.png`, await chart(page, 120, ''));
  writeFileSync(`${OUT}/chart-v2.png`, await chart(page, 180, 'Q4 target'));
  await open(page, [`${OUT}/chart-v1.png`, `${OUT}/chart-v2.png`]);
  await expect(page.locator('[data-stats]')).toContainText('1 area');

  await page.locator('#btn-annotate').click();
  const paneB = (await page.locator('.ic-pane[data-side="b"] .ic-stage').boundingBox())!;
  await page.mouse.move(paneB.x + paneB.width * 0.6, paneB.y + paneB.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(paneB.x + paneB.width * 0.9, paneB.y + paneB.height * 0.45, { steps: 4 });
  await page.mouse.up();
  const editor = page.locator('.mn-editor');
  await expect(editor.locator('.mn-where')).toHaveText('B, top right');
  await editor.locator('[data-note-text]').fill('Is this target agreed?');
  await editor.locator('[data-note="done"]').click();
  await expect(page.locator('.ic-pane[data-side="b"] .mn-box')).toHaveCount(1);
  await expect(page.locator('.ic-pane[data-side="a"] .mn-box')).toHaveCount(0);

  // A click marks a point.
  const paneA = (await page.locator('.ic-pane[data-side="a"] .ic-stage').boundingBox())!;
  await page.mouse.click(paneA.x + paneA.width * 0.2, paneA.y + paneA.height * 0.8);
  await editor.locator('[data-note-text]').fill('Bars look fine');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.ic-pane[data-side="a"] .mn-box.point')).toHaveCount(1);

  // The notes in the pane; clicking one zooms to it and opens it.
  await page.keyboard.press('c');
  await page.keyboard.press('s');
  await expect(page.locator('#changes .mn-card')).toHaveCount(2);
  await page.locator('#changes [data-note-item="0"]').click();
  await expect(page.locator('[data-zoom="fit"]')).not.toHaveText('Fit');
  await expect(page.locator('.mn-editor [data-note-text]')).toHaveValue('Is this target agreed?');
  await page.locator('.mn-editor [data-note="delete"]').click();
  await expect(page.locator('#changes .mn-card')).toHaveCount(1);
});
