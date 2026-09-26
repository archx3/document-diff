import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { libreOfficeText as convert } from '../soffice';

const OUT = 'tests/fixtures/out';
mkdirSync(OUT, { recursive: true });

const counter = (page: Page) => page.locator('#counter');
const rowByText = (page: Page, text: string) => page.locator('.row', { hasText: text }).first();

async function loadFile(page: Page, side: 'a' | 'b', path: string) {
  // Either a "Choose file" button (opens the picker directly) or a "Replace" menu.
  const chooser = page.waitForEvent('filechooser');
  await page
    .locator(`.slot[data-side="${side}"] [data-menu="load"], .dropcard[data-side="${side}"] [data-load="file"], .dropcard[data-side="${side}"] [data-menu="load"]`)
    .filter({ visible: true })
    .first()
    .click();
  const menuItem = page.locator('.pop [data-load="file"]');
  if (await menuItem.isVisible().catch(() => false)) await menuItem.click();
  await (await chooser).setFiles(path);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/compare/sample/');
  await expect(counter(page)).toContainText('of');
});

test('shows the sample comparison', async ({ page }) => {
  await expect(page.locator('#stats')).toContainText('12 changed');
  await expect(page.locator('#stats')).toContainText('1 only in A');
  await expect(page.locator('#stats')).toContainText('4 only in B');
  await expect(counter(page)).toHaveText('Change 1 of 7');
  await expect(page.locator('.row.k-mod')).toHaveCount(11);
  await expect(page.locator('.row.k-del')).toHaveCount(1);
  await expect(page.locator('.row.k-ins')).toHaveCount(3);
});

test('copies a paragraph across and undoes it', async ({ page }) => {
  const row = rowByText(page, 'This agreement is made on');
  await row.locator('button[data-act="l2r"]').click();
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(0);
  await expect(page.locator('.cell.b', { hasText: '12 May 2026' })).toHaveCount(1);
  await expect(page.locator('.slot[data-side="b"] .edited')).toHaveText('1 edit applied');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.row.k-mod', { hasText: 'This agreement is made on' })).toHaveCount(0);
});

test('copies a single word-level change', async ({ page }) => {
  const row = rowByText(page, 'marketing website with up to');
  await row.locator('del.chg', { hasText: 'six' }).click();
  await expect(page.locator('.pop .chg-preview')).toContainText('six');
  await page.locator('.pop [data-inline="l2r"]').click();
  const b = page.locator('.cell.b', { hasText: 'marketing website with up to' });
  await expect(b).toContainText('up to six pages, a blog, a newsletter sign-up and a contact form.');
  // The other change in the paragraph is still pending.
  await expect(page.locator('.row.k-mod', { hasText: 'marketing website' })).toHaveCount(1);
});

test('keyboard navigation and copying', async ({ page }) => {
  await page.keyboard.press('n');
  await expect(counter(page)).toHaveText('Change 2 of 7');
  await page.keyboard.press('p');
  await expect(counter(page)).toHaveText('Change 1 of 7');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(counter(page)).toHaveText('Change 1 of 6');
});

test('copies table rows', async ({ page }) => {
  const row = page.locator('.row.k-tins', { hasText: 'Accessibility review' });
  await row.locator('button[data-act="r2l"]').click();
  await expect(page.locator('.row.k-tins')).toHaveCount(0);
  await expect(page.locator('.cell.a .tcell', { hasText: '$1,200' })).toHaveCount(1);
});

test('changes-only view folds unchanged paragraphs', async ({ page }) => {
  await page.locator('#btn-changes').click();
  await expect(page.locator('.row.fold').first()).toBeVisible();
  // The label shows on each column; the overview covers the middle of the button.
  await page.locator('.fold-btn .fold-side').first().click();
  await expect(page.locator('#btn-changes')).toHaveAttribute('aria-pressed', 'true');
});

