import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { initPrefs } from './store/prefs';
import { installTooltips } from './ui/tooltip';
import { startKeyboardTracking } from './lib/keyboardInset';
import { initLang } from './lib/i18n';
import './index.css';

// The static demo answers its own /api from an in-memory vault. Installed
// before anything renders, so no request can be made before the backend
// exists. `__DEMO__` is false in every normal build, and the import is
// dynamic so the demo code is not in the app's bundle at all.
if (typeof __DEMO__ !== 'undefined' && __DEMO__) {
  const { installDemoBackend } = await import('./demo/server.ts');
  await installDemoBackend();
}

initTheme();
watchSystemTheme();
initPrefs();
initLang();

// PWA shell: production only — a worker in dev would fight Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

// iOS zooms the whole page when a focused field's font is under 16px;
// capping maximum-scale disables exactly that auto-zoom (iOS ignores the
// cap for user pinch gestures, so accessibility zoom keeps working).
// Applied only on iOS — Android neither auto-zooms nor ignores the cap.
const iOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (iOS) {
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
    );
}

// The keyboard is measured on every platform that has one, and the app
// shell ends where it begins — see startKeyboardTracking.
startKeyboardTracking();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
installTooltips(container);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Take the launch screen down, but not before it has been seen.
 *
 * index.html draws it; this removes it. A warm launch mounts in a
 * hundred milliseconds or so, and a screen that appears and vanishes
 * inside that reads as a flicker rather than as a launch — so it stays
 * for BOOT_MIN_MS from the moment the document started, then fades.
 *
 * It does not hold the app back: the app is already mounted and painting
 * underneath, and the screen stops taking presses the instant the fade
 * begins. The only thing being waited for is the look of the thing.
 */
const BOOT_MIN_MS = 900;
const boot = document.getElementById('boot');
if (boot) {
  const shown = Math.max(0, BOOT_MIN_MS - performance.now());
  setTimeout(() => {
    boot.classList.add('done');
    boot.addEventListener('transitionend', () => boot.remove(), { once: true });
    // A transition that never runs (reduced motion, a backgrounded tab)
    // must not leave the screen on top of the app for ever.
    setTimeout(() => boot.remove(), 600);
  }, shown);
}
