import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  /** The theme actually being rendered, after resolving `system`. */
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
  cycle: () => void;
}

const systemPrefersDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolve = (p: ThemePreference): 'light' | 'dark' =>
  p === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : p;

/**
 * Toggle the `.dark` class that every design token hangs off, and let the
 * ground follow it.
 *
 * index.html pins the root's background inline before first paint, so a
 * dark-theme user never sees a white flash. An inline style outranks the
 * stylesheet for the life of the page, though, and nothing ever cleared
 * it: switch the theme in Settings and the body went white while the
 * root stayed near-black, which is the colour iOS overscroll and the
 * standalone viewport's under-reported band show (index.css sets
 * `html { background-color: var(--background) }` for exactly those).
 * Every tinted or High contrast ground drifted the same way. Once the
 * class is set the stylesheet owns the ground, so the pin comes off, and
 * the theme-color metas (media-query only, so they followed the OS, not
 * the choice) take the colour the root actually resolved to.
 */
const apply = (resolved: 'light' | 'dark'): void => {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.removeProperty('background-color');
  const ground = getComputedStyle(root).backgroundColor;
  if (!ground || ground === 'rgba(0, 0, 0, 0)') return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = ground;
  }
};

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: 'system',
      resolved: resolve('system'),
      setPreference: (preference) => {
        const resolved = resolve(preference);
        apply(resolved);
        set({ preference, resolved });
      },
      cycle: () => {
        const order: ThemePreference[] = ['light', 'dark', 'system'];
        const next = order[(order.indexOf(get().preference) + 1) % order.length]!;
        get().setPreference(next);
      },
    }),
    {
      name: 'chess-vault:theme',
      partialize: (s) => ({ preference: s.preference }),
      onRehydrateStorage: () => (state) => {
        // Re-resolve after hydration: the persisted value is the preference, and
        // `system` can mean something different than it did last session.
        if (state) state.setPreference(state.preference);
      },
    },
  ),
);

/** Keep `system` live if the OS theme changes while the app is open. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    const { preference, setPreference } = useTheme.getState();
    if (preference === 'system') setPreference('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * Applied before React mounts so the first paint is already correct — otherwise
 * a dark-theme user gets a white flash on every load.
 */
export function initTheme(): void {
  apply(resolve(useTheme.getState().preference));
}