test('the ruler sits between the copy arrows, and dragging its frame scrolls the documents', async ({ page }) => {
  const overview = (await page.locator('#overview').boundingBox())!;
  const gutter = (await page.locator('.colhead.gut').boundingBox())!;
  expect(Math.abs(overview.x + overview.width / 2 - (gutter.x + gutter.width / 2))).toBeLessThan(2);
  const row = rowByText(page, 'This agreement is made on');
  const toA = (await row.locator('.act.to-a').boundingBox())!;
  const toB = (await row.locator('.act.to-b').boundingBox())!;
  expect(toA.x + toA.width).toBeLessThanOrEqual(overview.x);
  expect(toB.x).toBeGreaterThanOrEqual(overview.x + overview.width);
  await expect(page.locator('.ruler .mark')).toHaveCount(7);

  const view = (await page.locator('.ruler-view').boundingBox())!;
  const x = view.x + view.width / 2;
  const y = view.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 120, { steps: 6 });
  await page.mouse.up();
  expect(await page.locator('#scroller').evaluate((el) => el.scrollTop)).toBeGreaterThan(150);
  // The frame followed the pointer.
  const moved = (await page.locator('.ruler-view').boundingBox())!;
  expect(Math.abs(moved.y - view.y - 120)).toBeLessThan(3);

  // A mark goes to its change.
  await page.locator('.ruler .mark[data-hunk="3"]').click();
  await expect(counter(page)).toHaveText('Change 4 of 7');
  await expect(page.locator('.ruler .mark.cur')).toHaveAttribute('data-hunk', '3');
});

test('the minimap draws each document on either side of the ruler', async ({ page }) => {
  await expect(page.locator('.mm.a')).toBeHidden();
  await page.locator('#btn-minimap').click();
  await expect(page.locator('#btn-minimap')).toHaveAttribute('aria-pressed', 'true');
  const [a, ruler, b] = await Promise.all(['.mm.a', '.ruler', '.mm.b'].map(async (s) => (await page.locator(s).boundingBox())!));
  expect(a.x + a.width).toBeLessThanOrEqual(ruler.x);
  expect(b.x).toBeGreaterThanOrEqual(ruler.x + ruler.width);
  // The arrows moved out to make room.
  const toA = (await rowByText(page, 'This agreement is made on').locator('.act.to-a').boundingBox())!;
  expect(toA.x + toA.width).toBeLessThanOrEqual(a.x);
  const inked = (side: string) =>
    page.locator(`.mm.${side}`).evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
      return n;
    });
  await expect.poll(() => inked('a')).toBeGreaterThan(200);
  await expect.poll(() => inked('b')).toBeGreaterThan(200);
});

test('line numbers go in the gutter beside each document', async ({ page }) => {
  const gut = rowByText(page, 'This agreement is made on').locator('.gut');
  const numbers = () => gut.evaluate((el) => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content]);
  expect(await numbers()).toEqual(['none', 'none']);
  await page.keyboard.press('l');
  await expect(page.locator('#btn-lines')).toHaveAttribute('aria-pressed', 'true');
  // The title is paragraph 1 in both drafts.
  expect(await numbers()).toEqual(['"2"', '"2"']);
  // A paragraph only in B has a number on B's side only.
  const inserted = page.locator('.row.k-ins', { hasText: 'Accessibility review against' }).locator('.gut');
  expect(await inserted.evaluate((el) => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content])).toEqual(['""', '"7"']);
});

