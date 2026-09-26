# Collate

Compare two versions of a document side by side, see every difference down to the word, and copy changes from one version to the other. Word, Google Docs, PDF, OpenDocument, RTF, EPUB, web pages, Markdown, CSV and plain-text files all work, and the two versions don't have to be in the same format. Collate runs entirely in your browser. Documents are never uploaded.

![Two drafts of an agreement compared side by side, with changed words highlighted and arrows between the columns for copying changes](docs/screenshot.png)

## What you can do

- **Load documents** as **A** and **B**:
  - Word files (`.docx`). This is also the best way in for Google Docs: *File › Download › Microsoft Word (.docx)*.
  - Rich text pasted straight from Google Docs or Word, with headings, lists, tables, bold, italic and links kept.
  - A Google Docs link: Collate builds the `.docx` download link for you, and private documents work because the download uses your own Google sign-in.
  - OpenDocument text (`.odt`, and flat `.fodt`) from LibreOffice, Collabora or OnlyOffice.
  - PDF. A PDF stores laid-out text rather than paragraphs, so Collate rebuilds the document: from the PDF's structure tags when it has them (Word, LibreOffice and most modern tools write them), otherwise from the layout of each page. Headings, lists, tables, links, footnotes and tables of contents come back, and running headers, footers and page numbers are left out.
  - Rich Text (`.rtf`), old Word 97–2003 files (`.doc`) and EPUB books.
  - Web pages (`.html`, `.mht`), Markdown and plain text.
  - CSV and TSV files, compared row by row as tables.
  - Code, data and config files (`.json`, `.xml`, `.yaml`, `.tex`, `.py` and many more), compared line by line in a monospace font.
  - Files are recognized by their content, so a `.doc` that is really RTF or a web page still loads.
  - Drop two files at once and they load as A and B.
- **Compare.** Paragraphs are lined up side by side, and rewritten paragraphs are paired with their counterpart instead of showing as removed and added. Inside a paragraph, words only in A are red, words only in B are green, and a caret marks where the other side has extra text. Formatting-only changes (bold, italic, link targets, heading level, list type, alignment) are flagged separately. Tables are compared row by row and cell by cell. Images, footnote text, fields and equations count too.
- **Find your way.** The ruler between the columns has a mark for every change: click a mark to go to it, or drag its frame (the part of the documents on screen) to scroll. The minimap draws each document in miniature on either side of the ruler. The list of changes names every change with its words, and how many words are only in A (−) and only in B (+); click one to go there. Buttons step to the next or previous change or page, and are greyed out where there is nowhere to go. When A and B match, the toolbar turns green.
- **Copy changes across**, in either direction:
  - a whole paragraph (the arrows either side of the ruler);
  - a single word-level edit (click a highlighted word);
  - a single table row, or the whole table;
  - the current change (<kbd>Alt</kbd>+<kbd>→</kbd> / <kbd>Alt</kbd>+<kbd>←</kbd>);
  - everything (*Copy changes › Make B match A*).

  Every copy can be undone and redone.
