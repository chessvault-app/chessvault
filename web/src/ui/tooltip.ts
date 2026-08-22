/**
 * App-wide styled tooltips with ZERO call-site changes: one delegated
 * listener promotes existing `title` attributes into a themed tip.
 *
 * While a tip is showing, the element's title moves to data-tip (which
 * suppresses the slow, unthemable native tooltip) and is restored the
 * moment the pointer leaves — so semantics, tests and assistive tech
 * keep seeing the attribute at rest. Hover-capable pointers only: on
 * touch there is no hover, and the native behaviour (nothing) is right.
 */

import { placeNear } from '@/lib/floating';

const DELAY_MS = 400;

export function installTooltips(root: HTMLElement): void {
  if (window.matchMedia('(hover: none)').matches) return;

  let tip: HTMLDivElement | null = null;
  let timer: number | null = null;
  let host: HTMLElement | null = null;

  const hide = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    tip?.remove();
    tip = null;
    if (host?.dataset.tip !== undefined) {
      host.setAttribute('title', host.dataset.tip);
      delete host.dataset.tip;
    }
    host = null;
  };

  const show = (anchor: HTMLElement, text: string): void => {
    // The anchor can vanish before the delay elapses (navigation, list
    // refresh) — a tip for a gone element would just float forever.
    if (!anchor.isConnected) {
      hide();
      return;
    }
    tip = document.createElement('div');
    tip.className = 'app-tooltip';
    tip.textContent = text;
    document.body.appendChild(tip);
    // Centred under the anchor, above it where there is no room, and
    // inside the window either way — the same placement every popover in
    // the app gets, from lib/floating rather than from four lines here.
    // The tip is in the DOM already, so its size is a measurement.
    const t = tip.getBoundingClientRect();
    const at = placeNear(
      anchor.getBoundingClientRect(),
      { width: t.width, height: t.height },
      { side: 'bottom', align: 'center', gap: 6, margin: 4 },
    );
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
  };

  root.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest?.('[title]');
    if (!(target instanceof HTMLElement) || target === host) return;
    const text = target.getAttribute('title');
    hide();
    if (!text) return;
    host = target;
    target.dataset.tip = text;
    target.removeAttribute('title');
    timer = window.setTimeout(() => show(target, text), DELAY_MS);
  });
  root.addEventListener('mouseout', (e) => {
    if (host && !host.contains((e as MouseEvent).relatedTarget as Node)) hide();
  });
  // Clicking usually changes what the tip describes; scrolling moves it;
  // SPA navigation replaces the anchor without ever firing mouseout.
  root.addEventListener('mousedown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('hashchange', hide);
}