test('the list of changes goes to the change clicked', async ({ page }) => {
  await expect(page.locator('#changes')).toBeHidden();
  await page.locator('#btn-sidebar').click();
  const cards = page.locator('.chg-card');
  await expect(cards).toHaveCount(7);
  await expect(cards.first().locator('.chg-kind')).toHaveText('Changed');
  await expect(cards.first().locator('del')).toHaveText('12');
  await expect(cards.first().locator('ins')).toHaveText('19');
  await expect(cards.first()).toHaveAttribute('aria-current', 'true');
  // A paragraph only in B is shown whole; edits past the first few are counted.
  await expect(cards.nth(2).locator('ins', { hasText: 'Accessibility review against WCAG 2.2 AA' })).toBeVisible();
  await expect(cards.nth(2)).toContainText('and 1 more edit');

  await cards.nth(5).click();
  await expect(counter(page)).toHaveText('Change 6 of 7');
  await expect(cards.nth(5)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.row.cur').first()).toBeInViewport();
  // N moves the list along too.
  await page.keyboard.press('n');
  await expect(cards.nth(6)).toHaveAttribute('aria-current', 'true');
  await page.locator('#changes [data-close-changes]').click();
  await expect(page.locator('#changes')).toBeHidden();
});

test('navigation buttons are off where they would do nothing', async ({ page }) => {
  await expect(page.locator('#btn-prev')).toBeDisabled();
  await expect(page.locator('#btn-page-prev')).toBeDisabled();
  await expect(page.locator('#btn-next')).toBeEnabled();
  await expect(page.locator('#btn-page-next')).toBeEnabled();
  for (let i = 2; i <= 7; i++) {
    await page.locator('#btn-next').click();
    await expect(counter(page)).toHaveText(`Change ${i} of 7`);
  }
  await expect(page.locator('#btn-next')).toBeDisabled();
  await expect(page.locator('#btn-prev')).toBeEnabled();
  await expect(page.locator('#btn-prev')).toBeFocused();
  await expect(page.locator('#btn-undo')).toBeDisabled();
});

test('page buttons scroll a screen at a time', async ({ page }) => {
  const scrollTop = () => page.locator('#scroller').evaluate((el) => el.scrollTop);
  await page.locator('#btn-page-next').click();
  await expect.poll(scrollTop).toBeGreaterThan(400);
  await expect(page.locator('#btn-page-prev')).toBeEnabled();
  await page.keyboard.press('PageUp');
  await expect.poll(scrollTop).toBe(0);
  await expect(page.locator('#btn-page-prev')).toBeDisabled();
});

test('the toolbar turns green when A and B match', async ({ page }) => {
  await expect(page.locator('#toolbar')).not.toHaveClass(/\bsame\b/);
  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-l2r"]').click();
  await expect(counter(page)).toHaveText('No differences');
  await expect(page.locator('#toolbar')).toHaveClass(/\bsame\b/);
  await expect(page.locator('#stats')).toHaveText('A and B are identical');
  expect(await page.locator('#toolbar').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(229, 243, 236)');
  for (const id of ['#btn-all', '#btn-next', '#btn-prev', '#btn-changes']) await expect(page.locator(id)).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#toolbar')).not.toHaveClass(/\bsame\b/);
});

test('notices can be dismissed', async ({ page }) => {
  await expect(page.locator('#notice')).toContainText('Sample drafts');
  await page.locator('#notice').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('#notice')).toBeHidden();
});

test('the tools are icon buttons with names and tooltips', async ({ page }) => {
  for (const b of await page.locator('.appbar button, .toolbar button').all()) {
    expect(await b.getAttribute('aria-label')).toBeTruthy();
    expect((await b.textContent())?.trim()).toBe('');
  }
  await page.locator('#btn-next').hover();
  await expect(page.locator('.tip')).toBeVisible();
  await expect(page.locator('.tip')).toContainText('Next change');
  await expect(page.locator('.tip kbd')).toHaveText('N');
});

test('the theme button switches between light and dark', async ({ page }) => {
  const desk = () => page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await desk()).toBe('rgb(254, 241, 238)');
  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#btn-theme')).toHaveAttribute('aria-pressed', 'true');
  expect(await desk()).toBe('rgb(11, 35, 43)');
  expect(await page.evaluate(() => localStorage.getItem('collate.theme'))).toBe('dark');
  // Choosing the system's theme again goes back to following the system.
  await page.locator('#btn-theme').click();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('collate.theme'))).toBeNull();
});

test('low contrast gives the sheets and the desk one colour, without borders', async ({ page }) => {
  const cell = page.locator('.row.k-eq .cell.a').first();
  const sheet = () => cell.evaluate((el) => getComputedStyle(el).backgroundColor);
  const desk = () => page.locator('.app').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await sheet()).not.toBe(await desk());
  await page.locator('#btn-contrast').click();
  await expect(page.locator('#btn-contrast')).toHaveAttribute('aria-pressed', 'true');
  // Light: the desk turns the sheets' white.
  expect(await desk()).toBe('rgb(255, 255, 255)');
  expect(await sheet()).toBe('rgb(255, 255, 255)');
  expect(await cell.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe('rgba(0, 0, 0, 0)');
  // Dark: the sheets take the desk's navy.
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await desk()).toBe('rgb(11, 35, 43)');
  expect(await sheet()).toBe('rgb(11, 35, 43)');
});

