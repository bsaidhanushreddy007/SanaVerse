/* SanaVerse – PDF text extraction, cleanup, chapter detection and narration prep. Pure logic, no UI. */
export const MAXC = 260;          // max characters per chunk
export const PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
export class AppError extends Error {}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const CH = /^(chapter|part|book|section)\s+(\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const FRONT = /^(prologue|epilogue|preface|foreword|introduction|conclusion|afterword|appendix|acknowledg(e)?ments)\.?$/i;
const isChap = t => t.length < 80 && /^[A-Z0-9]/.test(t) && (CH.test(t) || FRONT.test(t));
const PGNUM = /^\s*(page\s+)?(\d{1,4}|[ivxlc]{1,6})\s*(of\s+\d+)?\s*$/i;
const LIG = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

export function clean(s) {
  return s.replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, c => LIG[c]).replace(/\u00AD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}
export function pageLines(tc) {
  const lines = []; let cur = null, prevEnd = 0;
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform[4], y = it.transform[5], ht = Math.abs(it.height) || Math.abs(it.transform[3]) || 10;
    if (!it.str.trim()) { if (it.hasEOL) cur = null; else if (cur && !cur.t.endsWith(' ')) cur.t += ' '; continue; }
    if (!cur || Math.abs(y - cur.y) > ht * 0.5) { cur = { t: '', y, h: ht }; lines.push(cur); prevEnd = x; }
    else if (x - prevEnd > ht * 0.2 && !cur.t.endsWith(' ') && !it.str.startsWith(' ')) cur.t += ' ';
    cur.t += it.str; cur.h = Math.max(cur.h, ht); prevEnd = x + it.width;
    if (it.hasEOL) cur = null;
  }
  return lines.map(l => ({ ...l, t: clean(l.t) })).filter(l => l.t);
}
let HV = new Set(); // hyphenated words seen mid-line in this book (so real compounds keep their hyphen)
function join(a, b) {
  if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) {
    const m = /([A-Za-z]+)-$/.exec(a), w = /^[a-z]+/.exec(b)[0];
    return m && HV.has((m[1] + '-' + w).toLowerCase()) ? a + b : a.slice(0, -1) + b;
  }
  return a + ' ' + b;
}

