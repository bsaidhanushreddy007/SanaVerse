# SanaVerse

**Upload a book. Press play. Listen.**

SanaVerse turns a text-based PDF book into a simple audiobook-style player. It runs entirely in your browser: your books are never uploaded anywhere.

## Features

- Add a PDF, and SanaVerse extracts and cleans the text, finds chapters, and reads it aloud
- Play, pause, rewind 15s, forward 30s, previous/next chapter, seek slider
- Speeds: 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2× (changeable while listening)
- Remembers exactly where you stopped; "Continue Reading" on the home screen
- Personal library with progress bars, restart and delete
- Text view with the current passage highlighted, tap any sentence to listen from there
- Search inside a book, tap a result to jump and listen
- Chapter list, bookmarks, sleep timer (15/30/45/60 min or end of chapter)
- Light and dark themes (follows your device, or choose), adjustable text size, voice choice
- Installable as an app on phones (PWA) and works offline after the first visit

## Run locally

Browsers need a web server for service workers and modules, so don't just double-click `index.html`. From this folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (Any static server works, e.g. `npx serve`.)

## Deploy to GitHub Pages

1. Create a new GitHub repository and upload **all files in this folder** (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.json`, `icon.svg`, `README.md`) to the repository root.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select the `main` branch and the `/ (root)` folder, then **Save**.
4. After a minute your app is live at `https://<your-username>.github.io/<repo-name>/`.

All file paths are relative, so it works from a sub-path like that. Any other static host (Netlify, Cloudflare Pages, etc.) works too. HTTPS is required for installing as an app, and GitHub Pages provides it.

## How to use

1. Tap **+ Add PDF** and choose a book. Wait for "Ready to listen."
2. Press **Play**. Use the buttons at the bottom to pause, skip, or change chapters.
3. Use the **Listen** tab for speed, sleep timer and bookmarks; **Text** to read along and search; **Chapters** to jump around; **Bookmarks** to return to saved spots.
4. Close the app any time. Next time, tap **Continue**.

## Browser and device requirements

Any recent Chrome, Edge, Safari (iOS 14.5+), or Firefox. SanaVerse uses your device's built-in voices through the Web Speech API. Voices differ by device: Chrome on Android and Safari on iPhone usually sound good, desktop voices vary. Choose a voice in **Settings**.

## How PDF text extraction works

The PDF is opened in your browser with [PDF.js](https://mozilla.github.io/pdf.js/) and read page by page. For each page, SanaVerse:

- groups text into lines and paragraphs using position and font size
- removes page numbers and headers/footers that repeat across pages
- repairs line-break hyphenation, ligatures, stray control characters and duplicated lines
- joins paragraphs that continue across a page break
- detects chapters from heading patterns ("Chapter 3", "Prologue"…) and unusually large text; if no reliable chapters are found it simply creates "Section 1, 2, 3…" rather than inventing names
- splits the text into sentence-sized chunks (about 260 characters) for the speech engine

Cleanup is heuristic. It works best on normal, single-column books and may occasionally keep a header or merge a heading with text on unusual layouts.

## How speech works

The app speaks one chunk at a time with the browser's `speechSynthesis`, and starts the next chunk the moment one finishes. Short chunks avoid the cut-offs some browsers have with long text. If the engine errors or stalls, SanaVerse retries and, if it keeps failing, stops with a clear message. **Pause** stops speech and **Play** resumes from the beginning of the current sentence chunk.

## Privacy

- No accounts, no analytics, no tracking, no server of ours
- The PDF is read locally. Only the extracted text is stored, in your browser's IndexedDB; progress, bookmarks and settings are in localStorage
- The only network request is loading the PDF.js library from cdnjs on first use (it is then cached for offline use). To remove even that, download `pdf.min.js` and `pdf.worker.min.js` (version 3.11.174) into the repo and change the paths in `index.html`, `app.js` (`PDF_CDN`) and `sw.js`
- Deleting a book, or **Settings → Delete all books and data**, removes it from the device. Clearing your browser's site data does too

## Known limitations

- **Scanned/image PDFs are not supported.** SanaVerse has no OCR. If a PDF has no selectable text it tells you so. Run it through an OCR tool first, then add it again.
- **Password-protected PDFs** must be unlocked first.
- **Browser speech limits:** voices and quality depend on your device. Many phones pause speech when the screen locks or the browser goes to the background, so keep the screen on for long listening sessions (SanaVerse requests a screen wake lock while playing where supported). Speech also can't be captured as an audio file.
- Time displays are estimates, since the browser does not report exact audio length. Bookmark times are shown at 1× speed.
- Search finds text within a single sentence chunk, so a phrase split across two chunks may be missed.
- Browsers can limit storage. Text is small (a typical book is 1–3 MB), but if storage is full SanaVerse shows a message. Very large PDFs (over 300 MB) are rejected.
- Only the extracted text is kept, not the original PDF, so page images and formatting are not preserved.

## Copyright

SanaVerse is a personal reading tool. Only add PDFs you have the right to use. It has no sharing, exporting or distribution features.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App structure |
| `styles.css` | Styling and light/dark themes |
| `app.js` | PDF processing, speech player, library, progress |
| `sw.js` | Offline support |
| `manifest.json`, `icon.svg` | Install-as-app support |