test('scrollbars are SettleMe’s thin branded ones', async ({ page }) => {
  const bar = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.scrollbarWidth, cs.scrollbarColor];
    });
  expect(await bar('#scroller')).toEqual(['thin', 'rgb(231, 214, 207) rgba(0, 0, 0, 0)']);
  // The list of changes has the cooler, thinner variant.
  await page.locator('#btn-sidebar').click();
  expect(await bar('#changes-list')).toEqual(['thin', 'rgb(216, 230, 230) rgba(0, 0, 0, 0)']);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bar('#scroller')).toEqual(['thin', 'rgb(46, 76, 86) rgba(0, 0, 0, 0)']);
});

test('options change what counts as a difference', async ({ page }) => {
  await page.locator('#btn-options').click();
  await page.locator('.pop input[data-opt="ignoreFormatting"]').check();
  // "Launch support for 30 days" differs only in bold.
  await expect(page.locator('#stats')).toContainText('11 changed');
  await page.locator('.pop input[data-opt="ignoreFormatting"]').uncheck();
  await expect(page.locator('#stats')).toContainText('12 changed');
});

test('pastes rich text from Google Docs', async ({ page }) => {
  await page.locator('.slot[data-side="a"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="paste"]').click();
  const box = page.locator('.pastebox');
  await expect(box).toBeFocused();
  await box.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      'text/html',
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h1 dir="ltr"><span style="font-weight:400">Project brief</span></h1><p dir="ltr"><span style="font-weight:400">Launch on </span><span style="font-weight:700">March 3</span></p></b>',
    );
    dt.setData('text/plain', 'Project brief\nLaunch on March 3');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  // Loading over the samples clears the other side.
  await expect(page.locator('.dropcard[data-side="a"] h2')).toHaveText('Pasted from Google Docs');
  await expect(page.locator('.dropcard[data-side="b"] h2')).toHaveText('Second version');
});

