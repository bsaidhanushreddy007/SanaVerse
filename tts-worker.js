/* SanaVerse – neural TTS worker. Runs Kokoro-82M (open-source, Apache-2.0) fully on-device via ONNX Runtime WebAssembly.
   The model is downloaded once from Hugging Face and kept in the browser's Cache API; after that it works offline. */
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts = null;
self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: p => self.postMessage({ type: 'progress', p }) });
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'error', msg: String((err && err.message) || err) }); }
  } else if (m.type === 'gen') {
    try {
      const a = await tts.generate(m.text, { voice: m.voice, speed: 1 });
      self.postMessage({ type: 'audio', id: m.id, pcm: a.audio, sr: a.sampling_rate }, [a.audio.buffer]);
    } catch (err) { self.postMessage({ type: 'genError', id: m.id, msg: String((err && err.message) || err) }); }
  }
};
