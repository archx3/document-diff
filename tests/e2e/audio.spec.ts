import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.setTimeout(60_000);

/** Transcribing runs a speech model for real (tens of seconds, a lot of CPU): only when asked for, with TRANSCRIBE_TESTS=1. */
const transcribing = !!process.env.TRANSCRIBE_TESTS;

async function openRecordings(page: Page, files = ['tests/fixtures/speech-v1.wav', 'tests/fixtures/speech-v2.m4a']) {
  await page.goto('/compare/new/');
  await page.getByRole('radiogroup', { name: 'What are you comparing?' }).getByRole('radio', { name: /Audio/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles(files);
  await expect(page.locator('#toolbar [data-stats]')).toContainText('differences');
}

test('two recordings: where they differ, and playback that switches between them', async ({ page }) => {
  await page.goto('/compare/new/');
  await page.getByRole('radiogroup', { name: 'What are you comparing?' }).getByRole('radio', { name: /Audio/ }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles(['tests/fixtures/speech-v1.wav', 'tests/fixtures/speech-v2.m4a']);
  await expect(page).toHaveURL(/\/compare\/$/);

  // The audio tools, and heads that say what the recordings are.
  const toolbar = page.locator('#toolbar');
  await expect(toolbar).toHaveAttribute('data-kind', 'audio');
  await expect(toolbar.locator('#btn-changes, #btn-review')).toHaveCount(0);
  // The heads are beside the tracks: the recording, its format and its menus on the left; its facts over the track.
  await expect(page.locator('#colheads')).toHaveCount(0);
  const rowA = page.locator('.at-row[data-side="a"]');
  await expect(rowA.locator('.at-side .badge')).toHaveText('WAV');
  await expect(rowA.locator('.at-side [data-menu="load"]')).toBeVisible();
  await expect(rowA.locator('.at-side [data-menu="export"]')).toBeVisible();
  await expect(rowA.locator('[data-fact="rate"]')).toHaveText('22.05 kHz');
  await expect(rowA.locator('[data-fact="channels"]')).toHaveText('Mono');
  await expect(rowA.locator('[data-fact="duration"]')).toHaveText('0:05');
  await expect(rowA.locator('[data-fact="size"]')).toContainText('KB');
  await expect(page.locator('#counter')).toHaveCount(0);

  // "nine" became "twelve", and B has a sentence A hasn't.
  await expect(toolbar.locator('[data-stats]')).toContainText('2 differences');
  // The differences are listed in the pane (S), as a document's changes are.
  await page.keyboard.press('s');
  await expect(page.locator('#changes .at-card .at-kind')).toHaveText(['Sounds different', 'Only in B']);
  await expect(page.locator('.at-bands .at-band')).toHaveCount(2);

  // Stepping to a difference selects it; A and B switch at the same moment.
  await page.keyboard.press('n');
  await expect(toolbar.locator('[data-stats]')).toContainText('1 of 2');
  await expect(page.locator('.at-card[data-item="0"]')).toHaveClass(/cur/);
  const play = page.locator('[data-pb="play"]');
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Play');
  await page.locator('[data-pb="switch"]').click();
  await expect(page.locator('[data-pb="switch"] b')).toHaveText('B');
  await page.locator('[data-pb="loop"]').click();
  await expect(page.locator('[data-pb="loop"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-pb="loop"]').click();

  // A difference's mark on the playback bar goes to its start.
  await page.locator('.pb-mark[data-mark="1"]').click();
  await expect(toolbar.locator('[data-stats]')).toContainText('2 of 2');

  // Dragging along the bar scrubs: the playheads on the tracks follow while the pointer is down.
  const bar = await page.locator('.pb-track').boundingBox();
  const headB = page.locator('.at-head[data-head="b"]');
  await page.mouse.move(bar!.x + 4, bar!.y + bar!.height / 2);
  await page.mouse.down();
  const before = (await headB.boundingBox())!.x;
  await page.mouse.move(bar!.x + bar!.width * 0.6, bar!.y + bar!.height / 2, { steps: 5 });
  await expect.poll(async () => (await headB.boundingBox())!.x).toBeGreaterThan(before + 50);
  await page.mouse.up();

  // Dragging a playhead scrubs too, and moves the bar's thumb.
  const thumb = page.locator('.pb-thumb');
  const knob = (await page.locator('.at-head[data-head="b"] .at-knob').boundingBox())!;
  const thumbAt = (await thumb.boundingBox())!.x;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(knob.x - 150, knob.y + knob.height / 2, { steps: 5 });
  await expect.poll(async () => (await thumb.boundingBox())!.x).toBeLessThan(thumbAt - 20);
  await page.mouse.up();

  // The ruler over the tracks zooms from its frame's ends, and scrolls by its frame.
  const zoomBox = (await page.locator('.at-zoom').boundingBox())!;
  const edge = (await page.locator('.az-edge[data-edge="r"]').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width * 0.25, edge.y + edge.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(toolbar.locator('[data-zoom="fit"]')).toHaveText(/^[\d.]+×$/);
  const scroller = page.locator('#audio-tracks');
  await expect.poll(() => scroller.evaluate((el) => el.scrollWidth > el.clientWidth * 3)).toBe(true);
  const frame = (await page.locator('.az-view').boundingBox())!;
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2 + 200, frame.y + frame.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  await page.locator('.at-zoom').dblclick();
  await expect(toolbar.locator('[data-zoom="fit"]')).toHaveText('Fit');

  // The other forms, and the sensitivity.
  for (const vis of ['spectrum', 'loudness', 'wave']) {
    await toolbar.locator(`[data-vis="${vis}"]`).click();
    await expect(toolbar.locator(`[data-vis="${vis}"]`)).toHaveAttribute('aria-checked', 'true');
  }
  // Both differences are clear: even the least sensitive setting hears them. The most sensitive marks more of the recordings.
  const seconds = async () => Number((await toolbar.locator('[data-stats]').textContent())!.match(/([\d.]+) s/)![1]);
  await toolbar.locator('[data-control="sensitivity"]').fill('0');
  await expect(toolbar.locator('[data-stats]')).toContainText('of 2 differences');
  const least = await seconds();
  await toolbar.locator('[data-control="sensitivity"]').fill('100');
  await expect.poll(seconds).toBeGreaterThan(least);
  await toolbar.locator('[data-control="sensitivity"]').fill('70');
});

test('notes on a recording: a stretch marked on a track, written on, listed, and kept', async ({ page }) => {
  await openRecordings(page);

  await page.keyboard.press('c');
  await expect(page.locator('#btn-annotate')).toHaveAttribute('aria-pressed', 'true');
  const track = (await page.locator('.at-track[data-track="b"]').boundingBox())!;
  await page.mouse.move(track.x + track.width * 0.2, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.4, track.y + track.height / 2, { steps: 4 });
  await page.mouse.up();
  const editor = page.locator('.mn-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.mn-where')).toContainText('B, 0:01');
  await editor.locator('[data-note-text]').fill('The pause is too long');
  await editor.locator('[data-color="pink"]').click();
  await editor.locator('[data-note="done"]').click();
  await expect(editor).toHaveCount(0);
  const mark = page.locator('.at-track[data-track="b"] .at-note');
  await expect(mark).toHaveClass(/hl-pink/);

  // Listed in the pane's notes; clicking one opens it again.
  await page.keyboard.press('s');
  await page.locator('#notes-tab').click();
  await expect(page.locator('#changes [data-notes] .mn-card')).toContainText('The pause is too long');
  await page.locator('#changes [data-note-item="0"]').click();
  await expect(page.locator('.mn-editor [data-note-text]')).toHaveValue('The pause is too long');
  await page.keyboard.press('Escape');

  // Kept with the comparison.
  await page.reload();
  await expect(page.locator('.at-track[data-track="b"] .at-note')).toHaveCount(1);
});

test('review mode is for documents: recordings keep their own layout', async ({ page }) => {
  // Its margins (for notes on paragraphs) would push a transcript's rows out of their columns.
  await page.addInitScript(() => localStorage.setItem('collate.prefs.v1', JSON.stringify({ review: true, bands: false })));
  await openRecordings(page);
  await expect(page.locator('.app')).not.toHaveClass(/\breview\b/);
});

test('transcribed on this device, and compared as documents are', async ({ page }) => {
  test.skip(!transcribing, 'set TRANSCRIBE_TESTS=1 to run the speech model');
  test.setTimeout(240_000);
  await openRecordings(page);
  const toolbar = page.locator('#toolbar');
  await page.keyboard.press('s');
  await toolbar.locator('#btn-transcribe').click();
  // What was said is compared as documents are, under the playback bar…
  const said = page.locator('.at-said-cmp');
  await expect(said.locator('.cell.b')).toContainText(['engineers'], { timeout: 180_000 });
  await expect(said.locator('.row.k-mod, .row.k-ins')).not.toHaveCount(0);
  // With connection bands, as documents have; "9%" as said, not "9 %".
  await expect(said.locator('.band')).not.toHaveCount(0);
  await expect(said.locator('.cell.a').first()).toContainText('9%');
  // Punctuation is the transcriber's guess: left out, unless asked for.
  const punctuation = said.locator('.chg', { hasText: /^[.,;:!?]$/ });
  await expect(punctuation).toHaveCount(0);
  await page.locator('#btn-transcribe-where').click();
  await page.locator('.where-menu [data-ignore="punctuation"]').uncheck();
  await expect(punctuation).not.toHaveCount(0);
  await page.locator('.where-menu [data-ignore="punctuation"]').check();
  await expect(punctuation).toHaveCount(0);
  await page.keyboard.press('Escape');
  // …and the pane splits: the sounds over the words.
  await expect(page.locator('#changes .ap-divide')).toBeVisible();
  await expect(page.locator('#changes [data-words] .chg-card')).not.toHaveCount(0);
  await expect(page.locator('#changes .at-card').last()).toContainText('engineers');
  // Kept with the comparison: a reload shows what was said again, without transcribing.
  await page.reload();
  await expect(said.locator('.cell.b')).toContainText(['engineers']);
  await expect(page.locator('#btn-transcribe')).toHaveText('Hide transcript');
});

test('a transcription started by mistake can be stopped, and started again', async ({ page }) => {
  test.skip(!transcribing, 'set TRANSCRIBE_TESTS=1 to run the speech model');
  test.setTimeout(240_000);
  await openRecordings(page);
  const button = page.locator('#toolbar #btn-transcribe');
  await button.click();
  // Under way: a stop button beside it, and one between the transcripts' heads.
  await expect(page.locator('#btn-transcribe-stop')).toBeVisible();
  await expect(page.locator('.at-said-cmp [data-transcript-stop]')).toBeVisible();
  await page.locator('#btn-transcribe-stop').click();
  await expect(button).toHaveText('Transcribe');
  await expect(page.locator('#btn-transcribe-stop')).toHaveCount(0);
  await expect(page.locator('.at-said-cmp')).toHaveCount(0);
  // Esc stops it too.
  await button.click();
  await expect(page.locator('#btn-transcribe-stop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toHaveText('Transcribe');
  // And it runs to the end when left to.
  await button.click();
  await expect(page.locator('.at-said-cmp .cell.b')).toContainText(['engineers'], { timeout: 180_000 });
  await expect(button).toHaveText('Hide transcript');
});

test('a tune has no words: nothing made up is shown', async ({ page }) => {
  test.skip(!transcribing, 'set TRANSCRIBE_TESTS=1 to run the speech model');
  test.setTimeout(240_000);
  await openRecordings(page, ['public/samples/melody-v1.wav', 'public/samples/melody-v2.wav']);
  await page.locator('#toolbar #btn-transcribe').click();
  const said = page.locator('.at-said-cmp');
  await expect(said.locator('.said-none')).toHaveText('No speech was heard in either recording.', { timeout: 180_000 });
  await expect(said.locator('.slot-meta')).toContainText(['No speech heard', 'No speech heard']);
  await expect(said.locator('.row')).toHaveCount(0);
});

test('transcribing on the server asks first, then compares what was said', async ({ page, request }) => {
  test.skip(!transcribing, 'set TRANSCRIBE_TESTS=1 (and run npm run server) to transcribe on the server');
  const up = await request.get('/api/transcribe').then(async (r) => r.ok() && !!(await r.json()).available, () => false);
  test.skip(!up, 'the transcription service is not running (npm run server)');
  await openRecordings(page);

  await page.locator('#btn-transcribe-where').click();
  await page.locator('.where-menu [data-where="server"]').click();
  // Nothing is sent before the reader says so.
  const dialog = page.locator('dialog.consent');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-consent="no"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#btn-transcribe')).toHaveText('Transcribe');

  await page.locator('#btn-transcribe').click();
  await dialog.locator('[data-consent="yes"]').click();
  const said = page.locator('.at-said-cmp');
  await expect(said.locator('.cell.b')).toContainText(['engineers'], { timeout: 60_000 });
  await expect(said.locator('.cell.a')).toContainText(['grew']);
});

test('a transcription on the server can be stopped too', async ({ page, request }) => {
  test.skip(!transcribing, 'set TRANSCRIBE_TESTS=1 (and run npm run server) to transcribe on the server');
  const up = await request.get('/api/transcribe').then(async (r) => r.ok() && !!(await r.json()).available, () => false);
  test.skip(!up, 'the transcription service is not running (npm run server)');
  await openRecordings(page);
  await page.locator('#btn-transcribe-where').click();
  await page.locator('.where-menu [data-where="server"]').click();
  await page.locator('dialog.consent [data-consent="yes"]').click();
  // Stopped while the service works on it: the request is dropped, and the service stops too.
  await page.locator('#btn-transcribe-stop').click();
  await expect(page.locator('#toolbar #btn-transcribe')).toHaveText('Transcribe');
  await expect(page.locator('.at-said-cmp')).toHaveCount(0);
  // Asked once for this page: started again, it runs to the end.
  await page.locator('#toolbar #btn-transcribe').click();
  await expect(page.locator('.at-said-cmp .cell.b')).toContainText(['engineers'], { timeout: 60_000 });
});

test('recordings longer than the server takes are not sent, and the reader is told why', async ({ page }) => {
  // The service says it takes recordings of up to 4 seconds (A is 5 s long, B 7 s).
  await page.route('**/api/transcribe/', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { available: true, model: 'test', maxSeconds: 4 } }) : route.continue()));
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/transcribe')) sent.push(r.url());
  });
  await openRecordings(page);
  await page.locator('#btn-transcribe-where').click();
  await page.locator('.where-menu [data-where="server"]').click();
  await page.locator('dialog.consent [data-consent="yes"]').click();
  await expect(page.locator('.said-error')).toHaveText('A and B are 0:05 and 0:07 long, and the transcription server takes recordings of up to 0:04. Transcribe on this device instead, or compare shorter recordings.');
  expect(sent).toHaveLength(0);
});