test('builds the Google Docs download link', async ({ page }) => {
  await page.locator('.slot[data-side="b"] [data-menu="load"]').click();
  await page.locator('.pop [data-load="gdoc"]').click();
  await page.locator('#gd-url').fill('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit');
  await expect(page.locator('#gd-dl')).toHaveAttribute('href', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/export?format=docx');
});

test('loads two Word files, copies everything and exports a valid .docx', async ({ page }) => {
  await loadFile(page, 'a', 'tests/fixtures/contract-v1.docx');
  await expect(page.locator('.dropcard[data-side="a"] h2')).toHaveText('contract-v1.docx');
  await loadFile(page, 'b', 'tests/fixtures/contract-v2.docx');
  await expect(page.locator('.slot[data-side="b"] .slot-name')).toHaveText('contract-v2.docx');
  await expect(page.locator('#stats')).toContainText('changed');

  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-r2l"]').click();
  await expect(page.locator('#counter')).toHaveText('No differences');

  await page.locator('.slot[data-side="a"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="docx"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('contract-v1 (merged).docx');
  const path = `${OUT}/e2e-merged.docx`;
  await file.saveAs(path);

  const text = execFileSync('python3', ['-c', 'import sys, docx; print("\\n".join(p.text for p in docx.Document(sys.argv[1]).paragraphs))', path], {
    encoding: 'utf8',
  });
  expect(text).toContain('Accessibility review');
  expect(text).toContain('within 15 days');
  expect(text).not.toContain('Late payments');
  const lo = libreOfficeText(path);
  if (lo !== null) expect(lo).toContain('Appendix A');
});

const badges = (page: Page) => page.locator('.colhead .badge');

function libreOfficeText(path: string): string | null {
  return convert(null, OUT, path.slice(OUT.length + 1));
}

test('compares a PDF with a Word file and copies from the PDF', async ({ page }) => {
  await loadFile(page, 'a', 'tests/fixtures/contract-v2.pdf');
  await loadFile(page, 'b', 'tests/fixtures/contract-v1.docx');
  await expect(badges(page)).toHaveText(['PDF', 'Word']);
  await expect(page.locator('.notice')).toContainText('PDFs can’t be edited in place');
  await page.locator('.notice-line', { hasText: 'PDFs can’t be edited in place' }).getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.notice')).not.toContainText('PDFs can’t be edited in place');
  await expect(rowByText(page, 'Accessibility review')).toHaveClass(/k-del/);

  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-l2r"]').click();
  // Only what a PDF cannot carry remains: the picture and the page number.
  await expect(counter(page)).toHaveText(/^Change 1 of [12]$/);

  await page.locator('.slot[data-side="b"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="docx"]').click();
  const path = `${OUT}/e2e-from-pdf.docx`;
  await (await download).saveAs(path);
  const text = execFileSync('python3', ['-c', 'import sys, docx; print("\\n".join(p.text for p in docx.Document(sys.argv[1]).paragraphs))', path], { encoding: 'utf8' });
  expect(text).toContain('Accessibility review');
  expect(text).toContain('up to eight pages');
});

test('merges two OpenDocument files and saves an .odt', async ({ page }) => {
  await loadFile(page, 'a', 'tests/fixtures/contract-v1.odt');
  await loadFile(page, 'b', 'tests/fixtures/contract-v2.odt');
  await expect(badges(page)).toHaveText(['OpenDocument', 'OpenDocument']);
  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-r2l"]').click();
  await expect(counter(page)).toHaveText('No differences');

  await page.locator('.slot[data-side="a"] [data-menu="export"]').click();
  await expect(page.locator('.pop [data-export]').first()).toContainText('OpenDocument text');
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="odt"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('contract-v1 (merged).odt');
  const path = `${OUT}/e2e-merged.odt`;
  await file.saveAs(path);
  const zip = unzipSync(readFileSync(path));
  expect(Object.keys(zip)[0]).toBe('mimetype');
  expect(new TextDecoder().decode(zip['content.xml'])).toContain('Accessibility review');
  const lo = libreOfficeText(path);
  if (lo !== null) expect(lo).toContain('within 15 days');
});

test('compares CSV files row by row and saves a CSV', async ({ page }) => {
  writeFileSync(`${OUT}/e2e-a.csv`, 'id,name,qty\n1,Apple,3\n2,Pear,5\n3,Plum,1\n');
  writeFileSync(`${OUT}/e2e-b.csv`, 'id,name,qty\n1,Apple,3\n2,Pear,6\n3,Plum,1\n4,Fig,2\n');
  await loadFile(page, 'a', `${OUT}/e2e-a.csv`);
  await loadFile(page, 'b', `${OUT}/e2e-b.csv`);
  await expect(badges(page)).toHaveText(['CSV', 'CSV']);
  await expect(page.locator('.row.frag')).toHaveCount(5);
  await expect(page.locator('#stats')).toContainText('1 changed');
  await expect(page.locator('#stats')).toContainText('1 only in B');

  await page.locator('#btn-all').click();
  await page.locator('.pop [data-apply="all-r2l"]').click();
  await expect(counter(page)).toHaveText('No differences');
  await page.locator('.slot[data-side="a"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="csv"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('e2e-a (merged).csv');
  const path = `${OUT}/e2e-merged.csv`;
  await file.saveAs(path);
  expect(readFileSync(path, 'utf8')).toBe('id,name,qty\n1,Apple,3\n2,Pear,6\n3,Plum,1\n4,Fig,2\n');
});

test('shows code in a monospace font', async ({ page }) => {
  writeFileSync(`${OUT}/e2e-a.py`, 'def total(items):\n    return sum(items)\n');
  writeFileSync(`${OUT}/e2e-b.py`, 'def total(items):\n    return sum(items) + 1\n');
  await loadFile(page, 'a', `${OUT}/e2e-a.py`);
  await loadFile(page, 'b', `${OUT}/e2e-b.py`);
  await expect(badges(page)).toHaveText(['Code', 'Code']);
  const font = await page.locator('.row .cell.a').first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toMatch(/mono/i);
  await expect(rowByText(page, 'return sum')).toHaveClass(/k-mod/);
});

test('prints one document for saving as PDF', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { printed: string }).printed = '';
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      const root = document.getElementById('print-root');
      (window as unknown as { printed: string }).printed = `${document.title}|${root?.textContent?.slice(0, 200) ?? ''}`;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await page.locator('.slot[data-side="b"] [data-menu="export"]').click();
  await page.locator('.pop [data-export="print"]').click();
  const printed = await page.evaluate(() => (window as unknown as { printed: string }).printed);
  expect(printed).toMatch(/\|.*\S/);
  await expect(page.locator('#print-root')).toHaveCount(0);
});

test('saves a document as PDF', async ({ page }) => {
  // pdfmake comes from a CDN; serve the same files from node_modules so the test runs offline.
  await page.route('https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/**', (route) =>
    route.fulfill({
      path: `node_modules/pdfmake/build/${route.request().url().split('/build/')[1]}`,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'text/javascript' },
    }),
  );
  await loadFile(page, 'a', 'tests/fixtures/contract-v1.docx');
  await expect(page.locator('.dropcard[data-side="a"] h2')).toHaveText('contract-v1.docx');
  await loadFile(page, 'b', 'tests/fixtures/contract-v2.docx');
  await expect(page.locator('.slot[data-side="b"] .slot-name')).toHaveText('contract-v2.docx');
  await page.locator('.slot[data-side="b"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="pdf"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('contract-v2.pdf');
  const path = `${OUT}/e2e-export.pdf`;
  await file.saveAs(path);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('.toast').last()).toContainText('.pdf');
  // The logo is embedded byte for byte: its PNG rows inflate to height × (1 + width × 3) bytes.
  const pdf = bytes.toString('latin1');
  const at = pdf.indexOf('/Subtype /Image');
  expect(at).toBeGreaterThan(0);
  const streamAt = pdf.indexOf('stream\n', at);
  const dict = pdf.slice(at, streamAt);
  expect(dict).toContain('/ColorSpace /DeviceRGB');
  const num = (key: string) => Number(new RegExp(`/${key} (\\d+)`).exec(dict)![1]);
  const start = streamAt + 'stream\n'.length;
  expect(inflateSync(bytes.subarray(start, start + num('Length'))).length).toBe(num('Height') * (1 + num('Width') * 3));
});

