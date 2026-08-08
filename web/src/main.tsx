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
  // iOS window-shoves the page when the keyboard would cover a focused
  // field, and reactively pinning the scroll back is visibly jarring.
  // Prevent the shove instead: on focus, scroll the field's own pane so
  // the field sits in the upper third — iOS finds it clear of the
  // keyboard and leaves the window alone. Any shove that still happens
  // is undone only once the keyboard has closed, where it's invisible.
  const scrollPane = (el: HTMLElement | null): HTMLElement | null => {
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  };
  window.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const pane = scrollPane(el);
    if (!pane) return;
    const comfortable = (window.visualViewport?.height ?? window.innerHeight) * 0.3;
    const top = el.getBoundingClientRect().top;
    if (top > comfortable) pane.scrollBy({ top: top - comfortable, behavior: 'smooth' });
  });
  window.visualViewport?.addEventListener('resize', () => {
    const vv = window.visualViewport;
    if (vv && vv.height > window.innerHeight * 0.7 && window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
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
