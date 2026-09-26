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
  await page.goto('/');
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
  await page.locator('.fold-btn').first().click();
  await expect(page.locator('#btn-changes')).toHaveAttribute('aria-pressed', 'true');
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
