import { ArrowLeft, ArrowRight, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';
import { usePrefs } from '@/store/prefs';
import { foldedFrom, useSidebar } from '@/store/sidebar';
import { useTheme } from '@/store/theme';

/**
 * The desktop shell's title bar: the band the OS used to draw, now the
 * app's own. The shell hides the native bar and keeps only the window
 * controls, drawn by the OS as an overlay in the app's colours (Windows
 * and Linux; on macOS the traffic lights stay where they are and the
 * band starts after them). The band itself is a drag region, so the
 * window still moves by it and a double-click still maximises; each
 * control opts out of the drag.
 *
 * Nothing in a browser or on a phone: the bridge field this reads is
 * put there by the shell alone, and a shell too old to hide its bar
 * does not put it there either, so a new page over an old shell draws
 * no second bar.
 *
 * What it holds is what a window wants at its top and the app had
 * nowhere to put: the application menu, which hid behind Alt; the
 * sidebar's fold, which is the sidebar's own switch as well; and back
 * and forward through the app's history, which a browser gives and a
 * window did not.
 */

/** The shell's window-chrome bridge; absent everywhere but the desktop. */
interface TitleBarBridge {
  platform: 'win32' | 'darwin' | 'linux';
  height: number;
  popupMenu: (x: number, y: number) => Promise<void>;
  setColors: (colors: { color: string; symbolColor: string }) => Promise<void>;
}

const bridge = (): TitleBarBridge | null =>
  (window as unknown as { vaultShell?: { titleBar?: TitleBarBridge } }).vaultShell?.titleBar ?? null;

/**
 * A computed colour as hex, which is what the overlay takes. The
 * stylesheet's colours are oklch, and getComputedStyle hands them back
 * that way (measured: `oklch(1 0 264)` for the light ground); a canvas
 * resolves any CSS colour to its sRGB bytes.
 */
export function toHex(css: string): string | null {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
}

/** Whether the desktop shell draws the app's title bar. */
export const hasTitleBar = (): boolean => bridge() !== null;

/** Where the app's history can go, read from the navigation API. */
function useHistoryEdges(): { back: boolean; forward: boolean } {
  const read = (): { back: boolean; forward: boolean } => {
    const nav = (window as unknown as { navigation?: { canGoBack: boolean; canGoForward: boolean } })
      .navigation;
    return nav ? { back: nav.canGoBack, forward: nav.canGoForward } : { back: true, forward: true };
  };
  const [edges, setEdges] = useState(read);
  useEffect(() => {
    const update = (): void => setEdges(read());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return edges;
}

export function TitleBar() {
  const shell = bridge();
  const lg = useMediaQuery('(min-width: 64rem)');
  const md = useMediaQuery('(min-width: 48rem)');
  const choice = useSidebar((s) => s.choice);
  const setFolded = useSidebar((s) => s.setFolded);
  const folded = foldedFrom(choice, lg);
  const edges = useHistoryEdges();
  // The overlay's controls are drawn by the OS, so the app's ground and
  // ink are sent over whenever they change: the theme, and the scheme
  // Settings → Appearance tints it with. Read from the body once the
  // stylesheet has applied them, as resolved colours, which is what the
  // overlay takes.
  const resolved = useTheme((s) => s.resolved);
  const scheme = usePrefs((s) => s.scheme);
  useEffect(() => {
    if (!shell) return;
    const frame = requestAnimationFrame(() => {
      const cs = getComputedStyle(document.body);
      const color = toHex(cs.backgroundColor);
      const symbolColor = toHex(cs.color);
      if (color && symbolColor) void shell.setColors({ color, symbolColor });
    });
    return () => cancelAnimationFrame(frame);
  }, [shell, resolved, scheme]);
  // The shell's bare strip lands on every load, before this has drawn
  // (desktop/main.mjs, ensureDragStrip); once the band is up the strip
  // would only shadow its buttons' no-drag regions.
  useEffect(() => {
    document.getElementById('title-bar-fallback')?.remove();
  }, [shell]);
  const [title, setTitle] = useState(() => document.title);
  useEffect(() => {
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(() => setTitle(document.title));
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  if (!shell) return null;
  const icon = 'size-4';
  return (
    <div
      // The id is the shell's tell: a page without it gets a bare drag
      // strip from the shell instead (desktop/main.mjs), so a server whose
      // app predates the band still gives the window something to move by.
      id="title-bar"
      className={cn(
        'bg-background text-muted-foreground relative flex shrink-0 items-center gap-0.5 pl-1.5',
        // macOS: the traffic lights sit at the left, in the band.
        shell.platform === 'darwin' && 'pl-20',
      )}
      style={{ height: shell.height, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Menu')}
        className="[-webkit-app-region:no-drag]"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void shell.popupMenu(Math.round(r.left), Math.round(r.bottom));
        }}
      >
        <Menu className={icon} />
      </Button>
      {/* The sidebar exists from md; below it the band has no rail to fold. */}
      {md && (
        <Button
          variant="ghost"
          size="icon-sm"
          title={folded ? t('Unfold the sidebar') : t('Fold the sidebar')}
          className="[-webkit-app-region:no-drag]"
          onClick={() => setFolded(!folded)}
        >
          {folded ? <PanelLeftOpen className={icon} /> : <PanelLeftClose className={icon} />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Back')}
        className="[-webkit-app-region:no-drag]"
        disabled={!edges.back}
        onClick={() => history.back()}
      >
        <ArrowLeft className={icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Forward')}
        className="[-webkit-app-region:no-drag]"
        disabled={!edges.forward}
        onClick={() => history.forward()}
      >
        <ArrowRight className={icon} />
      </Button>
      {/* The window's title, centred on the window as the OS drew it,
          under the controls' band so a long one cannot run into them. */}
      <span className="pointer-events-none absolute inset-x-36 truncate text-center text-xs">
        {title}
      </span>
    </div>
  );
}
