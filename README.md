# SanaVerse tests

End-to-end tests that drive the real app in headless Chromium (Playwright), using real PDFs.

```
pip install playwright reportlab pillow && playwright install chromium
npm install                      # provides pdfjs-dist for the tests (or set PDFJS_DIST=/path/to/pdfjs-dist/build)
cd tests && python3 mkpdf.py     # makes book.pdf, scanned.pdf, notpdf.* fixtures
python3 run_mock.py              # full journey: import → narration → playback → seek → bookmarks → sleep → reload → media session → delete
python3 run_worker.py            # real Web Worker plumbing with a fake Kokoro module: download progress, caching flag, fallbacks
python3 run_pwa.py               # service worker, manifest, icons, offline start
```

`run_mock.py` uses `?engine=mock` (a stand-in voice that returns tones of realistic length) so the *player* is tested for real
(WAV blobs, `<audio>` playback, segment transitions, caching in IndexedDB, Media Session handlers) without downloading the 90 MB model.
The neural model itself and Android lock-screen behaviour can only be verified on a real device (see README).
