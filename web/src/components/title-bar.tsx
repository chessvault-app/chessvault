import { ArrowLeft, ArrowRight, Bug, Expand, FolderSync, Menu, PanelLeft, Percent, Power, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ActionMenu, type MenuAction } from '@/components/action-menu';
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
 * nowhere to put: the application menu, which hid behind Alt, drawn as
 * the app's own menu rather than the OS's popup (the OS's face and
 * language, and on Windows one that clipped its descenders); the
 * sidebar's fold, which is the sidebar's own switch as well; and back
 * and forward through the app's history, which a browser gives and a
 * window did not.
 */

/** The shell's window-chrome bridge; absent everywhere but the desktop. */
interface TitleBarBridge {
  platform: 'win32' | 'darwin' | 'linux';
  height: number;
  command: (name: string) => Promise<boolean>;
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
  const [menuOpen, setMenuOpen] = useState(false);
  if (!shell) return null;
  // 36px buttons on a 40px pitch in a 40px band, the spacing Windows 11
  // apps draw their own bars at (measured on the Claude desktop app).
  const size = 'icon-lg';
  const icon = 'size-4';
  // The application menu's verbs, in the app's own menu and language.
  // The shell runs them by name (desktop/main.mjs, `commands`).
  const run = (name: string) => () => void shell.command(name);
  const menu: MenuAction[] = [
    { label: 'Switch vault…', icon: FolderSync, onSelect: run('switch-vault') },
    { label: 'Reload', icon: RefreshCw, onSelect: run('reload') },
    { label: 'Full screen', icon: Expand, onSelect: run('full-screen') },
    { label: 'Zoom in', icon: ZoomIn, onSelect: run('zoom-in') },
    { label: 'Zoom out', icon: ZoomOut, onSelect: run('zoom-out') },
    { label: 'Reset zoom', icon: Percent, onSelect: run('zoom-reset') },
    { label: 'Developer tools', icon: Bug, onSelect: run('dev-tools') },
    { label: 'Quit', icon: Power, danger: true, onSelect: run('quit') },
  ];
  // The application menu, back and forward: one group, drawn wherever
  // the band has room for it.
  const controls = (
    <>
      <ActionMenu title={t('Menu')} actions={menu} open={menuOpen} onOpenChange={setMenuOpen}>
        <Button
          variant="ghost"
          size={size}
          title={t('Menu')}
          className="[-webkit-app-region:no-drag]"
          active={menuOpen}
        >
          <Menu className={icon} />
        </Button>
      </ActionMenu>
      <Button
        variant="ghost"
        size={size}
        title={t('Back')}
        className="[-webkit-app-region:no-drag]"
        disabled={!edges.back}
        onClick={() => history.back()}
      >
        <ArrowLeft className={icon} />
      </Button>
      <Button
        variant="ghost"
        size={size}
        title={t('Forward')}
        className="[-webkit-app-region:no-drag]"
        disabled={!edges.forward}
        onClick={() => history.forward()}
      >
        <ArrowRight className={icon} />
      </Button>
    </>
  );
  return (
    <div
      // The id is the shell's tell: a page without it gets a bare drag
      // strip from the shell instead (desktop/main.mjs), so a server whose
      // app predates the band still gives the window something to move by.
      id="title-bar"
      className="bg-background text-muted-foreground flex shrink-0 items-center"
      style={{ height: shell.height, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* The band over the sidebar is the sidebar's: its ground and its
          right rule, at its width (App.tsx, Sidebar), so the column runs
          to the window's top edge instead of stopping under a strip of
          page ground. Unfolded it holds every control; folded, the rail
          is 68px and holds the fold switch alone, centred the way the
          rail centres its icons, and the rest sit past the seam on the
          page ground. Below md there is no sidebar, and no segment. */}
      {md && (
        <div
          className={cn(
            'bg-card border-border flex h-full shrink-0 items-center gap-1 self-stretch border-r',
            // Unfolded, 11px and not the band's 14: the switch's glyph then
            // centres at the x the sidebar's row icons centre at below it
            // (measured: 29px for both; 14px put it at 32).
            folded ? 'w-[4.25rem] justify-center' : 'w-52 pl-[11px]',
            // macOS: the traffic lights sit at the left, in the band.
            shell.platform === 'darwin' && 'pl-20',
          )}
        >
          <Button
            variant="ghost"
            size={size}
            title={folded ? t('Unfold the sidebar') : t('Fold the sidebar')}
            className="[-webkit-app-region:no-drag]"
            onClick={() => setFolded(!folded)}
          >
            {/* One glyph for both states, no arrow: the tip says which way it
                goes. Drawn as the sidebar's own switch was (App.tsx,
                foldButton), a step over the band's 16px so the outlined
                panel reads as heavy as the solid strokes beside it. */}
            <PanelLeft className="size-[1.15rem]" strokeWidth={2} />
          </Button>
          {!folded && controls}
        </div>
      )}
      {(!md || folded) && (
        <div
          className={cn(
            'flex items-center gap-1 pl-3.5',
            !md && shell.platform === 'darwin' && 'pl-20',
          )}
        >
          {controls}
        </div>
      )}
    </div>
  );
}
