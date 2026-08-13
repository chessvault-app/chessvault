import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { initPrefs } from './store/prefs';
import { installTooltips } from './ui/tooltip';
import { startKeyboardTracking } from './lib/keyboardInset';
import { whenFirstPainted } from './lib/firstPaint';
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
 * Take the launch screen down, but not before it has been seen — and not
 * before there is something behind it.
 *
 * index.html draws it; this removes it, on two conditions.
 *
 * BOOT_MIN_MS, because a warm launch mounts in a hundred milliseconds and
 * a screen that appears and vanishes inside that reads as a flicker
 * rather than as a launch.
 *
 * And the first PAGE having painted, because the app's frame paints
 * before its content: every section is a lazy chunk, and the Suspense
 * fallback covering it is blank by design. Waiting on the timer alone
 * handed over to the shell — a sidebar and a bottom nav bar around an
 * empty box — for however long the chunk still had to travel.
 *
 * BOOT_MAX_MS is the backstop. A chunk that never arrives is a problem to
 * see, not one to hide behind a launch screen for ever.
 */
const BOOT_MIN_MS = 900;
const BOOT_MAX_MS = 4000;
const boot = document.getElementById('boot');
if (boot) {
  const seen = new Promise<void>((resolve) =>
    setTimeout(resolve, Math.max(0, BOOT_MIN_MS - performance.now())),
  );
  const ready = Promise.race([
    whenFirstPainted(),
    new Promise<void>((resolve) => setTimeout(resolve, BOOT_MAX_MS)),
  ]);
  /**
   * Gone means gone, in one frame.
   *
   * The element AND the class that suppresses backdrop filters underneath
   * it (see the html.booting rule in index.html), removed together —
   * there is no longer any in-between state for them to disagree during.
   *
   * It faded before, and a fade to transparent is a CROSS-fade: for 260ms
   * the launch screen and the running app were both on screen at once.
   * That was the flicker, on both an iPhone and an iPad, and no amount of
   * getting the timing right could have removed it because it was not a
   * timing problem — it was the transition itself.
   */
  const finish = (): void => {
    boot.remove();
    document.documentElement.classList.remove('booting');
  };
  void Promise.all([seen, ready]).then(finish);
}
