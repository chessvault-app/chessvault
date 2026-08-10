import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { initPrefs } from './store/prefs';
import { installTooltips } from './ui/tooltip';
import { initLang } from './lib/i18n';
import './index.css';

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
  // Keyboard handling, after three failed attempts to outsmart it
  // (scroll-pin: visible snap; pane pre-scroll: fought iOS's animation;
  // shell resize: parked the navbar on the keyboard): let iOS do its
  // native shove while typing — Safari does the same on every site —
  // and only put the window back once the keyboard has closed, where
  // the correction is invisible.
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', () => {
      const keyboardUp = window.innerHeight - vv.height > 120;
      if (!keyboardUp && window.scrollY !== 0) window.scrollTo(0, 0);
    });
  }
}

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
installTooltips(container);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
