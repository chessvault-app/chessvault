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

// iOS home-screen launches size the web view short until a scroll settles
// the viewport, leaving the native window's black showing under the page —
// CSS can't paint outside the web view, so this needs JS. Two belts: keep
// --app-h synced to the visual viewport (the shell prefers it over 100dvh),
// and nudge a no-op scroll after launch to force the settle.
const standalone =
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;
if (standalone) {
  const sync = (): void => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  };
  sync();
  window.visualViewport?.addEventListener('resize', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  window.addEventListener('load', () => {
    setTimeout(() => {
      window.scrollTo(0, 1);
      window.scrollTo(0, 0);
      sync();
    }, 60);
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
installTooltips(container);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
