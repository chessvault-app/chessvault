import { useSyncExternalStore, type ReactNode } from 'react';
import { PageShell } from '@/components/page-shell';
import { PageHeader } from '@/components/page-header';
import {
  Inert,
  SkeletonBoard,
  SkeletonBookCards,
  SkeletonCards,
  SkeletonDocument,
  SkeletonSubtitle,
} from '@/components/skeletons';
import { SearchInput } from '@/components/text-fields';
import { readShelfLayout, readShelfShape, shelfHasShape } from '@/components/shelf-reservation';
import { parse, type Section } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * What a route draws while its own code is still downloading.
 *
 * The page's own sketch, where the page's own sketch can be drawn from
 * out here (components/skeletons), so the page replaces a placeholder of
 * its own outline instead of rearranging into a different one.
 *
 * It was one generic shape for all fifteen routes — a title and eight
 * one-line rows — and the cost was two layout changes where there should
 * be one: rows, then a board, a grid of cards or a document. Neither
 * change is brief, because a placeholder that has gone up stays
 * MIN_VISIBLE_MS (lib/lazyRoute), so the wrong outline was guaranteed
 * half a second whatever the link did.
 *
 * The reason given for the generic shape was that components/skeletons
 * is a chunk of its own and this file must be in the shell's bundle. The
 * first half is true and the second does not follow: that chunk is IN
 * the launch set. Home is the one eager route and imports a bar from it,
 * and lazyRoute's own slow-load hook is bundled into it, so the file is
 * fetched and evaluated before a tab can be tapped. Measured over the
 * built app, this change moved the launch payload from 973,025 to
 * 976,189 bytes raw and from 329,084 to 329,948 gzipped, across the same
 * 52 chunks: +0.3%, and not one new request.
 *
 * So nothing here is copied any more. The old shape was a hand-copy of
 * SkeletonRows, and it had already drifted: it kept `h-5` on the row's
 * text line where SkeletonRows takes `type-row-box`, the rung added
 * because a hard `h-5` is 4px short below md (index.css names the seven
 * sites it fixed). Two branches, one sweep, one file the sweep did not
 * reach — which is the argument for sharing the component and never its
 * geometry.
 *
 * WHICH PAGES GET A BODY, and why the rest get only a header.
 *
 * A page's sketch can be drawn from here when the sketch IS the page.
 * SkeletonBoard carries BOARD_HELD_SHELL itself, and SkeletonDocument
 * the note's own column, so both stand alone. The three shelves work
 * too, because a shelf's chrome is PageHeader with a search field in it
 * and both are already in the launch set: drawn, the first card lands
 * where the settled shelf puts it, and left out it sat 71px high
 * (measured on the demo at 1280).
 *
 * SkeletonBoard is drawn only for the pages on that same shell — the
 * Board, a study, a collected game, an endgame drill. Its title row
 * carries a document's three controls (the ⋯, Edit, the save state)
 * that the Board and a drill have not, and those vanish in place when
 * the page lands; nothing above or below the row moves, which is the
 * part that matters. The workspace is panes rather than a board and a
 * column, and the editor and the repertoire trainer sit on
 * BOARD_SCROLL_SHELL, so none of the three is this shape and none is
 * guessed at.
 *
 * Settings is the one page whose own outline was LIFTED so both sides
 * can draw it (components/settings-outline). It had two waits and two
 * different pictures — the chunk, then the settings themselves — so a
 * slow start redrew the column twice; now the same outline stands
 * through both. Only the top of it was lifted, because the cards below
 * reach the setting rows, the switch and the Appearance selects, which
 * a probe measured at three extra launch chunks and 4.1 kB gzipped. The
 * top costs one chunk and 2.2 kB, and it is the part that decides
 * whether anything moves.
 *
 * Everywhere else the sketch still sits UNDER chrome the page owns —
 * Games' tab strip and filter rail, the licence page's blurb and chips
 * — and that chrome is real controls in the page's chunk. Reproducing
 * it out here is the hand-copy this file exists to have deleted, and
 * drawing the body without it is a promise the page then breaks: the
 * licence rows came out 145px high that way. So those pages draw their
 * shell and their name, which are known and cost nothing, and leave the
 * body to the page. Lifting one of them is the same measurable trade
 * Settings just made: every module it reaches is launch payload.
 */
export function RouteSkeleton() {
  const { section, params } = parse(useSyncExternalStore(watchHash, readHash, readHash));
  return shapeFor(section, params);
}

/**
 * The address, watched directly rather than through `useRoute`.
 *
 * useRoute is not a second subscriber's hook: it carries the router's
 * navigation bookkeeping, and its handler bails on `next === current`,
 * so whichever copy ran first would move that module variable and the
 * other would never hear about the change again. This wants none of that
 * bookkeeping, only which page is being waited for.
 */
const watchHash = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = (): string => window.location.hash;

/**
 * A page's shell and its name, with nothing under them: what a page
 * whose own outline stays in its chunk draws while that chunk lands.
 *
 * The name is the real words — a page is called what it is called before
 * anything is fetched — and the shell is the page's own width, so the
 * column and the gutters do not move when the page arrives.
 */
function ChromeOnly({
  title,
  width,
  scroll = true,
  className,
}: {
  title: string;
  width: 'narrow' | 'medium' | 'wide' | 'xwide';
  scroll?: boolean;
  className?: string;
}) {
  return (
    <PageShell width={width} scroll={scroll} className={className}>
      <PageHeader title={title} />
    </PageShell>
  );
}

