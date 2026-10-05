/* Bundled into www/js/native.js for the Android app only (npm run build:native).
   - @jofr/capacitor-media-session replaces navigator.mediaSession with a native Android MediaSession and runs a foreground
     service, so the WebView keeps playing with the screen off and shows lock-screen / notification / Bluetooth controls.
   - Android 13+ needs the notification permission for that media notification to appear. */
import { Capacitor } from '@capacitor/core';
import '@jofr/capacitor-media-session';
import { LocalNotifications } from '@capacitor/local-notifications';

window.SVNative = {
  isNative: Capacitor.isNativePlatform(),
  async prepare() { // called once, right before the first Play
    try { const p = await LocalNotifications.checkPermissions(); if (p.display !== 'granted') await LocalNotifications.requestPermissions(); } catch {}
  }
};
