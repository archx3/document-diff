/**
 * Long and large recordings in the browser: two takes opened as a reader opens
 * them (the start page's file chooser), timed until their differences are
 * found, with the page's memory; then both transcribed on the transcription
 * server, timed until the transcripts are compared.
 *
 * Run: node scripts/stress/browser-audio.mjs [site] [pairs…]   (default http://localhost:4174; every pair below)
 * WHERE=device transcribes in the browser instead (Whisper, on WebGPU when there is one; NO_WEBGPU=1
 * turns the GPU off, as in a browser without WebGPU), and then the pairs of speech are the ones to try:
 * node scripts/stress/browser-audio.mjs [site] "10 min of speech"   (make-speech.mjs 2 makes the 2-minute pair)
 * Needs the site running (a production build), the transcription service for
 * the transcripts, and make-audio.mjs's recordings (made with --large for the
 * stereo WAV and the AAC pair). Writes tests/fixtures/out/stress/browser-audio.json.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [site = 'http://localhost:4174', ...only] = process.argv.slice(2);
const SITE = site.replace(/\/+$/, '');
const DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const LIMIT = 20 * 60 * 1000;
const PAIRS = [
  ['5 min', 'talk-5m-a.wav', 'talk-5m-b.wav'],
  ['10 min', 'talk-10m-a.wav', 'talk-10m-b.wav'],
  ['20 min', 'talk-20m-a.wav', 'talk-20m-b.wav'],
  ['30 min', 'talk-30m-a.wav', 'talk-30m-b.wav'],
  ['60 min', 'talk-60m-a.wav', 'talk-60m-b.wav'],
  ['30 min, 44.1 kHz stereo WAV', 'talk-30m-a-stereo.wav', 'talk-30m-b.wav'],
  ['30 min, AAC', 'talk-30m-a.m4a', 'talk-30m-b.m4a'],
  ['2 min of speech', 'speech-2m-a.wav', 'speech-2m-b.wav'],
  ['10 min of speech', 'speech-10m-a.wav', 'speech-10m-b.wav'],
  ['30 min of speech', 'speech-30m-a.wav', 'speech-30m-b.wav'],
].filter(([name]) => (only.length ? only.includes(name) : !name.includes('speech')));
const WHERE = process.env.WHERE === 'device' ? 'device' : 'server';

const noGpu = WHERE === 'device' && !!process.env.NO_WEBGPU;
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', ...(noGpu ? ['--disable-gpu'] : [])] });
const results = [];
const mb = (n) => Math.round(n / 1048576);

for (const [name, a, b] of PAIRS) {
  const files = [a, b].map((f) => join(DIR, f));
  if (!files.every(existsSync)) {
    console.log(`${name}: missing (make-audio.mjs --large makes them)`);
    continue;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(LIMIT);
  await page.addInitScript((where) => {
    // Where the reader chose to transcribe (and, for the server, that they agreed to send recordings there).
    localStorage.setItem('appose.transcribe-where', where);
    localStorage.setItem('appose.transcribe-consent', location.origin);
    // Long tasks: all the time the page could not respond, and the longest it went without.
    globalThis.__long = 0;
    globalThis.__worst = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        globalThis.__long += e.duration;
        globalThis.__worst = Math.max(globalThis.__worst, e.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  }, WHERE);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => errors.push('the page crashed'));
  const row = { name, where: WHERE, files: [a, b], fileMB: files.map((f) => mb(statSync(f).size)) };
  const state = () =>
    page.evaluate(() => {
      globalThis.gc?.();
      return { heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), longTaskMs: Math.round(globalThis.__long), worstTaskMs: Math.round(globalThis.__worst) };
    });
  try {
    await page.goto(`${SITE}/`);
    await page.getByRole('radiogroup', { name: 'What are you comparing?' }).getByRole('radio', { name: /Audio/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose one or two files' }).click();
    const t0 = Date.now();
    await (await chooser).setFiles(files);
    await page.waitForURL(/\/compare\/$/);
    // Decoded, lined up and compared: the toolbar stops saying "Comparing…".
    const stats = page.locator('[data-stats]');
    await page.waitForFunction(() => {
      const s = document.querySelector('[data-stats]')?.textContent ?? '';
      return s && !s.includes('Comparing');
    }, null, { timeout: LIMIT });
    row.compareMs = Date.now() - t0;
    row.found = (await stats.textContent()).trim();
    Object.assign(row, await state());

    // Both transcribed, and what was said compared.
    if (WHERE === 'device') row.webgpu = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter().catch(() => null)));
    const t1 = Date.now();
    await page.locator('#btn-transcribe').click();
    // Done (the button offers to show or hide the transcript), or not (the transcript says why).
    await page.waitForFunction(() => /transcript/i.test(document.querySelector('#btn-transcribe')?.textContent ?? '') || !!document.querySelector('.said-error'), null, { timeout: LIMIT });
    row.transcribeMs = Date.now() - t1;
    const failed = page.locator('.said-error');
    row.transcribed = (await failed.count()) ? `not transcribed: ${(await failed.textContent()).trim()}` : (await page.locator('#btn-transcribe').textContent()).trim();
    row.after = await state();
  } catch (e) {
    row.error = String(e).split('\n')[0];
  }
  if (errors.length) row.pageErrors = errors.slice(0, 3);
  results.push(row);
  console.log(JSON.stringify(row));
  writeFileSync(join(DIR, `browser-audio${WHERE === 'device' ? (noGpu ? '-device-wasm' : '-device') : ''}.json`), JSON.stringify(results, null, 1));
  await context.close();
}
await browser.close();
