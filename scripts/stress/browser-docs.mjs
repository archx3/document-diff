/**
 * Large documents in the browser: two versions opened as a reader opens them
 * (the file chooser on the start page), then timed as they are read and
 * compared, stepped through, redrawn with and without connection bands,
 * folded, and restored after a reload; with the page's memory and size.
 *
 * Run: node scripts/stress/browser-docs.mjs [site] [sizes…]   (default http://localhost:4174; 1000 5000 10000 25000 50000;
 * EXTS=docx for the Word files only)
 * Needs the site running (a production build: npx next build && npx next start) and make-docs.py's documents.
 * Writes tests/fixtures/out/stress/browser-docs.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [site = 'http://localhost:4174', ...rest] = process.argv.slice(2);
const SITE = site.replace(/\/+$/, '');
const SIZES = rest.length ? rest.map(Number) : [1000, 5000, 10000, 25000, 50000];
const DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const LIMIT = 10 * 60 * 1000;

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const results = [];

/**
 * The page's state: its memory, its size, and how much of the main thread long tasks took. It waits
 * a moment first, for work left over (and, after a reload, the page before it) to be let go.
 */
const state = async (page) => {
  await page.waitForTimeout(4000);
  return page.evaluate(() => {
    globalThis.gc?.();
    return {
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      nodes: document.getElementsByTagName('*').length,
      rows: document.querySelectorAll('.row').length,
      longTaskMs: Math.round(globalThis.__long ?? 0),
    };
  });
};

/**
 * Presses a key in the page and times it there (a round trip to the page would add its own time):
 * until the page has painted the result, and the slowest frame in the second after (a step scrolls
 * smoothly to its change). Waits for the page to settle before and after.
 */
async function press(page, key) {
  await page.waitForTimeout(300);
  return page.evaluate(
    (k) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        let painted = 0;
        let last = performance.now();
        let worst = 0;
        const tick = (now) => {
          if (!painted) painted = now;
          else worst = Math.max(worst, now - last);
          last = now;
          if (now - t0 < 1000) requestAnimationFrame(tick);
          else resolve({ ms: Math.round(painted - t0), worstFrameMs: Math.round(worst) });
        };
        // The first frame's callback comes before it is drawn; the second's after.
        requestAnimationFrame(() => requestAnimationFrame(tick));
      }),
    key,
  );
}

const counter = (page) => page.locator('#counter .vh');

/** Presses N `times`: the median and slowest times to the painted step, and the slowest frame after one. */
async function stepping(page, times) {
  const steps = [];
  for (let i = 0; i < times; i++) steps.push(await press(page, 'n'));
  const ms = steps.map((x) => x.ms).sort((a, b) => a - b);
  return { median: ms[ms.length >> 1], max: ms.at(-1), worstFrameMs: Math.max(...steps.map((x) => x.worstFrameMs)) };
}

for (const size of SIZES) {
  for (const ext of (process.env.EXTS ?? 'docx,txt').split(',')) {
    const files = ['a', 'b'].map((s) => join(DIR, `doc-${size}-${s}.${ext}`));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(LIMIT);
    await page.addInitScript(() => {
      // Long tasks, counted from the start (the time the page could not respond).
      globalThis.__long = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) globalThis.__long += e.duration;
      }).observe({ type: 'longtask', buffered: true });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const row = { size, ext };
    try {
      await page.goto(`${SITE}/`);
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Choose one or two files' }).click();
      const t0 = Date.now();
      await (await chooser).setFiles(files);
      await page.waitForURL(/\/compare\/$/);
      await counter(page).filter({ hasText: 'of' }).waitFor();
      row.openMs = Date.now() - t0;
      row.changes = Number((await counter(page).textContent()).match(/of ([\d,]+)/)[1].replace(/,/g, ''));
      Object.assign(row, await state(page));

      // Stepping: the next change, twenty times.
      row.stepMs = await stepping(page, 20);

      // A jump to the bottom of the page: lines never shown yet are laid out, and the columns lined up.
      await page.waitForTimeout(300);
      row.toEndMs = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const sc = document.querySelector('.scroller');
            const t0 = performance.now();
            sc.scrollTop = sc.scrollHeight;
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
          }),
      );

      // Connection bands off (B), stepping without them (the paragraphs in rows), and on again.
      row.bandsOff = await press(page, 'b');
      row.stepRowsMs = await stepping(page, 10);
      row.bandsOn = await press(page, 'b');

      // Changes only (C), and back.
      row.fold = await press(page, 'c');
      row.unfold = await press(page, 'c');

      // A reload: the comparison comes back from the browser's storage.
      await page.waitForTimeout(3000);
      const t1 = Date.now();
      await page.reload();
      await counter(page).filter({ hasText: 'of' }).waitFor();
      row.reloadMs = Date.now() - t1;
      row.after = await state(page);
    } catch (e) {
      row.error = String(e).split('\n')[0];
    }
    if (errors.length) row.pageErrors = errors.slice(0, 3);
    results.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(join(DIR, 'browser-docs.json'), JSON.stringify(results, null, 1));
    await context.close();
  }
}
await browser.close();