- **Get the result out** (*Export* on either side). A document is offered in its own format first:
  - **Word** and **OpenDocument**: when the side was loaded from a `.docx` or `.odt`, the original file is kept and only the copied paragraphs change. Styles, headers, footers, page setup, comments, bookmarks and content controls all stay. Copied content brings its images, links, styles, list numbering and footnotes with it, even between Word and OpenDocument files.
  - **CSV/TSV** and code or data files are saved in their own format, with their separator and line endings.
  - Any document can also be saved as a new Word, OpenDocument, RTF or PDF file, a web page, Markdown or plain text. EPUB and `.doc` files are read only, so they are saved in one of these formats.
  - **PDF**: the document is laid out afresh on A4 pages, in Roboto (Latin, Greek and Cyrillic) with Courier for code. The table of contents shows the pages its headings land on in the new PDF and links to them, page-number fields are filled in, and footnotes are listed as notes at the end. The PDF maker, [pdfmake](https://pdfmake.github.io/docs/), is loaded from jsDelivr the first time a PDF is saved, so that needs an internet connection. Only the library is downloaded; the document never leaves the browser.
  - **Print…** prints just that document, cleanly laid out. It isn't offered where the page can't open the print dialog (such as the Claude artifact viewer).
  - **Copy formatted text**, to paste into Google Docs or Word.

### Round trip with Google Docs

1. Get each version in. Either download it as `.docx` (*File › Download › Microsoft Word*) and load the file, or select everything in the doc, copy it, and use *Replace › Paste from Google Docs or Word*.
2. Copy the changes you want.
3. Take the result back to Google Docs in one of two ways:
   - *Export › Download Word document*, then in Google Docs use *File › Open › Upload*. You can also upload the file to Drive and open it with Google Docs.
   - *Export › Copy formatted text*, then select all in the Google Doc and paste over it.

### Options

*Compare* sets what counts as a difference:

- word-by-word or character-by-character marking;
- ignore empty paragraphs (on by default);
- ignore formatting, letter case, extra spaces, or curly versus straight quotes and dashes.

*Changes only* folds unchanged paragraphs away. The other view buttons show the minimap, line numbers in the gutter (paragraph numbers, which for text and code files are their line numbers), the list of changes, and a low contrast mode without borders, where the sheets and the desk share one colour. These are remembered in the browser.

The theme button switches between light and dark. The choice applies to every page and is remembered; picking the system's own theme again goes back to following the system. Notes about the documents (such as a PDF not being editable in place) can be dismissed.

### Keyboard

| Keys | Action |
| --- | --- |
| <kbd>N</kbd> / <kbd>P</kbd> (or <kbd>J</kbd> / <kbd>K</kbd>) | Next / previous change |
| <kbd>Page Down</kbd> / <kbd>Page Up</kbd> | Next / previous page |
| <kbd>Alt</kbd>+<kbd>→</kbd> | Use A's version of the current change in B |
| <kbd>Alt</kbd>+<kbd>←</kbd> | Use B's version of the current change in A |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo, redo |
| <kbd>C</kbd> | Changes only |
| <kbd>S</kbd> | List of changes |
| <kbd>M</kbd> | Minimap |
| <kbd>L</kbd> | Line numbers |
| <kbd>?</kbd> | Help |

### What is and isn't compared

- The document body is compared: paragraphs, headings, lists, tables (including nested ones), links, images, footnote and endnote text, fields and equations. Headers, footers and comments are not compared, and they stay in the exported file.
- Tracked changes are compared as if they were all accepted. They are kept as they are when you export.
- A paragraph that moved shows as removed in one place and added in another.
- Page numbers and dates inserted as fields compare by what they are, not by the number they happen to show.
- PDFs: pictures can't be matched with another format's (a PDF doesn't keep the original image file), a page number is plain text there, and a PDF that is only a scan has no text to compare. Password-protected PDFs and DRM-protected EPUBs can't be read.
- The Google Docs link option can't fetch the document by itself, because browsers block that. It gives you a one-click download instead.
- Apple Pages, WordPerfect and spreadsheet files aren't read; save them as Word or PDF first.

## Running it

It is a [Next.js](https://nextjs.org) app, exported as a static site with no backend.

```sh
npm install
npm run dev          # http://localhost:3000
npm run build        # static site in out/
npm run preview      # serves out/ at http://localhost:4173
npm run build:single # one self-contained file: dist-single/collate.html
```

The site has four pages:

- `/` is the landing page. Dropping a file on it, or choosing one, starts a comparison.
- `/compare/new/` asks for the other version, which must be the same kind of file as the first (Word with Word, PDF with PDF and so on), then opens the two in the workspace. Opened on its own, it asks for both files in turn.
- `/compare/` is the comparison workspace for the two documents chosen there; any two documents, in any mix of formats, can then be loaded in it. The documents are only kept in memory, so opened directly (or reloaded) it goes to `/compare/new/`.
- `/compare/sample/` is the workspace with the sample drafts.

`dist-single/collate.html` is the workspace on its own, starting with the sample drafts, built by Vite from `index.html` and `src/main.ts`. It works when opened straight from disk, so you can share it as a single file (about 360 KB). It loads [pdf.js](https://mozilla.github.io/pdf.js/) from jsDelivr the first time a PDF is opened, pinned to the installed version by an import map with integrity hashes; the regular build serves its own copy of pdf.js and loads it only when a PDF is opened. Both builds load pdfmake from jsDelivr (with a subresource integrity check) when a PDF is first saved.

### GitHub Pages

`.github/workflows/pages.yml` builds and deploys the site on every push to `main`, served from the repository's path (`PAGES_BASE_PATH` sets the site's base path at build time). Turn it on once under *Settings › Pages › Build and deployment › Source: GitHub Actions*.

## Tests

```sh
npm test            # unit tests (Vitest + jsdom)
npm run test:e2e    # browser tests (Playwright + Chromium)
npm run typecheck
```

The Word tests merge real `.docx` fixtures in both directions. They check every result for structural problems Word is strict about: relationships, content types, unique drawing ids, numbering order, and comment and footnote references. They then open the file with [python-docx](https://python-docx.readthedocs.io/) (`pip install python-docx`) and, when it is installed, convert it with LibreOffice.

The OpenDocument tests do the same for `.odt` files (manifest, stored `mimetype` entry, style references, unique names) and open every result with LibreOffice. The PDF, RTF, `.doc` and EPUB readers are checked against the Word originals they were converted from: apart from what a format can't carry, they must read the same. Saved PDFs are made with pdfmake's Node build and read back with the PDF reader, and the browser test checks that pictures are embedded intact.

Fixtures are generated by `python3 scripts/make_fixtures.py`, which also runs `scripts/convert_fixtures.py` to convert them with LibreOffice into the other formats. `python3 scripts/make_large_fixture.py tests/fixtures/out` generates two 3,000-paragraph documents for the opt-in benchmark in `tests/unit/perf.bench.test.ts`.

## How it works

```
src/
  app/             Next.js pages: the landing page, /compare, /compare/new and /compare/sample
  components/      the site's React components; workspace.tsx runs the app in ui/
  lib/handoff.ts   carries the chosen files and documents from page to page
  core/            format-neutral model and algorithms
    model.ts       blocks (paragraphs, tables), spans, formatting
    tokens.ts      tokenizer, normalization, block signatures
    myers.ts       linear-space Myers diff
    align.ts       pairs similar paragraphs inside a change
    inline.ts      word-level diff with semantic cleanup
    compare.ts     aligned rows, table row diffs, hunks, stats
    merge.ts       applies a selection of changes in one direction
  formats/
    load.ts        recognizes files by content and picks a reader
    extensions.ts  the file extensions pickers offer, and which of them are the same kind of file
    export.ts      the formats each document can be saved in
    docx/          .docx reader, writer and merge backend
    odt/           OpenDocument reader, writer and merge backend
    rtf/           RTF reader and writer
    doc/           Word 97–2003 reader (compound file + Word binary format)
    pdf/           PDF reader (pdf.js + structure tags or layout analysis) and writer (pdfmake)
    epub/          EPUB reader
    html/          pasted/HTML reader, HTML/Markdown/text export
    text/          Markdown, plain-text, CSV/TSV readers and writers
  ui/              the workspace: app shell, aligned grid, rendering, the overview
                   (ruler and minimaps), the list of changes, tooltips and themes
```

- **Comparison.** Each paragraph gets a signature from its style and tokens, and the two paragraph sequences are diffed with Myers' algorithm. Within each changed region, a small dynamic program pairs up paragraphs whose words overlap enough. Paired paragraphs are then diffed word by word. The cleanup step folds short common stretches into a single edit, so a rewritten phrase reads as one change.
- **Merging.** A merge rebuilds the target's block list from the aligned rows. Paragraphs the comparison ignores, such as empty lines and bookmarks, stay where they are.
- **Word files.** Word documents keep their original XML. Copying a paragraph imports its XML into the other package and remaps relationship ids, media, styles (matched by name), numbering (so lists continue), footnotes, drawing ids and namespaces. A word-level copy rebuilds just that paragraph from pieces of both originals, keeping each piece's run formatting.
- **OpenDocument files** work the same way: copied paragraphs are imported with their automatic and named styles, list styles, fonts and pictures, list numbering continues across copied items, and names that must be unique (tables, frames, sections, notes) are renewed.
- **PDFs** are read with pdf.js. With structure tags, the tag tree gives paragraphs, headings, lists, tables, notes and the table of contents directly. Without them, text runs are grouped into lines and paragraphs by baseline, spacing, indentation and font size; list markers, table columns, footnotes and running headers and footers are detected from the layout.
- **Saving a PDF** turns the document into a pdfmake layout: list labels are written out as text so the numbering is the document's own, tables keep merged cells and header rows, and footnotes become numbered notes. The document is laid out twice: once to learn the page each heading and page field lands on, then again with those numbers filled in.
