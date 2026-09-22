/**
 * Which platform's chrome the phone shell draws.
 *
 * One attribute on the root, `data-platform`, decided once before the
 * first render, that the `ios:` and `android:` variants read
 * (styles/variants.css). Everything the app draws differently per
 * platform hangs off this and nothing else: see "Platform-specific
 * design" in docs/design-principles.md for which platform owns which
 * idiom, and why the app draws a second chrome at all since 2026-09-18.
 *
 * This is the one place in the app that reads a user agent. main.tsx
 * used to say nothing did, so there was nothing to keep correct as
 * devices changed; that is now true of everything but this file. The
 * guess is kept cheap to be wrong about: a phone that is misread gets
 * the other platform's chrome, never a page with a control missing,
 * because neither variant removes anything the cross-platform layout has.
 *
 *   ios      an iPhone or iPad. `navigator.platform` still says iPhone
 *            and iPod; an iPad has reported itself as MacIntel since
 *            iPadOS 13 and is told apart by its touch points, which a
 *            Mac has none of.
 *   android  `userAgentData.platform` where a browser has it (Chromium),
 *            the user agent string where it does not (Firefox).
 *   desktop  everything else, the desktop shell included. A browser on
 *            a desktop with a touchscreen is a desktop.
 *
 * `chess-vault:platform` in localStorage overrides the guess. It exists
 * for the screenshot grid, which walks a `phone-ios` state in Chromium,
 * and for the Settings debug card; nothing else reads it and no user
 * setting writes it.
 */
export type Platform = 'ios' | 'android' | 'desktop';

export const PLATFORM_OVERRIDE_KEY = 'chess-vault:platform';

const PLATFORMS: readonly Platform[] = ['ios', 'android', 'desktop'];

/** The narrowest view of `navigator` the guess needs, so a test can hand one in. */
export interface PlatformSignals {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}

export function detectPlatform(nav: PlatformSignals): Platform {
  const platform = nav.platform ?? '';
  if (/^(iPhone|iPod|iPad)/.test(platform)) return 'ios';
  if (/^Mac/.test(platform) && (nav.maxTouchPoints ?? 0) > 1) return 'ios';
  const data = nav.userAgentData?.platform;
  if (data !== undefined) return data === 'Android' ? 'android' : 'desktop';
  if (/\bAndroid\b/.test(nav.userAgent ?? '')) return 'android';
  return 'desktop';
}

function readOverride(): Platform | null {
  try {
    const raw = localStorage.getItem(PLATFORM_OVERRIDE_KEY);
    return raw && (PLATFORMS as readonly string[]).includes(raw) ? (raw as Platform) : null;
  } catch {
    return null;
  }
}

/** Decide once and write the root attribute. Called from main.tsx before the first render. */
export function startPlatform(): Platform {
  const platform = readOverride() ?? detectPlatform(navigator as PlatformSignals);
  document.documentElement.dataset.platform = platform;
  return platform;
}

/**
 * The glass surfaces live on `data-glass` and two custom properties, all
 * three written by `store/prefs.ts` from Settings > Appearance, because
 * they are per-device display preferences like every other knob on that
 * card. This file used to own a `chess-vault:glass` kill switch for the
 * on-device frame probe, added because a home-screen app has no console to
 * type a key into; the Glass knob at its bottom stop does the same thing,
 * in every build rather than only a CHESS_LAG one.
 */

/**
 * The desktop shell's window material, as one attribute on the root.
 *
 * `data-window-material="mica"` or `"vibrancy"` says the OS is painting
 * a material behind this window, and the only thing the app does about
 * it is let `--window-ground` go transparent (styles/tokens.css), so
 * the material is what shows where the page's ground was. Absent
 * everywhere else: a browser, Linux, Windows 10, the demo, and a
 * desktop window whose owner has left the Settings switch off. Asked
 * for over the shell bridge rather than guessed, because whether the
 * OS actually has the material is the main process's answer.
 *
 * Deliberately NOT awaited before the first render, unlike
 * `startPlatform`: the page's opening frames wear index.html's inline
 * opaque ground either way, which is the whole reason a transparent
 * window can open without the white or black flash coming back.
 */
interface MaterialBridge {
  material?: () => Promise<{ supported: boolean; enabled: boolean; kind: string } | undefined>;
}

export async function startWindowMaterial(): Promise<void> {
  const bridge = (window as unknown as { vaultShell?: { titleBar?: MaterialBridge } }).vaultShell
    ?.titleBar;
  if (!bridge?.material) return;
  try {
    const state = await bridge.material();
    if (state?.enabled && (state.kind === 'mica' || state.kind === 'vibrancy')) {
      document.documentElement.dataset.windowMaterial = state.kind;
      return;
    }
  } catch {
    // An older shell, or a handler that refused: no material, no attribute.
  }
  delete document.documentElement.dataset.windowMaterial;
}

/** What the root says. Read, not recomputed, so the whole app agrees with the stylesheet. */
export function currentPlatform(): Platform {
  const on = document.documentElement.dataset.platform;
  return on && (PLATFORMS as readonly string[]).includes(on) ? (on as Platform) : 'desktop';
}
