import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { initPrefs } from './store/prefs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { startKeyboardTracking } from './lib/keyboardInset';
import { startPixelGridTracking } from './board/pixelGrid';
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

// The viewport is whatever index.html says and nothing rewrites it. iOS
// auto-zoom is declined where it is caused instead — components/ui/input gives its
// fields a 16px font on a coarse pointer — so there is no maximum-scale
// cap for an audit to read as "this page disables zooming", and no user
// agent sniffing to keep correct as devices change.

// The keyboard is measured on every platform that has one, and the app
// shell ends where it begins — see startKeyboardTracking.
startKeyboardTracking();

// And the board's box is measured in whole squares, so that it is the board
// you can see and the panels beside it can line up with it — see
// board/pixelGrid. Before the first render: the value is a fallback away
// from correct, but a board drawn without it would resize on the next frame.
startPixelGridTracking();

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');

// One tooltip provider for the app: the delay, and the skip-delay that
// lets a pointer sweep along a toolbar without waiting at each button.
createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      {/* The one toaster: the undo offer (hooks/use-undoable) posts into it. */}
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
