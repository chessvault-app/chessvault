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

/** Toggle the `.dark` class that every design token hangs off. */
const apply = (resolved: 'light' | 'dark'): void => {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
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
