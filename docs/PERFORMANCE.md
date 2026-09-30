# How the app holds up under load

What the stress tests measured: how large a document the app can compare,
how long and how large a recording, and how many transcriptions the
transcription service takes at once. Each part says what limits it today and
what would move the limit; the last says how to run the tests again and how
to try the large samples by hand.

Measured on 30 September 2026 on an Apple M3 Pro (11 cores, 18 GB), in
Chrome 154 without a window, against a production build (`next build` and
`next start`), with the transcription service running whisper.cpp's base
model on the Mac's GPU, two transcriptions at once (`WORKERS=2`) and up to
30 minutes each (`MAX_MINUTES=30`). Slower machines will be slower; the
shape of the numbers is what carries over.

## In short

| | Comfortable | Works, slowly | Where it gives out |
| --- | --- | --- | --- |
| Documents (paragraphs each) | up to 10,000 (370,000 words): opens in about a second, steps in about a tenth of a second | 25,000 to 50,000 (1.85 million words): opens in 3 to 8 s, 1.6 GB, a step takes up to two-thirds of a second | past 50,000, the tab's memory (Chrome gives a tab about 4 GB, and a reload briefly needs twice the comparison's) |
| Recordings (length each) | up to 20 minutes: compared in 3 s | 30 to 60 minutes: 5 to 10 s, and the page stops responding for up to 5 s at a time | memory, past two hours or so (an hour takes 830 MB); lining up is also least accurate for long, repetitive recordings |
| Transcription on the server | 32 short recordings at once, all answered within 7 s; 30 minutes transcribed in 28 s | recordings behind long ones wait for them | longer than 30 minutes: refused, now before it is sent |
| Transcription on this device | a few minutes of speech (about four times faster than real time) | 10 minutes a recording: 5.5 minutes for the pair | only time: two hour-long recordings would take about half an hour |

## Documents

Two versions of a long contract (`scripts/stress/make-docs.py`): B rewords
4% of the paragraphs, drops 1%, adds 1% and moves a block of 20. Opened
through the start page's file chooser, as a reader opens them.

Reading and comparing, without a browser (`core.stress.ts`):

| Paragraphs | Changes | Read (Word / text) | Compare |
| --- | --- | --- | --- |
| 1,000 | 62 | 0.13 s / 0.002 s | 0.04 s |
| 5,000 | 281 | 0.23 s / 0.008 s | 0.2 s |
| 10,000 | 525 | 0.39 s / 0.01 s | 0.5 to 0.6 s |
| 25,000 | 1,380 | 0.8 s / 0.03 s | 1.0 to 1.2 s |
| 50,000 | 2,819 | 1.8 s / 0.06 s | 2.5 to 2.9 s |

In the browser, Word files (`browser-docs.mjs`; plain text is much the
same). A step is N pressed to the next change painted, timed in the page;
the slowest frame is the worst of the smooth scroll that follows.

| Paragraphs | Open | Memory | Page elements | Step (bands / rows) | Slowest frame | Bands off / on | Changes only / back | Reload |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.26 s | 41 MB | 9,000 | 11 / 12 ms | 33 ms | 0.05 / 0.09 s | 0.03 / 0.06 s | 0.4 s |
| 5,000 | 0.65 s | 169 MB | 44,000 | 58 / 43 ms | 67 ms | 0.18 / 0.44 s | 0.09 / 0.28 s | 0.9 s |
| 10,000 | 1.2 s | 330 MB | 86,000 | 114 / 78 ms | 100 ms | 0.33 / 0.49 s | 0.11 / 0.53 s | 1.6 s |
| 25,000 | 2.7 s | 817 MB | 216,000 | 270 / 163 ms | 284 ms | 1.0 / 1.6 s | 0.33 / 1.2 s | 3.7 s |
| 50,000 | 7.7 s | 1.6 GB | 432,000 | 644 / 453 ms | 617 ms | 1.9 / 2.9 s | 1.1 / 3.2 s | 10.5 s |

What it costs, and why:

- **Every paragraph is on the page**, in both columns (with
  `content-visibility: auto`, so those out of sight are not laid out). The
  page grows by about 33 KB and 9 elements a paragraph, and anything that
  touches every row grows with the document: switching the bands, folding,
  and Chrome's own bookkeeping for the rows it skips.
