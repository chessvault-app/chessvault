import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { initPrefs } from './store/prefs';
import { installTooltips } from './ui/tooltip';
import { startKeyboardTracking } from './lib/keyboardInset';
import { initLang } from './lib/i18n';
import { sweepStorage } from './lib/storageSweep';
import { hydrateTraining } from './lib/training';
import './index.css';

// The static demo answers its own /api from an in-memory vault. Installed
// before anything renders, so no request can be made before the backend
// exists. `__DEMO__` is false in every normal build, and the import is
// dynamic so the demo code is not in the app's bundle at all.
if (typeof __DEMO__ !== 'undefined' && __DEMO__) {
  const { installDemoBackend } = await import('./demo/server.ts');
  await installDemoBackend();
}

// Before anything reads storage at module scope — see lib/storageSweep.
sweepStorage();

initTheme();
watchSystemTheme();
initPrefs();
// NOT awaited, unlike the three above. Those decide the first paint, so
// the frame waits for them; the difficulty word does not — the echo in
// localStorage already draws it, and this only replaces that with the
// vault's answer, which subscribers re-render for when it lands.
void hydrateTraining();
// Awaited: the saved language's dictionary loads lazily now, and the
// first render must not happen before it (English pays nothing — its
// dictionary is the keys themselves).
await initLang();

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
