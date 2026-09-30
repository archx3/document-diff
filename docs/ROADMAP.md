# Collate roadmap

What turns Collate from a comparison viewer into something a team reviews with, and pays for.
Tick items as they land.

## Highest value

### 1. Redline export (Word tracked changes)
- [x] Redline plan: the comparison as one document in B's order, with A's removed paragraphs in place (`src/core/redline.ts`)
- [x] Word writer: insertions as `w:ins`, deletions as `w:del`/`w:delText`, paragraph marks, table rows (`src/formats/docx/redline.ts`)
- [x] Formatting-only changes as `w:rPrChange` ("Formatted"), not a deletion plus an insertion
- [x] Built on a copy of B's file when B is a Word file (keeps page setup, headers, styles); deleted text keeps A's formatting
- [x] Works when either side is not a Word file (PDF, text, Google Docs …)
- [x] Toolbar entry: "Download redline (.docx)", with author name
- [x] Review notes exported as Word comments on their words or change
- [x] Reactions exported as comments ("Needs work", "Looks right")
- [x] Moved paragraphs as `w:moveFrom`/`w:moveTo`
- [x] Redline as PDF (for people without Word)
- [x] Tests: unit (plan), Word validity (accept all = B, reject all = A), download from the toolbar
- [x] Each file's own pending tracked changes are accepted first, so the redline shows only A → B
- [ ] Checked by opening the files in Word and LibreOffice (not available where this was built)

### 2. Change report
- [x] Report model: each change with its before/after words, reactions, notes, status
- [x] PDF report and Word report, with a summary table and totals
- [x] Options: only open changes, only changes with notes, include unchanged context
- [x] Cover details: document names, dates, reviewer

### 3. Claude summary of what matters
- [x] "Summarise the changes" in the changes panel: a short list of substantive changes, formatting-only ones left out
- [x] Risk flags: dates, amounts, obligations, parties, defined terms, deleted clauses (worked out in the browser, no Claude needed)
- [x] Each summary item links to its change
- [x] Summary included in the change report

## Next tier

### 4. Accept / reject workflow
- [x] Status per change: open, accepted, rejected (kept with the review marks)
- [x] "Accept" copies nothing by default; option "apply decisions" builds the final document from them
- [x] Filter: open changes only; progress bar in the list of changes
- [x] Keyboard: A / X to accept / reject the current change and go to the next

### 5. Moved-text detection
- [x] Find deleted/inserted paragraphs that match elsewhere (the same, or nearly the same for longer ones)
- [ ] Moved sentences inside paragraphs (long runs of words) — not done
- [x] Show them as moves, linked to each other, not as a removal plus an addition
- [x] Moves in the redline (`w:moveFrom` / `w:moveTo`) and in the report

### 6. More than two versions
- [x] Version stack: load several drafts of one document
- [x] Compare any two; step through consecutive versions
- [x] History of one paragraph across versions

### 7. Sharing (opt-in, private by default)
- [x] Export / import a review file (the comparison and its marks) to hand to a colleague, optionally locked with a password (AES-GCM)
- [ ] End-to-end encrypted share link (the key stays in the URL fragment) — not done: needs a storage service to hold the encrypted file
- [x] Reviewer names on marks

### 8. Integrations
- [x] Open from Google Drive, OneDrive, Dropbox pickers (switched on by the site's keys; tested with stand-ins, not yet against the live services)
- [x] "Compare with an earlier version" from a Drive file's revisions

### 9. Contract checks
- [x] Numbering and cross-reference integrity ("see clause 7.2" that no longer exists)
- [x] Defined terms used after their definition was removed, or defined but not used
- [x] Party names spelled two ways, or renamed in only some places
- [x] Amounts whose words and figures disagree
- [ ] Dates that disagree between the versions — not done

### 10. Installable offline app
- [x] Web app manifest and service worker; works with no connection
- [x] "Open with Collate" file handling on the desktop

## Image comparison

### 11. Images inside documents
- [x] A changed picture opens a comparison view: side by side, swipe (slider), onion skin (opacity), difference
- [x] Difference view: changed pixels highlighted, with a sensitivity control and "% changed"
- [x] Pictures that only moved or were resized recognised as the same picture (compare by content, not bytes)
- [x] Changed pictures listed in the changes panel with thumbnails

### 12. Image files
- [x] Load PNG, JPEG, GIF, WebP, SVG as documents on their own
- [x] Same comparison modes as above, full size, with zoom and pan kept in step
- [x] Changed regions outlined (bounding boxes of differing pixels)
- [x] Export the difference as an image

## Media kinds

### 13. A toolbar and heads for each kind
- [x] Text, image and audio comparisons each get their own toolbar tools (`media/kinds.ts`, `ToolbarFrame`)
- [x] Image tools in the toolbar: modes, swipe/opacity, sensitivity (graduated slider), outlines, stepping through changed areas, zoom, saving the difference
- [x] Column heads by kind: words and paragraphs; pixel size and file size; length, sample rate, channels and file size
- [x] The SettleMe sliders (round-thumb `Slider`, bar-handled `GraduatedRangeSlider`) and an animated segmented control
- [x] Choosing the kind first, then one or two files: landing page, new comparison page, the Replace menu and the empty workspace

### 14. Audio
- [x] Audio files as documents (MP3, WAV, M4A/AAC, Ogg/Opus, FLAC, WebM)
- [x] Waveform, spectrogram and loudness views on one time scale
- [x] Time alignment (dynamic time warping) and differences: changed, only in A, only in B, with bands joining them
- [x] Playback bar: scrubber with differences, previous/next difference, loop, speed, volume, switching A/B at the same moment
- [x] On-device transcription (Whisper tiny through transformers.js, in a worker; `npm run models` serves it offline) and word-by-word transcript comparison
- [ ] Audio differences in the change report and the review file's marks — not done
- [ ] Transcribing a recording to compare it with a document (a script against a reading) — not done

let's add more improvements:
for image comps:
1. there's a bug (not sure if it's a regression) where scrolling or zooming images in side by side mode clips the images
2. a user currently can't set which image is on top and which one is below in the swipe, onion skin, difference modes, let's add a tool to swap with an icon of two stacked cards with the one above having its letter in the card above 

for audio comps:
1. the columns heads look mis-placed. move them to the left of each visualisation (viz) row or track.
    the info in it should be moved too:
    1. frequency + stereo|mono join the current info in the `at-label` in the left and now create a right group in the `at-label` and put the duration file size there
    2. label (A|B), file format and tools (replace, export -icon buttons) in the left arranged in vertical fashion
2. the client side audio transcription can be slow. let's add the option to transcribe on the server side
    and maybe run the transcription with golang(preferably) or rust or c++ for performance and send the transcription back to the client (with explicit consent).


*Let's add audio and image annotation tools

