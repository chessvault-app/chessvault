import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme, watchSystemTheme } from './store/theme';
import { installTooltips } from './ui/tooltip';
import './index.css';

initTheme();
watchSystemTheme();

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
  // Keyboard handling. Scripted scrolling while iOS animates its own
  // keyboard avoidance just fights it (it looked like an earthquake).
  // Instead the shell RESIZES to the visual viewport while the keyboard
  // is up — the layout then fits the visible area, iOS has nothing to
  // shove, and the whole thing reverts when the keyboard closes.
  const vv = window.visualViewport;
  if (vv) {
    const apply = (): void => {
      const keyboardUp = window.innerHeight - vv.height > 120;
      document.documentElement.style.setProperty(
        '--app-h',
        keyboardUp ? `${Math.round(vv.height)}px` : '',
      );
      if (!keyboardUp && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', apply);
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