test('the single-file build reads and saves PDFs with libraries from the CDN', async ({ page }) => {
  test.skip(!existsSync('dist-single/collate.html'), 'run `npm run build:single` first');
  // pdf.js and pdfmake come from jsDelivr; serve the installed packages instead (the import
  // map's integrity hashes must match them).
  const cdn: string[] = [];
  await page.route('https://cdn.jsdelivr.net/npm/**', (route) => {
    const [, pkg, file] = /\/npm\/(pdfjs-dist|pdfmake)@[^/]+\/(.+)$/.exec(route.request().url())!;
    cdn.push(`${pkg}/${file}`);
    return route.fulfill({ path: `node_modules/${pkg}/${file}`, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/javascript' } });
  });
  await page.goto(`file://${process.cwd()}/dist-single/collate.html`);
  await loadFile(page, 'a', 'tests/fixtures/contract-v2.pdf');
  await loadFile(page, 'b', 'tests/fixtures/contract-v1.docx');
  await expect(badges(page)).toHaveText(['PDF', 'Word']);
  await expect(rowByText(page, 'Accessibility review')).toHaveClass(/k-del/);
  await page.locator('.slot[data-side="b"] [data-menu="export"]').click();
  const download = page.waitForEvent('download');
  await page.locator('.pop [data-export="pdf"]').click();
  expect((await download).suggestedFilename()).toBe('contract-v1.pdf');
  expect(cdn).toEqual(expect.arrayContaining(['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.worker.mjs', 'pdfmake/build/pdfmake.min.js']));
});

test('explains files it cannot read', async ({ page }) => {
  await loadFile(page, 'a', 'tests/fixtures/contract-v1-password.pdf');
  await expect(page.locator('.toast.error')).toContainText('password protected');
});

test('has no horizontal scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
