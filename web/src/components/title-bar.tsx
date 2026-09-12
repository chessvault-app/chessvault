import { ArrowLeft, ArrowRight, Bug, Expand, FolderSync, Menu, PanelLeft, Percent, Power, RefreshCw, Search, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { openQuickSwitcher } from '@/components/quick-switcher';
import { Button } from '@/components/ui/button';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { traverse } from '@/lib/router';
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
 * window did not; and, centred on the window, the way into the quick
 * switcher. Ctrl/⌘ K reached it before, and nothing on the screen said
 * so: the one button that opened it was on Home. The band is the one
 * strip that exists on every page at every width, and centring on the
 * window rather than on the page keeps it still when the sidebar folds
 * (VS Code's command centre; Slack's 2023 header). It is a button and
 * not a field, since typing happens in the window it opens.
 *
 * The band is one fill, the sidebar's, from edge to edge. It was two: the
 * sidebar's white over the sidebar and the page's tone over the page,
 * which read as two columns that happened to start at the top. One band
 * with the search on it reads as a top bar with two columns under it,
 * the shape Windows 11 draws (a TitleBar over a NavigationView) and the
 * shape the search wants; the sidebar's seam still starts under it. No
 * rule under the band: the band and the sidebar are one L of card around
 * the toned page, and a line there was a browser's toolbar.
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
      // The band's own fill, which is the card's, not the page's: the
      // caption buttons the OS draws at its right end have to sit on
      // the colour the band is.
      const band = document.getElementById('title-bar');
      const color = toHex(getComputedStyle(band ?? document.body).backgroundColor);
      // The glyphs keep the page's ink: the band's own text is the muted
      // tier, and a caption button is a control, not a caption.
      const symbolColor = toHex(getComputedStyle(document.body).color);
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
        onClick={() => traverse(-1)}
      >
        <ArrowLeft className={icon} />
      </Button>
      <Button
        variant="ghost"
        size={size}
        title={t('Forward')}
        className="[-webkit-app-region:no-drag]"
        disabled={!edges.forward}
        onClick={() => traverse(1)}
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
      className="bg-card text-muted-foreground relative flex shrink-0 items-center"
      style={{ height: shell.height, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* The segment over the sidebar keeps the sidebar's width (App.tsx,
          Sidebar) so the controls stand over the column they belong to.
          Unfolded it holds every control; folded, the rail is 68px and
          holds the fold switch alone, left-aligned the way the rail
          aligns its icons, and the rest sit past the seam. Below md there
          is no sidebar, and no segment. */}
      {md && (
        <div
          className={cn(
            'flex h-full shrink-0 items-center gap-1 self-stretch',
            // 16px, not the band's 14: the switch is a 36px button, so its
            // glyph then centres 34px in, the line the sidebar's row icons
            // sit on below it (NAV_ROW in App.tsx; 11px matched the 29px
            // column those rows had before they were left-aligned).
            // Left-aligned in both states, since the width slides in step
            // with the sidebar and a centred switch would drift with it;
            // the band clips the controls it drops when folded.
            'overflow-hidden pl-4 transition-[width] duration-150 ease-out',
            folded ? 'w-[4.25rem]' : 'w-52',
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
      {/* The way in, centred on the window. 22rem: wide enough to say
          what it opens and to hold the two keycaps, and no wider than the
          back-and-forward cluster beside it justifies (measured against
          28rem, which read as a toolbar). A 28px pill in the 40px band,
          on the muted fill a pressed row takes, so it reads as a button;
          the keycaps take the page's ground because the registry's Kbd
          is itself muted and vanished on the pill. Only where the band
          has the room: under md the band is the controls' alone. */}
      {md && (
        <button
          type="button"
          onClick={openQuickSwitcher}
          className={cn(
            'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            'absolute top-1/2 left-1/2 flex h-7 w-88 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg px-2.5 text-sm',
            'outline-none focus-visible:ring-3 focus-visible:ring-ring',
            '[-webkit-app-region:no-drag]',
          )}
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">{t('Open anything…')}</span>
          <KbdGroup className="ml-auto">
            <Kbd className="bg-background">{shell.platform === 'darwin' ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd className="bg-background">K</Kbd>
          </KbdGroup>
        </button>
      )}
    </div>
  );
}
