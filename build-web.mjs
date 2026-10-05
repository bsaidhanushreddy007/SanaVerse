// Copies the static web app into www/. With --native it also bundles native/entry.js (Capacitor + media-session plugin) over js/native.js.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true }); mkdirSync('www');
for (const f of ['index.html', 'styles.css', 'manifest.json', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) cpSync(f, 'www/' + f);
cpSync('js', 'www/js', { recursive: true });
if (process.argv.includes('--native')) {
  const { build } = await import('esbuild');
  await build({ entryPoints: ['native/entry.js'], bundle: true, format: 'esm', minify: true, outfile: 'www/js/native.js', logLevel: 'info' });
  console.log('Bundled native bridge → www/js/native.js');
}
console.log('Web build ready in www/');
