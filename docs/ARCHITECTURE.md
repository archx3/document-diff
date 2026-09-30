# How Collate is put together

Collate compares two versions of something — a document, a picture or a
recording — entirely in the browser. This note is the map: what each layer
does, how the kinds of comparison plug in, and where to add a new one.

## Kinds

`src/media/kinds.ts` is the one place that knows the kinds:

| Kind | Files | View | Tools |
| --- | --- | --- | --- |
| `text` | Word, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV, code… | the aligned rows (`ui/grid.tsx`, `ui/elastic-grid.tsx`) | `TextToolbar` (`ui/toolbar.tsx`) |
| `image` | PNG, JPEG, GIF, WebP, SVG, BMP | `ui/image/image-view.tsx` | `ui/image/image-tools.tsx` |
| `audio` | MP3, WAV, M4A/AAC, Ogg/Opus, FLAC, WebM | `ui/audio/audio-view.tsx` | `ui/audio/audio-tools.tsx` |

`pairKind(a, b)` says how two documents are compared: two pictures as
pictures, two recordings as sound, anything else as text (a picture or a
recording inside a document shows as an object in its text). Everything that
depends on the kind asks there: the file pickers (`KindPicker` and
`extensionsFor`), the toolbar, the column heads (`ui/facts.ts`), the view,
and the keyboard.

Every file is read into the same model (`core/model.ts`): a `Doc` of blocks.
A picture or recording is a document of one paragraph holding one object
(`formats/image/read.ts`, `formats/audio/read.ts`), so everything built on
documents — undo, sessions, review files, versions, export — works for them
unchanged.

## Layers

```
formats/     files → Doc (readers) and Doc → files (writers)
core/        the model, and comparing text: tokens, Myers diff, alignment, merge, redline, moves, versions
image/       pictures: pixel differences, changed areas, fingerprints (diff.ts, pure); decoding and drawing (draw.ts)
audio/       sound: FFT, waveform, loudness, spectrogram, features (analyze.ts, pure);
             time alignment and differences (align.ts, pure); decoding (decode.ts);
             speech to text (transcribe.ts + transcribe.worker.ts) and transcript diffs (words.ts)
check/       spelling, grammar, contract checks, Claude's suggestions and summary
review/      review marks, where they are, change flags
media/       the kinds
components/  the site, and shared UI (ui/segmented.tsx, ui/slider.tsx, kind-picker.tsx)
ui/          the workspace: app.tsx holds the state; each kind has a controller hook, tools and a view
```

The pure modules (`core/`, `image/diff.ts`, `audio/analyze.ts`,
`audio/align.ts`, `audio/words.ts`, `check/`, `review/risk.ts`) have no DOM
and are unit-tested directly. The browser parts (decoding, drawing, the
worker) are covered by the Playwright tests.

## A kind's parts

Each non-text kind follows the same shape, so the toolbar and the dialog can
share its tools:

1. **A controller hook** — `useImageCompare(sides)`, `useAudioCompare(docs)` —
   holding the comparison's state (mode, sensitivity, zoom, playback …) and
   what it found (changed areas, differences, transcripts). Given `null` it
   is idle, since hooks can't be called conditionally.
2. **Tools** — three components for the toolbar's three columns (what
   changed · how it is shown · zoom and output), plus a key handler
   (`imageKey`, `audioKey`). `ToolbarFrame` lays them out; `HistoryTools` and
   `ShareTool` are shared by every kind.
3. **A view** — draws from the controller, and tells it its size.

`app.tsx` picks by `kind`: the controller for each kind is always called (idle
when not in use), the toolbar and view are chosen, and the keys go to the
kind's handler. The picture dialog for pictures inside documents
(`ui/image/pictures-dialog.tsx`) is the same controller, tools and view in a
dialog.

### Adding a kind

1. Add it to `MediaKind`, `MEDIA` and the extension lists in `media/kinds.ts`.
2. A reader in `formats/<kind>/read.ts` that makes a one-object `Doc`, and its
   detection in `formats/load.ts`.