- **A step** used to lay out the whole document: with connection bands, every
  render measured every line again, and a step renders to move the current
  change. Now only the current change's band is drawn again
  (`ui/elastic-grid.tsx`), which makes a step 15 to 20% quicker and its
  slowest far less slow: 139 to 115 ms at 10,000 paragraphs, 370 to 318 ms
  at 25,000, and 794 to 684 ms at 50,000 (the slowest, 2.1 to 1.4 s; timed
  apart from the table above, and runs vary by about that much). What is
  left of a step's cost grows with the document for the reason above: React
  checks every row for a change, Chrome keeps track of every row it skips,
  and rows shown for the first time change height, so the columns are
  measured again.
- **A reload** needs, for 6 to 15 seconds, the memory of the page before it
  as well as its own (a new tab restoring the same comparison needs only
  its own). At 50,000 paragraphs that is 3.3 GB for a moment, close to what
  Chrome gives a tab.

To go further, the rows would need to come and go as they scroll into view
(virtualised), with the bands and the ruler drawn from measured or estimated
heights. That is the change that would make size matter little; it touches
the grid, the band layout and keeping the reader's place, so it is its own
piece of work.

## Recordings

Two takes of a talk (`scripts/stress/make-audio.mjs`): one sentence said over
and over, B saying one in seven differently and pausing longer now and then
(so B runs a little longer: 31:57 for 30 minutes, 63:49 for 60). Opened
through the start page's file chooser; timed until the differences are
found, which is decoding, analysing, lining up and comparing.

| Recordings | Files | Compare | Memory | Page stopped for, at most | Differences |
| --- | --- | --- | --- | --- | --- |
| 5 min | 13 + 14 MB WAV | 1.3 s | 74 MB | 0.9 s | 11 |
| 10 min | 25 + 27 MB WAV | 1.8 s | 195 MB | 1.2 s | 27 |
| 20 min | 50 + 54 MB WAV | 2.9 s | 273 MB | 1.8 s | 71 |
| 30 min | 76 + 81 MB WAV | 4.3 s | 488 MB | 2.6 s | 71 |
| 30 min, A as 44.1 kHz stereo | 303 + 81 MB WAV | 5.6 s | 632 MB | 2.8 s | 66 |
| 30 min, AAC | 13 + 14 MB | 5.3 s | 281 MB | 2.8 s | 76 |
| 60 min | 151 + 161 MB WAV | 9.7 s | 828 MB | 4.8 s | 801 |

- **The page stops responding** while it analyses and lines up the two, for
  up to 5 s at a time for an hour. Both run on the page's thread; in a
  worker, the page would stay responsive (and could say how far it had got).
