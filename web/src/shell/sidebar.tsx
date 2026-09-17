import {
  BarChart3,
  BookMarked,
  Database,
  Folder,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquareMousePointer,
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { navigate, sectionHref, type Section } from '@/lib/router';
import { BrandMark, Wordmark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { TitleTip } from '@/components/title-tip';
import { t } from '@/lib/i18n';
import { useMediaQuery, useWorkspaceViewport } from '@/lib/media';
import { hasTitleBar } from '@/components/title-bar';
import { foldedFrom, useSidebar } from '@/store/sidebar';
import { warmSection } from '@/shell/routes';
import { NAV, TOOLS_SUBNAV, inTools, openSection } from '@/shell/shared';
import { ConnectionLabel, VaultLabel } from '@/shell/vault-label';

/** Sub-entries under Puzzles. Failed-review deliberately has no entry —
    the dashboard and the trainer already link it where it's relevant. */
const PUZZLE_SUBNAV = [
  { param: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  // "Puzzle books", not "Books": the library of PDFs is Books, a section
  // of its own, and this is the shelf of puzzles read out of them.
  { param: 'books', label: 'Puzzle books', icon: BookMarked },
  { param: 'themes', label: 'Themes', icon: LayoutGrid },
] as const;

/**
 * A sidebar destination, as a real link.
 *
 * These were all `<button onClick={navigate}>`, which works for a click and
 * for nothing else: no middle-click, no ctrl/cmd-click, no open-in-new-tab,
 * no copy-link — on a self-hosted workbench where having the board in one
 * window and notes in another is an obvious way to work, and where the hash
 * router already supported it. `aria-current` was correct throughout; the
 * markup simply withheld the capability.
 *
 * A plain left click is still ours, so `navigate()` still runs and the
 * leave guard still gets to ask before an unsaved document disappears.
 * Everything the browser has a meaning for — a modifier, the middle button
 * — is handed straight back to it.
 */
function NavLink({
  href,
  onActivate,
  children,
  ...rest
}: {
  href: string;
  onActivate: () => void;
  children: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'children'>) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onActivate();
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * The rail's icon column. Folded, the rail is 68px wide and its rows sit
 * inside p-2, so a row is 52px and its centreline is 26px in. Every row is
 * left-aligned in both states with a left inset that puts its icon's centre
 * on that line: 16.8px for the 18.4px section icons, 19px for the 14px
 * sub-row icons, 22px for the 24px brand mark (that row has no p-2 wrapper,
 * so its line is at 34px). The rows used to be justify-center folded and
 * justify-start px-3 unfolded, which slid every icon 5px on each fold.
 * Unfolded, the label simply goes on being written to the icon's right.
 */
const NAV_ROW =
  'group relative flex h-10 items-center justify-start gap-3 rounded-lg pr-3 pl-[1.05rem] text-base font-medium transition-colors duration-150';

/**
 * A row's label. It stays in the tree folded, so the fold's width change
 * (Sidebar's nav) wipes it rather than popping it, but it also fades over
 * the same 150ms: the rail is 68px and the label starts 55px in, so a
 * clipped label would still show its first letter beside the icon.
 */
const navLabel = (folded: boolean): string =>
  cn('whitespace-nowrap transition-opacity duration-150 ease-out', folded && 'opacity-0');

/** An indented child row under a top-level sidebar entry. */
function SubNavItem({
  label,
  icon: Icon,
  active,
  folded,
  href,
  onClick,
}: {
  label: string;
  icon: typeof Folder;
  active: boolean;
  folded: boolean;
  href: string;
  onClick: () => void;
}) {
  return (
    // The top-level rows' rule: a tip only while folded, since unfolded
    // the label is written beside the icon and a tip would repeat it.
    <TitleTip title={folded ? t(label) : undefined} side="right">
      <NavLink
        href={href}
        onActivate={onClick}
        aria-label={t(label)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 items-center justify-start gap-2.5 rounded-lg pr-3 text-sm font-medium transition-[color,background-color,padding-left] duration-150 ease-out',
          // Folded, the 14px icon sits on the rail's icon column (see
          // NAV_ROW); unfolded it indents under its parent's label.
          folded ? 'pl-[1.1875rem]' : 'pl-[2.35rem]',
          active ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className="glyph shrink-0" />
        <span className={navLabel(folded)}>{t(label)}</span>
      </NavLink>
    </TitleTip>
  );
}

export function Sidebar({ active, params }: { active: Section; params: string[] }) {
  // The workspace row appears only where the workspace can (see the note
  // on TOOLS_SUBNAV). A hook rather than a class: the list is what has to
  // know, the same reason media.ts gives for existing.
  const roomy = useWorkspaceViewport();
  const tools = TOOLS_SUBNAV.filter(({ key }) => key !== 'workspace' || roomy);
  // The fold lives in a store (store/sidebar): the desktop title bar has
  // the same switch, and both must say the same thing.
  const lg = useMediaQuery('(min-width: 64rem)');
  const choice = useSidebar((s) => s.choice);
  const setFolded = useSidebar((s) => s.setFolded);
  const folded = foldedFrom(choice, lg);
  const toggleFold = (): void => setFolded(!folded);
  // Where the chip opens: to the right, off the rail and over the page,
  // so it covers no row beneath — which is what the browser's bubble did,
  // and why the rows carried no tip at all until they could fold.
  const tipSide = 'right';
  // The fold switch sits beside the logo, where the desktop shell's band
  // puts it: at the end of the brand row unfolded, and on the first row
  // of the icon column folded, since the 68px rail has no room for two
  // glyphs on one line. That does drop the rows under it by one row on a
  // fold; the switch used to be a row of its own in both states so that
  // nothing moved, but it then read as a section beneath the mark rather
  // than the sidebar's own control. Under the desktop shell's band the
  // switch is the band's, and a second one here was the same control
  // twice on one screen.
  const foldSwitch = hasTitleBar() ? null : folded ? (
    <TitleTip title={t('Unfold the sidebar')} side={tipSide}>
      <button
        type="button"
        onClick={toggleFold}
        aria-label={t('Unfold the sidebar')}
        className={cn(NAV_ROW, 'text-muted-foreground hover:bg-accent hover:text-foreground')}
      >
        <PanelLeftOpen className="size-[1.15rem] shrink-0" strokeWidth={2} />
      </button>
    </TitleTip>
  ) : (
    <TitleTip title={t('Fold the sidebar')}>
      <button
        type="button"
        onClick={toggleFold}
        aria-label={t('Fold the sidebar')}
        // A 36px square in the brand row's 56px, inset the row's 16px
        // from the right edge so it sits inside the seam like the
        // desktop band's does.
        className="text-muted-foreground hover:bg-accent hover:text-foreground mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
      >
        <PanelLeftClose className="size-[1.15rem]" strokeWidth={2} />
      </button>
    </TitleTip>
  );
  return (
    <nav
      aria-label={t('Sections')}
      className={cn(
        // border-card-ring: the sidebar is a white column on the toned
        // page and its fill is its edge; the line comes back under High
        // contrast, where the page is white (the same rule as a card).
        'bg-card border-card-ring hidden shrink-0 flex-col border-r md:flex',
        // The fold is a 150ms width change, the rows' own colour timing.
        // Labels stay in the tree in both states and the nav clips them,
        // so the narrowing edge wipes them out and the widening edge
        // wipes them in; nothing else moves. The reduced-motion block in
        // index.css flattens this to the instant swap it used to be.
        'overflow-hidden transition-[width] duration-150 ease-out',
        folded ? 'w-[4.25rem]' : 'w-52',
      )}
    >
      {/* The brand row: the Home button, and the fold switch beside it
          while there is room. */}
      <div className="flex h-14 shrink-0 items-center">
        {/* A tip and not the aria-label the rows below take: those repeat
            the label already printed beside their icon, and this one does
            not — the wordmark says whose app this is and the tip says
            where the press goes. */}
        <TitleTip title={t('Home')} side={folded ? tipSide : undefined}>
          <button
            type="button"
            onClick={() => navigate('home')}
            // Left-aligned in both states, with the 24px mark's centre on
            // the rail's icon column (see NAV_ROW), so the mark does not
            // move when the wordmark beside it goes.
            className="hover:bg-accent flex h-14 min-w-0 flex-1 items-center justify-start gap-2.5 pr-4 pl-[1.375rem] text-left transition-colors duration-100"
          >
            {/* Bare, in the text's own ink — the same treatment as the home
                header. The filled tile it used to sit on read as a button
                distinct from the wordmark beside it. */}
            <BrandMark className="size-6 shrink-0" />
            {/* The name the mark alone cannot give. Drawn in both states
                and clipped by the nav when folded, like the row labels,
                so the button keeps its name from its text: a tip does not
                name a button the way `title` once did. Not truncated,
                since an ellipsis would show past the mark on the rail. */}
            <Wordmark className={cn('text-base', navLabel(folded))} />
          </button>
        </TitleTip>
        {!folded && foldSwitch}
      </div>

      {/* The rows scroll; the brand row above and the footer below do not.
          The column used to be one clipped box, and under a laptop height
          (about 709px with the Tools group open, 783px folded, and any
          zoomed page) the footer's Settings and theme switch stood below
          the fold with no way to reach them: no wheel, no scrollbar, and a
          Tab that moved focus to a control the eye could not find.
          overflow-x stays hidden here because the nav's own clip is what
          wipes the labels in and out on a fold, and an auto axis would
          have shown a horizontal bar for the width they keep. `*:shrink-0`
          because a row clips its own label (NAV_ROW is overflow-hidden),
          and a flex item that clips has no content minimum: without it
          the column squeezed sixteen rows into the room instead of
          scrolling them, 36px rows measured at 25 and 20. */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-2 *:shrink-0 [scrollbar-width:thin]">
        {folded && foldSwitch}
        {NAV.map(({ section, label, icon: Icon }) => {
          const isActive = section === active;
          return (
            <Fragment key={section}>
            {/* A tip only while folded. Unfolded, the label is written
                beside the icon, so a tip would repeat what is already on
                screen; the aria-label stays either way, for a screen
                reader and for touch, where no tip ever opens. */}
            <TitleTip title={folded ? t(label) : undefined} side={tipSide}>
            <NavLink
              href={sectionHref(section)}
              onActivate={() => openSection(section, active)}
              // Hover is intent (TanStack Router's default): the chunk
              // starts on the way before the click, where the idle sweep
              // has not reached it yet. A no-op once it is in hand.
              onPointerEnter={() => void warmSection(section)}
              aria-label={t(label)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                NAV_ROW,
                isActive
                  ? // Tonal fill and rail: the fill is the pill the phone's tab
                    // bar draws (bg-nav-pill in index.css), so both navigations
                    // say "you are here" the same way. The outline it wore
                    // read as a chip's, and the tonal fill stands off the dark
                    // sidebar on its own where --muted alone did not.
                    'bg-nav-pill text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {isActive && (
                <span className="bg-primary absolute left-0 h-6 w-[3px] rounded-r-full" />
              )}
              <Icon className="size-[1.15rem] shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              <span className={navLabel(folded)}>{t(label)}</span>
            </NavLink>
            </TitleTip>
            {/* A section's children are drawn by the section, not after the
                whole list. They used to be appended below the NAV loop,
                which only looked right for as long as Puzzles happened to
                be the last entry — adding one after it left Dashboard,
                Books and Themes indented under the newcomer, reading as
                its children. Order in NAV is now free. */}
            {/* Open only while Puzzles is the section: the desktop list
                showed seventeen destinations flat, every sub-list open on
                every page, while the phone chunks the same app into six
                tabs and More. The row itself is the way in. */}
            {section === 'puzzles' &&
              active === 'puzzles' &&
              PUZZLE_SUBNAV.map(({ param, label: sub, icon: SubIcon }) => (
                <SubNavItem
                  key={param}
                  label={sub}
                  icon={SubIcon}
                  folded={folded}
                  active={active === 'puzzles' && params[0] === param}
                  href={sectionHref('puzzles', param)}
                  onClick={() => navigate('puzzles', param)}
                />
              ))}
            </Fragment>
          );
        })}

        {/* Tools: a top-level group whose row points at its first entry.

            Not a wrench: a wrench means REPAIR, which is what it says
            two screens away on the crash card below — one glyph for
            "this broke" and for the Board. Nothing under this row is
            being fixed, and Settings already holds the gear beside it.

            What these four have in common is not an object — Board,
            Editor, Explorer and Repertoire share none — but a stance:
            they are the pages you ACT on, against the collections you
            keep. A pointer on a surface says that, and says it in a
            silhouette nothing else here has. `Shapes` was tried first
            and withdrawn on sight: three small blobs directly under
            Network's three, which is the clustering this whole sweep is
            against. */}
        <TitleTip title={folded ? t('Tools') : undefined} side={tipSide}>
        <NavLink
          href={sectionHref('board')}
          onActivate={() => navigate('board')}
          aria-label={t('Tools')}
          aria-current={inTools(active) ? 'page' : undefined}
          className={cn(
            NAV_ROW,
            inTools(active) ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {inTools(active) && <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />}
          <SquareMousePointer className="size-[1.15rem] shrink-0" strokeWidth={inTools(active) ? 2.4 : 2} />
          <span className={navLabel(folded)}>{t('Tools')}</span>
        </NavLink>
        </TitleTip>
        {/* As above: the five tools unfold under their row only while one
            of them is open. The Tools row lands on the Board. */}
        {inTools(active) &&
          tools.map(({ key, label, icon: Icon, nav, active: isActive }) => (
          <SubNavItem
            key={key}
            label={label}
            icon={Icon}
            folded={folded}
            active={isActive(active, params)}
            href={sectionHref(...nav)}
            onClick={() => navigate(...nav)}
          />
        ))}

        {/* Databases: a top-level row of its own — management, not a tool. */}
        <TitleTip title={folded ? t('Databases') : undefined} side={tipSide}>
        <NavLink
          href={sectionHref('databases')}
          onActivate={() => openSection('databases', active)}
          aria-label={t('Databases')}
          aria-current={active === 'databases' ? 'page' : undefined}
          className={cn(
            NAV_ROW,
            active === 'databases' ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {active === 'databases' && <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />}
          <Database className="size-[1.15rem] shrink-0" strokeWidth={active === 'databases' ? 2.4 : 2} />
          <span className={navLabel(folded)}>{t('Databases')}</span>
        </NavLink>
        </TitleTip>
      </div>

      <div
        className={cn(
          'border-border flex shrink-0 items-center gap-1 border-t p-2',
          folded ? 'flex-col' : 'flex-row justify-between px-3',
        )}
      >
        {!folded && (
          <div className="min-w-0">
            <VaultLabel />
            <ConnectionLabel />
          </div>
        )}
        <div className={cn('flex items-center gap-1', folded ? 'flex-col' : 'flex-row')}>
          {/* A tip at every width, where the rows above take one only
              folded: those print their label beside the icon unfolded and
              this one never does. It also stands next to ThemeToggle, which
              is a Button and has always shown the themed chip — two 36px
              icons, a pixel apart, answering a hover differently. */}
          <TitleTip title={t('Settings')} side={folded ? tipSide : undefined}>
            <NavLink
              href={sectionHref('settings')}
              onActivate={() => openSection('settings', active)}
              aria-label={t('Settings')}
              aria-current={active === 'settings' ? 'page' : undefined}
              className={cn(
                'grid size-9 place-items-center rounded-lg transition-colors duration-100',
                active === 'settings'
                  ? 'bg-muted text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Settings className="size-[1.15rem]" strokeWidth={2} />
            </NavLink>
          </TitleTip>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