3. The pure comparison in `src/<kind>/`, with unit tests.
4. A controller hook, tools and view in `ui/<kind>/`; its facts in `ui/facts.ts`.
5. The branches in `app.tsx` (toolbar, view, keys) and a Playwright test.

## Audio, in more detail

- **Decoding** (`audio/decode.ts`): the browser decodes the file once; the
  sound is kept as mono samples at 16 kHz — enough to draw, compare and
  transcribe. The file's own sample rate is read from its header.
- **Comparing** (`audio/analyze.ts`, `audio/align.ts`): each recording becomes
  frames (20 a second, fewer for long ones) of loudness, spectral shape (24
  mel bands) and pitch classes (chroma). The frames are aligned with banded
  dynamic time warping, so an inserted pause or phrase doesn't shift
  everything after it; walking the aligned path finds stretches that sound
  different, and stretches only one recording has. The alignment also maps
  any moment of A to B, which is how playback switches between them at the
  same point.
- **Transcribing** (`audio/transcribe.worker.ts`): Whisper tiny (with word
  timings) through transformers.js, on WebGPU where there is one and
  WebAssembly otherwise, in a worker. `npm run models` puts the model (41 MB)
  and ONNX Runtime in `public/`, so it runs offline and asks no model hub;
  without them it downloads from Hugging Face. Transcripts are compared word
  by word (`audio/words.ts`) and each word keeps its time, so a changed word
  can be heard. Each transcript is also made into a document of its sentences
  (`ui/audio/transcript-view.tsx`) and compared with the text view's own
  grid, under the playback bar.
- **The view** (`ui/audio/`): a ruler over the tracks frames the part in view
  (drag to scroll, drag its ends to zoom); the tracks and playback bar scrub
  through the controller's `scrubStart` / `scrubTo` / `scrubEnd`, heard or
  silent; the differences (and, once transcribed, the changed words) are listed
  in the pane (`audio-panel.tsx`), toggled as the text view's list is.

## Transcribing on a server

Transcripts are made in the browser by default. For long recordings or slow
machines there is an optional service, `server/transcribe/`: a small Go program
(standard library only) that runs whisper.cpp — C++, with Metal or CUDA where
it was built with them — with a larger model (`npm run server:model` fetches
ggml-base). The site's API route `app/api/transcribe/route.ts` passes
recordings on to it (`TRANSCRIBE_URL`, read when the Next server starts), so
the service listens on the machine only. The page asks the route whether
transcription is offered (`src/audio/transcribe-server.ts`), and sends nothing
until the reader agrees in the consent dialog (once, or for good in that
browser).

- What is sent is the sound already decoded for comparing: 16 kHz mono, as a
  16-bit WAV. No names, no files.
- The service checks it is that (and not too long), writes it to a private
  temporary folder, runs `whisper-cli` with one word per segment, removes the
  folder, and answers `{ text, words: [{ text, start, end }] }` — the same
  transcript the in-browser worker makes, so everything after it is shared.
- `WORKERS` transcriptions run at once (the rest wait); a browser calling it
  directly must be from one of `ALLOWED_ORIGINS`. `npm run server`, `npm run server:test`.

## Notes on pictures and recordings

`review/media-notes.ts`: a note is on an area of a picture (kept as fractions
of it, so any zoom shows it in place; a click makes a point) or a stretch of a
recording (seconds; a click makes a moment), with text and a colour. They are
kept beside the text marks — in the session and in review files, under
`extra.media` — and swapped with A and B. The views draw and open them
(`ImageView`, `AudioView`, with `NoteEditor` from `ui/media-notes-ui.tsx`);
the panes list them (`ImagePanel`; the audio pane's Notes tab). Annotating is
a mode of each controller (C), so a drag draws a note instead of panning or
scrubbing.

## Pictures, in more detail

Both pictures are drawn at A's size (within 2000 px) and compared pixel by
pixel with a sensitivity; changed pixels are gathered into areas (boxes) to
outline and step through. A picture's fingerprint (a difference hash) is its
key in documents, so a picture that was only resized or saved again is not a
change.