- **Lining up long recordings** (`audio/align.ts`): both are analysed at one
  frame rate (the longer one's, 20 a second up to three hours), and past
  8,000 frames (6 minutes 40) they are lined up coarse to fine: pooled frames
  first, then the full-rate path within a corridor around that one. An hour
  lines up in 1.3 s (without a browser; analysing it takes 3.7 s).
- **Where it miscounts**: coarse to fine is less sure than lining up every
  frame. On the talk above, which repeats one sentence, a slip in the coarse
  path shows as differences: 20 minutes gives 80 where lining up every frame
  gives 37, and 60 minutes flags 801. On varied speech (`make-speech.mjs`,
  the system voice reading sentences, with a record of what B changed),
  every length finds far more than was changed: 146 differences for 14
  edits at 10 minutes, 448 for 49 at 30, 1,016 for 90 at 60. Most of those
  are "sounds different" stretches where the synthesised voice says the same
  words a little differently (A against itself finds none, and the same text
  said twice finds none), so this measures the voice as much as the lining
  up; but it does show that a sound-only comparison of long speech is best
  read with the transcripts. Anchoring the lining up on what was said, a
  wider corridor where the coarse path is unsure, or lining up every frame
  for recordings up to 20 minutes (slower, but it found 37 where coarse to
  fine found 80) would each help.

## Transcription

The page sends each recording (16 kHz mono WAV, 1.8 MB a minute) to the
site, which passes it to the service (`scripts/stress/transcribe-load.mjs`).

Many at once, a 5-second recording each:

| At once | All answered in | Half answered within | Slowest |
| --- | --- | --- | --- |
| 1 | 1.0 s | 1.0 s | 1.0 s |
| 2 | 0.6 s | 0.6 s | 0.6 s |
| 4 | 0.9 s | 0.9 s | 0.9 s |
| 8 | 1.7 s | 1.3 s | 1.7 s |
| 16 | 3.8 s | 2.5 s | 3.8 s |
| 32 | 7.0 s | 3.9 s | 7.0 s |

All were answered; two ran at a time (the service's workers) and the rest
waited their turn. Two transcriptions at once take about 760 MB.

Long ones, one at a time:

| Length | Sent | Transcribed in | Faster than real time |
| --- | --- | --- | --- |
| 1 min | 1.8 MB | 1.2 s | 52 times |
| 5 min | 9.2 MB | 5.2 s | 58 times |
| 10 min | 18 MB | 9.7 s | 62 times |
| 29.5 min | 54 MB | 28 s | 63 times |
| 31.5 min | 58 MB | refused (413) in 0.17 s | |

In the browser, both recordings of a pair go at once: 13 s for two
10-minute recordings, 24 s for two 20-minute ones.

- **Short ones wait behind long ones.** With both workers on 10-minute
  recordings, four 5-second ones waited 12 s. Two at once also run at about
  three-quarters of the speed of one, so the service does about 90 minutes of
  sound a minute on this machine.
- **Nothing limits the queue.** A request waits for a worker for as long as
  the page waits, and the site gives it 15 minutes in all, waiting included;
  past that, the reader is told the service can't be reached. A service
  that answered "busy, try again in a minute" once more than a few were
  waiting would say what is really happening.
- **Too long**: a recording over 30 minutes used to be sent (58 MB) and
  refused once a worker read it, and the other recording of the pair was
  transcribed for nothing. Now the page asks the site how long a recording
  the service takes and says so before sending either
  (`tooLongForServer` in `audio/transcribe-server.ts`). Cutting a long
  recording into 30-minute parts on the page, and joining the transcripts,
  would lift the limit.

On this device instead (Whisper tiny, in a worker in the page;
`WHERE=device browser-audio.mjs`), speech is transcribed about four times
faster than real time on this Mac, with WebGPU or without: two 10-minute
recordings took 5.5 minutes, and two 2-minute ones 61 s with WebGPU and 52 s
without it (WASM). The page stays responsive all the while. The model the page
uses is quantised to 8 bits, which the GPU gains nothing from; a 16-bit one
may well be quicker on WebGPU, for a larger download (about 40 MB now). Until
then, long recordings are the server's: it was 25 times quicker for the two
10-minute ones.

## Try it yourself

`npm run samples:large` makes the large samples (about 1.5 GB) in
`tests/fixtures/out/stress`, which is not committed: long documents as Word
and text, the talk at 10, 30 and 60 minutes (and at 30 as a 318 MB stereo
WAV and as AAC), and speech at 10, 30 and 60 minutes. It needs Python with
`python-docx`, and for the speech a Mac (`say`).

A development server (`npm run dev`) then lists them at `/samples/large/`
(linked from the Samples page), each opened in one click. A production
server shows them too when started with `LARGE_SAMPLES=1`
(`npx next build && LARGE_SAMPLES=1 npx next start`); otherwise the page and
the files are not there.

To measure again:

```bash
npx vitest run --config scripts/stress/vitest.config.ts
npx next build && npx next start --port 4192
node scripts/stress/browser-docs.mjs http://localhost:4192
node scripts/stress/browser-audio.mjs http://localhost:4192
WHERE=device node scripts/stress/browser-audio.mjs http://localhost:4192 "10 min of speech"
node scripts/stress/transcribe-load.mjs http://localhost:4192
```

The benchmark also reads smaller documents and recordings than the large
samples: `python3 scripts/stress/make-docs.py` and
`node scripts/stress/make-audio.mjs` make every size it uses (and
`make-speech.mjs 2` the 2-minute speech). The browser scripts use Playwright
with Chrome; the transcription ones need the service (`npm run server`). Each writes what it measured to
`tests/fixtures/out/stress/*.json`. Pick a port other than 4190: browsers
(and Node's `fetch`) refuse it. Recordings too long for the service are no
longer sent, which also keeps Playwright out of trouble: Chrome's developer
tools copy an upload into a single message, and a 60-minute one is more text
than Node can hold.