export function buildBlocks(pages) {
  const n = pages.length;
  HV = new Set(); pages.forEach(p => p.forEach(l => (l.t.match(/[A-Za-z]+(?:-[A-Za-z]+)+/g) || []).forEach(w => HV.add(w.toLowerCase()))));
  if (n >= 4) { // drop repeated running headers/footers and page numbers (only at page edges)
    const key = t => t.toLowerCase().replace(/\d+/g, '#'), cnt = {}, lim = Math.max(3, n * 0.25);
    const edges = p => [...p.slice(0, 2), ...p.slice(-2)];
    pages.forEach(p => new Set(edges(p).map(l => key(l.t))).forEach(k => cnt[k] = (cnt[k] || 0) + 1));
    pages = pages.map(p => p.filter((l, i) => {
      const e = i < 2 || i >= p.length - 2; if (!e) return true;
      if (PGNUM.test(l.t)) return false;
      const c = cnt[key(l.t)] || 0;
      return !(c >= lim && (!isChap(l.t) || c >= n * 0.5));
    }));
  }
  const hs = pages.flat().map(l => l.h).sort((a, b) => a - b), med = hs[hs.length >> 1] || 10;
  const blocks = [];
  for (const p of pages) {
    let prev = null, para = null;
    for (const l of p) {
      const big = l.h > med * 1.4, mid = l.h > med * 1.2, short = l.t.length < 100;
      const lvl = (isChap(l.t) || (big && short)) ? 2
        : ((mid && short) || (l.t.length < 60 && /[A-Z]{4}/.test(l.t) && l.t === l.t.toUpperCase() && !/[.,;:]$/.test(l.t))) ? 1 : 0;
      if (!prev && blocks.length) { // paragraph continuing from previous page
        const b = blocks[blocks.length - 1];
        if (!b.head && !lvl && !/[.!?:"”’)\]…]$/.test(b.t) && /^[a-z]/.test(l.t)) para = b;
      }
      const gap = prev ? prev.y - l.y : 0;
      const cont = para && ((!lvl && !para.head && gap <= l.h * 1.7) ||
        (lvl && para.head === lvl && Math.abs(para.h - l.h) < 0.5 && !isChap(para.t) && gap <= l.h * 1.7));
      if (cont) para.t = join(para.t, l.t); else { para = { t: l.t, head: lvl, h: l.h }; blocks.push(para); }
      prev = l;
    }
  }
  const out = [];
  for (const b of blocks) {
    const p = out[out.length - 1];
    if (p && p.t === b.t) continue; // exact duplicate
    if (p && p.head && b.head && isChap(p.t) && !isChap(b.t) && p.t.length < 22 && !p.merged) { p.t = p.t.replace(/[.:]$/, '') + ': ' + b.t; p.merged = true; continue; }
    out.push(b);
  }
  return out;
}
const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|No|Inc|Ltd|Co|Gen|Col|Capt|Sgt|Rev|Hon)|\b[A-Z]|\be\.g|\bi\.e)\.["”’')\]]*\s*$/;
export function splitText(t) {
  const raw = t.match(/[^.!?…]+(?:[.!?…]+["”’')\]]*\s*|$)/g) || [t], s = [];
  for (const x of raw) { if (s.length && ABBR.test(s[s.length - 1])) s[s.length - 1] += x; else s.push(x); }
  const out = []; let cur = '';
  for (let x of s) {
    x = x.trim(); if (!x) continue;
    while (x.length > MAXC + 40) {
      let k = x.lastIndexOf(', ', MAXC); if (k < 80) k = x.lastIndexOf(' ', MAXC); if (k < 1) k = MAXC;
      const part = x.slice(0, k + 1).trim(); x = x.slice(k + 1).trim();
      if (cur) { out.push(cur); cur = ''; } out.push(part);
    }
    if (cur && cur.length + x.length + 1 > MAXC) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x;
  }
  if (cur) out.push(cur); return out;
}
export function structure(blocks) { // → chunks [[text, flag]] flag: 0 continuation, 1 new paragraph, 2 heading; secs [{title,start}]
  const c2 = blocks.filter(b => b.head === 2).length, c1 = blocks.filter(b => b.head >= 1).length;
  const thr = c2 >= 2 ? 2 : (c1 >= 3 ? 1 : 9);
  const chunks = [], secs = []; let secChars = 0;
  const startSec = t => { secs.push({ title: t, start: chunks.length }); secChars = 0; };
  for (const b of blocks) {
    if (b.head >= thr) { startSec(b.t.slice(0, 90)); chunks.push([b.t, 2]); continue; }
    if (!secs.length) startSec(thr === 9 ? 'Section 1' : 'Opening');
    if (thr === 9 && secChars > 8000) startSec('Section ' + (secs.length + 1));
    let first = 1; for (const c of splitText(b.t)) { chunks.push([c, first]); first = 0; secChars += c.length; }
  }
  return { chunks, secs };
}


/* ---------- narration prep: what the voice actually reads (the on-screen text stays untouched) ---------- */
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
const roman = r => { let n = 0; r = r.toLowerCase(); for (let i = 0; i < r.length; i++) { const v = ROMAN[r[i]], nx = ROMAN[r[i + 1]] || 0; n += v < nx ? -v : v; } return n; };
const ABBREV = [[/\bMr\./g, 'Mister'], [/\bMrs\./g, 'Missus'], [/\bDr\./g, 'Doctor'], [/\bProf\./g, 'Professor'], [/\bvs\./gi, 'versus'], [/\betc\./g, 'et cetera'], [/\be\.g\./gi, 'for example'], [/\bi\.e\./gi, 'that is'], [/\bSt\.(?=\s+[A-Z])/g, 'Saint'], [/\bNo\.(?=\s*\d)/g, 'Number']];
export function prepSpeech(t, flag) {
  let s = t;
  if (flag === 2) s = s.replace(/^(chapter|part|book|section)\s+([ivxlc]+)\b/i, (m, a, r) => /^[ivxlc]+$/i.test(r) ? a + ' ' + roman(r) : m);
  const L = s.replace(/[^A-Za-z]/g, ''), U = L.replace(/[^A-Z]/g, '');
  if (L.length > (flag === 2 ? 3 : 8) && U.length / L.length > 0.6) s = s.toLowerCase().replace(/(^|[\s"“(])([a-z])/g, (m, a, b) => a + b.toUpperCase()); // SHOUTED HEADINGS → Normal Case
  for (const [re, to] of ABBREV) s = s.replace(re, to);
  return s.replace(/\[\d+(?:[,–-]\s*\d+)*\]/g, '').replace(/https?:\/\/\S+/g, 'link').replace(/&/g, ' and ')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

/* ---------- PDF → { meta, chunks, secs } ---------- */
async function coverImage(pdf) {
  try {
    const pg = await pdf.getPage(1), v0 = pg.getViewport({ scale: 1 }), v = pg.getViewport({ scale: 220 / v0.width });
    const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    const u = c.toDataURL('image/jpeg', 0.7); return u.length < 150000 ? u : '';
  } catch { return ''; }
}
const tick = () => new Promise(r => setTimeout(r, 0));
export async function extractPdf(file, onProgress) {
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) throw new AppError('That doesn’t look like a PDF. Please choose a .pdf file.');
  if (!file.size) throw new AppError('That file is empty.');
  if (file.size > 300 * 1024 * 1024) throw new AppError('That PDF is very large (over 300 MB). Please try a smaller file.');
  if (!window.pdfjsLib) throw new AppError('The PDF reader could not load. Connect to the internet once, then try again.');
  onProgress('Reading PDF…', 2);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.js';
  const buf = await file.arrayBuffer(); let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise; }
  catch (e) { throw new AppError(e && e.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password and try again.' : 'This file couldn’t be opened. It may be damaged or not a real PDF.'); }
  const info = await Promise.resolve().then(() => pdf.getMetadata()).then(m => m.info || {}).catch(() => ({}));
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n); pages.push(pageLines(await pg.getTextContent())); pg.cleanup();
    if (n % 5 === 0 || n === pdf.numPages) { onProgress(`Extracting text… page ${n} of ${pdf.numPages}`, 5 + 75 * n / pdf.numPages); await tick(); }
  }
  onProgress('Cleaning text…', 84); await tick();
  const blocks = buildBlocks(pages), chars = blocks.reduce((a, b) => a + b.t.length, 0);
  if (chars < 200 || chars < pdf.numPages * 25) throw new AppError('This PDF appears to contain scanned pages rather than selectable text, so SanaVerse can’t read it aloud. Try a text-based PDF, or run it through an OCR tool first.');
  onProgress('Detecting chapters…', 90); await tick();
  const { chunks, secs } = structure(blocks);
  onProgress('Preparing narration…', 95); const cover = await coverImage(pdf);
  const base = file.name.replace(/\.pdf$/i, '').replace(/_+/g, ' ').trim();
  const meta = { id: uid(), title: clean(info.Title || '') || base || 'Untitled book', author: clean(info.Author || ''), pages: pdf.numPages, chars, cover, created: Date.now() };
  return { meta, text: { id: meta.id, chunks, secs } };
}
