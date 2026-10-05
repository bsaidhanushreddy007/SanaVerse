// Makes the generated Capacitor Android project suitable for an audiobook: background audio permissions + more memory for the voice model.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const path = process.argv[2] || 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(path)) { console.error('Manifest not found: ' + path + ' (run "npx cap add android" first)'); process.exit(1); }
let x = readFileSync(path, 'utf8');
const perms = ['android.permission.INTERNET', 'android.permission.WAKE_LOCK', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'android.permission.POST_NOTIFICATIONS'];
const add = perms.filter(p => !x.includes(`"${p}"`)).map(p => `    <uses-permission android:name="${p}" />\n`).join('');
if (add) x = x.replace('</manifest>', add + '</manifest>');
if (!x.includes('android:largeHeap')) x = x.replace('<application', '<application android:largeHeap="true"');
writeFileSync(path, x); console.log('Patched ' + path);
