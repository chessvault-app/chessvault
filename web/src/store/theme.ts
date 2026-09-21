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
 * the choice) take the colour the page actually resolved to.
 *
 * That last step used to read the ROOT, and the root is the one element
 * that cannot answer: index.html's inline `html { background-color }` is
 * unlayered, so it outranks index.css's layered `html { background-color:
 * var(--background) }`, and with the pin off the root resolves to the OS
 * scheme's colour rather than the chosen theme's. Measured on the demo,
 * reading the root after a load and after a switch, with reduced motion
 * and without: OS light gives rgb(245, 245, 245) and OS dark
 * rgb(10, 10, 10) under BOTH themes, so the metas carried the OS's answer.
 * The body is a separate read and is correct, so both the launch pin and
 * the metas are written from it now, in rememberGround below.
 */
/**
 * Where index.html's launch script finds the ground the page will settle
 * on, per resolved theme. The script runs before any stylesheet and pins
 * the document's colour so the OS startup image dissolves into the same
 * shade; it used to pin the DEFAULT scheme's colour, which is right only
 * for a neutral scheme at the default contrast. A tinted scheme, High
 * contrast or Follow the board resolve `--background` to something else,
 * and the launch showed the default for a frame before the page's own
 * ground painted over it: one frame lighter, then dark again, on every
 * open of the app on a phone that had chosen a scheme. What the page
 * actually resolves to is stored here whenever it changes, and the next
 * launch pins that.
 *
 * The same read is what the OS chrome is told. Android draws an installed
 * app's status bar and, on the versions that tint it, the navigation band
 * from theme-color, so a stale meta is a strip of the wrong colour along
 * the top and the bottom of the app. Both metas are written, not the one
 * whose media matches: the app's theme can disagree with the OS's, and
 * then the matching meta is the other one. Called from here on a theme
 * change and from prefs.ts on a tint, contrast or board-follow change,
 * which is every way the ground moves.
 */
const GROUND_KEY = 'chess-vault:ground';
export function rememberGround(): void {
  // The body, not the root: the root may still wear the launch pin when
  // the scheme is applied, and reading it back would store the pin. It is
  // also the only element whose colour is the CHOSEN theme's; see apply().
  const ground = getComputedStyle(document.body).backgroundColor;
  if (!ground || ground === 'rgba(0, 0, 0, 0)') return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = ground;
  }
  const resolved = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  try {
    const raw = localStorage.getItem(GROUND_KEY);
    const stored = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    if (stored[resolved] === ground) return;
    localStorage.setItem(GROUND_KEY, JSON.stringify({ ...stored, [resolved]: ground }));
  } catch {
    // Storage blocked: the launch script falls back to the default ground.
  }
}

const apply = (resolved: 'light' | 'dark'): void => {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.removeProperty('background-color');
  // Pins the next launch's ground and paints the OS chrome, both off the
  // body: the root still answers the OS scheme here, whatever was chosen.
  rememberGround();
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