/**
 * A shelf's header while its page downloads: the name, the count line
 * the shelf is about to print, and the search field.
 *
 * The field is the real one, held inert, on the rule the placeholders
 * already follow — a control whose shape is known before the data is is
 * drawn as ITSELF rather than as a grey box of its size (skeletons,
 * `INERT`). ShelfToolbar is PageHeader with this field in its search
 * slot, and both are in the launch set, so this is the toolbar's own
 * geometry rather than an impression of it. What is left out is the row
 * of buttons beside the title (sort, layout, Create), which changes
 * nothing about where the cards start.
 */
function ShelfHeader({
  title,
  search,
  subtitle,
}: {
  title: string;
  /** The field's own placeholder, which is also its label. */
  search: string;
  /** Whether a count line is coming. The studies shelf drops it entirely
      on a vault with no studies, so the stored shape is what knows. */
  subtitle: boolean;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle ? <SkeletonSubtitle /> : undefined}
      search={
        <Inert>
          <SearchInput
            type="text"
            inputSize="sm"
            value=""
            readOnly
            placeholder={search}
            aria-label={search}
            className="min-w-0 flex-1"
          />
        </Inert>
      }
    />
  );
}

/**
 * A document shelf's wait: the cards it held last visit, in the layout
 * it was left in.
 *
 * A shelf whose stored shape says nothing draws NO cards, which is the
 * page's own rule — a vault seen empty settles on an EmptyState, and
 * invented cards would be the jump the other way (StudiesView).
 *
 * Read per render rather than held in state, as SkeletonBoard reads its
 * stored panel height: the wait this stands through cannot change what
 * the last visit recorded.
 */
function ShelfPage({
  title,
  search,
  shelf,
}: {
  title: string;
  search: string;
  shelf: 'studies' | 'notes';
}) {
  const groups = readShelfShape(shelf);
  const has = shelfHasShape(groups);
  return (
    <PageShell width="wide">
      <ShelfHeader title={title} search={search} subtitle={has} />
      {has && (
        <SkeletonCards layout={readShelfLayout(shelf)} groups={groups} cover={shelf === 'studies'} />
      )}
    </PageShell>
  );
}

/** The page each section draws while its chunk is on the wire. The same
    table as App's renderSection, read one step earlier. */
function shapeFor(section: Section, params: string[]): ReactNode {
  switch (section) {
    // The pages built on BOARD_HELD_SHELL, which is the shell
    // SkeletonBoard draws — the constant itself, not a copy of it, so
    // the board lands where the placeholder put it. The workspace
    // (WORKSPACE_SHELL, panes rather than a board and a column) and the
    // two pages on BOARD_SCROLL_SHELL are not that shape, and are left
    // to draw themselves.
    case 'board':
      // Tools > Explorer opens with the explorer docked; the plain board
      // route does not (AnalysisView).
      return <SkeletonBoard explorer={params[0] === 'explorer'} />;
    case 'endgames':
      // A drill is a board; the root is the list of them.
      return params[0] ? (
        <SkeletonBoard />
      ) : (
        <ChromeOnly title={t('Endgame drills')} width="medium" />
      );
    case 'workspace':
    case 'editor':
    case 'repertoire':
      return null;

    // The shelves, and the documents they open. A collected game is a
    // study with player bars; a study made from a game wears them too,
    // and StudyView remembers which documents did — but that record is
    // keyed on a document this has not resolved, so the kind's default
    // stands, exactly as it does there for a document this device has
    // not opened.
    case 'studies':
      return params[0] ? (
        <SkeletonBoard chapters explorer />
      ) : (
        <ShelfPage title={t('Studies')} search={t('Search studies…')} shelf="studies" />
      );
    case 'notes':
      return params[0] ? (
        <SkeletonDocument />
      ) : (
        <ShelfPage title={t('Notes')} search={t('Search notes…')} shelf="notes" />
      );
    case 'books': {
      // One book is the reader, whose shell is not in the launch set.
      if (params[0]) return null;
      const groups = readShelfShape('library');
      return (
        <PageShell width="medium">
          {/* The count line stands whatever the shelf holds here: the
              library prints "n books" from an empty vault too, so its
              own placeholder draws the line unconditionally
              (BooksPage). */}
          <ShelfHeader title={t('Books')} search={t('Search books…')} subtitle />
          {shelfHasShape(groups) && <SkeletonBookCards groups={groups} footer="line" />}
        </PageShell>
      );
    }
    case 'games':
      return params[0] && params[0] !== 'elite' ? (
        <SkeletonBoard players explorer />
      ) : (
        <ChromeOnly
          title={t('Games')}
          width="xwide"
          scroll={false}
          className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
        />
      );

    // Settings is gone from here: it carries its own outline module now
    // (settings/SettingsPage.skeleton), which lib/lazyRoute draws for the
    // chunk wait and the page draws for its own. This branch only ever
    // sees the licences sub-route.
    case 'settings':
      return params[0] === 'licenses' ? <ChromeOnly title={t('Licences')} width="medium" /> : null;
    case 'insights':
      return <ChromeOnly title={t('Insights')} width="medium" />;
    case 'databases':
      return (
        <ChromeOnly
          title={t('Databases')}
          width="medium"
          scroll={false}
          className="h-full min-h-0 pb-4 md:pb-6"
        />
      );
    case 'puzzles':
      return <ChromeOnly title={t('Puzzles')} width="medium" className="h-full gap-2 pb-3" />;

    // The opening map is a canvas, not a page shell, and CanvasShell is
    // not in the launch set; home and More are eager and never wait.
    default:
      return null;
  }
}
