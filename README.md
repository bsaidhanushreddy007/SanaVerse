# SanaVerse

**Upload a book. Press play. Listen.**

SanaVerse turns a text-based PDF into an audiobook with a natural-sounding neural voice that runs **on your own device**, completely free. Your books, the narration and your listening position never leave your phone.

> **Status:** everything except the real neural model and the physical Android lock screen has been tested automatically (see [What was tested](#what-was-tested)). Please do one real-device test before relying on it (see [First-run checklist](#first-run-checklist)).

## Features

- Add a PDF → text extracted page by page, cleaned, split into chapters/sections
- **Natural neural narration** (Kokoro-82M, open-source) generated on-device, ahead of playback, cached for offline replay
- Audiobook player: play/pause, ±15 s / +30 s, previous/next chapter, seek bar, 0.75×–2× speed (changes instantly, no regeneration), sleep timer (15/30/45/60 min or end of chapter)
- **Background playback**: real `<audio>` playback + Media Session (lock-screen/notification/Bluetooth/headset controls, book + chapter metadata). The Android app adds a native foreground service
- Remembers your exact position; "Continue Reading" on the home screen
- Library with covers, progress bars, continue / restart / delete
- Text view with the current passage highlighted, tap to jump, full-text search
- Bookmarks, chapter list, dark mode (auto or manual), adjustable text size
- "Prepare this chapter" button: generate a chapter's audio now (best while charging) for smooth, offline listening later
- Basic voice fallback (device speech) if the neural voice can't run on your phone
- No accounts, no analytics, no tracking, no server

## Architecture

One codebase, two ways to install:

| | **Installable web app (PWA)** | **Android app (APK)** |
|---|---|---|
| Source | the files in this repo, hosted on GitHub Pages | same files wrapped by [Capacitor](https://capacitorjs.com) |
| Background audio | Chrome keeps playing `<audio>` with the screen off | plus a native foreground service + Android MediaSession ([`@jofr/capacitor-media-session`](https://github.com/jofr/capacitor-media-session)) so Android doesn't suspend the WebView |
| Best for | trying it quickly | daily use, long listening sessions |

```
PDF ─► pdf.js (in browser) ─► clean + chapter detection ─► sentence chunks (~260 chars)
        ─► segments (~1 min, never crossing a chapter) ─► narration prep (abbreviations, numerals, CAPS)
        ─► Kokoro-82M neural TTS (Web Worker, ONNX/WASM) ─► WAV segment ─► cached in IndexedDB
        ─► <audio> element + Media Session ─► speakers / lock screen / headset
```

Files: the web app is the loose files in the repo root: `index.html`, `app.js` (the whole app as ONE plain script), `styles.css`, `tts-worker.js` (voice engine worker), `native.js` (web stub), `sw.js` (offline), `manifest.json` and the icons. `src/` holds the readable source modules (`extract.js` PDF pipeline, `tts.js` voice engine, `player.js` player/cache/media session, `app.js` UI, `storage.js`); `node scripts/bundle.mjs` rebuilds `app.js` from them. Also: `native/entry.js` (Android-only bridge), `scripts/`, `.github/workflows/` (builds), `tests/`.

## Why the TTS is zero-cost, and where it runs

- **Engine:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0 licence), a small open neural voice model, run through [`kokoro-js`](https://github.com/hexgrad/kokoro) / ONNX Runtime WebAssembly.
- **It runs entirely on your device**, inside a Web Worker. There is no API, key, subscription, or per-character charge. Nothing is sent to any server when narrating.
- **One-time download:** on the first Play, SanaVerse asks to download the ~90 MB quantised model from Hugging Face (free). It is stored in the browser's Cache API and reused, so it is **not** downloaded again. After that, narration works offline.
- Speed at playback is changed with the audio element's `playbackRate` (pitch preserved), so changing speed never regenerates audio.
- Honest expectations: this is the best practical free on-device voice, noticeably more natural than basic browser voices, but it is not a studio audiobook narrator. English only for the natural voice (use the Basic voice for other languages).

**Performance reality check:** neural voices need real CPU. A recent phone should generate faster than it plays; an older or low-RAM phone may not. The Listen tab shows "voice speed ×N real time". If it is below your playback speed, use 1× and tap **Prepare this chapter**, or choose the Basic voice. SanaVerse generates ~3 minutes ahead and never makes you wait for the whole book.

## Run it

```
python3 -m http.server 8000      # or: npm run serve
```
Open <http://localhost:8000>. The app is a plain script, so it also starts if you open `index.html` straight from a folder (the service worker/offline mode and the neural-voice worker need a real `https://` or `localhost` address, so use the web address for real use). No build step is needed unless you edit `src/` (then run `node scripts/bundle.mjs`).

## Deploy to GitHub Pages (the web app)

1. Create a GitHub repo and upload the files **at the top level of the repo, next to `index.html`**: `index.html`, `app.js`, `native.js`, `tts-worker.js`, `sw.js`, `styles.css`, `manifest.json` and the four icon files (`icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`). Uploading the whole folder is fine too; keep `.github/` if you want the APK workflow. No subfolders are needed for the web app. If a file is missing, SanaVerse shows a clear "could not start" message instead of a dead screen.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Push to `main`. The *Deploy web app to GitHub Pages* workflow publishes it at `https://<you>.github.io/<repo>/`.

(Alternative with no Actions: Settings → Pages → Deploy from branch → `main` / root.)

## Install on Android

**Option A: PWA (quickest).** Open your Pages URL in **Chrome on Android** → menu → **Install app / Add to Home screen**. Open it from the home screen.

**Option B: APK (recommended for lock-screen reliability).**
1. In your GitHub repo open **Actions → Build Android APK → Run workflow** (or push a tag like `v1.0.0`, which also attaches the APK to a Release).
2. When it finishes, download the **SanaVerse-apk** artifact (`app-debug.apk`), copy it to your phone and open it (allow "install unknown apps" for your file manager/browser).
3. First launch: allow notifications when asked (Android needs this to show lock-screen controls).

Build locally instead (needs Node 20, JDK 17, Android SDK): `npm install && npm run android:add && npm run android:apk`. The APK is a **debug-signed** build, fine for sideloading to your own phone. Publishing to the Play Store would need your own release signing key.

## How to use

1. **+ Add PDF**, pick a book, wait for "Ready to listen."
2. Press **Play**. First time only: choose **Download natural voice** (Wi-Fi recommended).
3. Lock the phone. Control playback from the lock screen / headphones.
4. Come back later → **Continue**.

## How PDF processing works

PDF.js reads each page in the browser. SanaVerse groups text into lines and paragraphs (position and font size), removes page numbers and headers/footers that repeat across pages, repairs hyphenated line breaks (keeping real compounds like *well-known*), ligatures and stray characters, joins paragraphs split across pages, and detects chapters from headings ("Chapter 3", "Prologue", unusually large text). If no reliable chapters exist it creates "Section 1, 2, 3…" instead of inventing names. Before narration, a prep step expands abbreviations (Dr. → Doctor), reads Roman-numeral chapter numbers, removes footnote markers/URLs and turns SHOUTED HEADINGS into normal case, while the on-screen text stays exactly as extracted. Cleanup is heuristic: unusual layouts (multi-column, tables) may keep a stray header or read in an odd order.

## How things are stored (all on your device)

| What | Where |
|---|---|
| Extracted book text, covers | IndexedDB |
| Generated narration (WAV segments) | IndexedDB, with an LRU size limit (Settings, default 500 MB) |
| Voice model | Browser Cache API (`transformers-cache`) |
| Progress (chunk + position within it), bookmarks, settings | localStorage |

Progress is saved every few seconds while playing, on every pause, and when the app is hidden. The original PDF is not kept. Deleting a book removes its text and audio; *Settings* can clear generated audio, remove the voice model, or delete everything.

## How background playback works

- Narration is a normal `<audio>` element, which browsers allow to continue with the screen off.
- The Media Session API publishes book/chapter metadata and registers play, pause, previous/next chapter, rewind 15 s and forward 30 s, which is what lock screens, notifications and Bluetooth/headset buttons call.
- If the next segment isn't ready yet, a short silent loop keeps the audio session alive instead of letting Android suspend the app.
- In the Android app, `@jofr/capacitor-media-session` adds a native MediaSession and foreground service. `android:largeHeap` and notification/foreground-service permissions are patched in automatically.
- The Basic (device) voice **cannot** play reliably with the screen off: browsers don't treat speech synthesis as media. That's why the neural voice exists.

## Known limitations

- **Scanned/image PDFs are not supported** (no OCR; it would add hundreds of MB and complexity). SanaVerse detects this and says so. Run such books through an OCR tool first.
- Natural voice: English; needs a reasonably modern phone and about 300–500 MB of free RAM; first narration of a chapter takes time (see performance note above).
- Generated audio is stored as uncompressed WAV (~2.9 MB per minute). A 10-hour book is about 1.7 GB if fully generated, so the cache keeps only what's near your position unless you raise the limit.
- Time displays before audio exists are estimates from text length.
- Some phone makers aggressively kill background apps. If audio stops after a long time, set SanaVerse to **Unrestricted/No battery optimisation** in Android settings.
- iPhone: the PWA works in Safari, but iOS gives web apps less reliable background audio and the model is heavy; Android is the target.
- Search matches inside one text chunk; phrases spanning two chunks can be missed.
- Required internet: first-run only (app files, PDF.js, the voice library and the ~90 MB model). Library files load from `cdnjs.cloudflare.com` / `cdn.jsdelivr.net` and the model from `huggingface.co`; your books are never uploaded.

## Privacy

No accounts, no analytics, no tracking, no backend. PDFs are processed locally and are never uploaded. Extracted text is displayed with `textContent` only (never as HTML) and PDFs are opened with script evaluation disabled. The only network requests are the one-time downloads listed above; to remove even those, host the pinned libraries yourself (edit the URLs in `index.html`, `src/extract.js`, `tts-worker.js`, `sw.js`, then run the bundler).

## Copyright

SanaVerse is a personal listening tool. Only add PDFs you have the legal right to use. It has no sharing, export or distribution features, and none will be added.

## What was tested

Automated end-to-end tests (`tests/`, 80+ checks), run in headless Chromium at phone size with real generated PDFs (chaptered book with running headers/page numbers, scanned PDF, corrupt file, non-PDF):

- **Starts however it is opened**: from a web address with an Android-Chrome user agent, from `file://`, and from loose files with no folders; a missing file shows a clear message; old caches are cleaned on update
- Open app; upload; extraction; header/footer/page-number removal; chapter detection; cover; scanned/corrupt/non-PDF errors
- Segmenting, narration generation → WAV → IndexedDB cache → `<audio>` playback, automatic segment-to-segment transitions, read-ahead
- Pause/resume, live speed change, seek back/forward, chapter jumps, progress save, **reload + position restore**, cache reuse after reload
- Bookmarks (add/jump/remove), sleep timer (countdown and end-of-chapter pause), search → jump → play, "Prepare chapter", clear audio, delete book, upload another
- Media Session: metadata, play/pause/next/seek handlers registered and invoked, `playbackState` updates; audio keeps playing when the page is hidden/visible
- The real Web Worker message path with a fake Kokoro module: download-progress UI, "download once" flag, reload without re-prompt, voice-switch cache namespacing, model removal
- Failure paths: voice download fails → friendly message + retry; engine can't start → automatic switch to Basic voice; Basic voice plays through chunks
- PWA: service worker active, manifest + 192/512/maskable icons load, app shell precached, **opens offline**
- Mobile layout screenshots (light and dark)
- Build scripts: web build output, Android manifest patching (idempotent, valid XML), JSON/YAML validity

## What could NOT be tested here (needs a real device)

The sandbox had no internet, no Android SDK and no phone, so these are implemented but **unverified**:

1. **The real Kokoro model** (download, WASM inference, speech quality, speed on your phone). Tests used a stand-in voice engine of the same interface, plus a fake `kokoro-js` module through the real worker. The pinned library URL (`kokoro-js@1.2.1`, `dist/kokoro.web.js`) and API calls follow its documentation but weren't fetched.
2. **The Android APK build** (GitHub Actions workflow, Capacitor 6, `@jofr/capacitor-media-session`, icon generation). If a step fails, the Actions log will say which; the web app is unaffected.
3. **Screen-off / lock-screen playback and headset buttons on real Android hardware**, Bluetooth controls, notification appearance, battery-optimisation behaviour.
4. Installing the PWA through Chrome's real install prompt (its criteria were checked, not the prompt itself).

### First-run checklist

1. Deploy, open on your phone, add a short PDF, press Play, download the voice.
2. Check the Listen tab: voice speed should be above your playback speed (if not, use 1× or "Prepare this chapter").
3. Start playing, **lock the screen for 2–3 minutes**, confirm sound continues and the lock-screen controls work.
4. Switch to another app for a minute and return; reopen the app and check **Continue**.
5. If anything fails, tell me what you saw (and which step) and I'll fix it.
