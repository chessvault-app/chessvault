import { useSyncExternalStore } from 'react';

/**
 * Whether this page can be put on the home screen, and how.
 *
 * Chromium fires `beforeinstallprompt` once, early, and only a page that
 * caught it can later call `prompt()`; Settings is a lazy route and
 * mounts long after. So this module listens from main.tsx, at load,
 * and the card reads what it kept. Nothing here sniffs a user agent:
 * a browser that never fires the event (Safari, Firefox) gets the
 * menu instructions instead, which are true on every one of them.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function startInstallTracking(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  // Once installed the prompt is spent, and the card has nothing to offer.
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** True when the page already runs from a home-screen icon or inside the desktop shell. */
export function isInstalled(): boolean {
  if ('vaultShell' in window) return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** The browser's own install prompt, when it offered one; null otherwise. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const ev = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => deferred,
    () => null,
  );
  if (!ev) return null;
  return async () => {
    await ev.prompt();
  };
}
