import { cn } from '@/lib/utils';
import { VAULT_ICONS, VAULT_ROWS, VaultNote, VaultPath, type VaultKind } from '@/components/vault-tree';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { Loading } from './primitives';

/**
 * The Vault card's listing: the folder line, the ruled rows under it, and
 * the sentence that closes the box (components/vault-tree).
 *
 * It waits on /api/storage, which walks the whole vault, so on a vault of
 * books it is the slowest thing on the Settings page and the card used to
 * grow by the height of the box the moment it answered, pushing the
 * download and reveal buttons down with it.
 *
 * It borrows `.vault-tree` itself rather than approximating the geometry:
 * the rows, the ruler and the container query are that class's, so the
 * placeholder cannot drift from the listing when either moves, and the
 * only numbers here are which bar goes where.
 *
 * Two of its parts are not drawn at all but printed: the path, which the
 * page knows from its settings before it asks what the vault weighs, and
 * the closing sentence, which is the same sentence for every vault. A bar
 * over either would be standing in for something already in hand, and
 * printing them is also what makes the box's height exact rather than
 * measured (`VaultPath` and `VaultNote`, components/vault-tree).
 *
 * This box IS bg-muted, which the Skeleton's fill was for a while: the
 * bars in it drew grey on the identical grey and nothing appeared at all.
 * The fill is accent now, the rung above the well, so the bars need no
 * override of their own.
 */
export function SkeletonVaultTree({
  path,
  rows = 8,
  paths,
  className,
}: {
  /**
   * Where the folder is, as the listing itself takes it: null is the
   * demo's wording, and undefined is a path the settings answer has not
   * brought yet, drawn as a bar the width of one.
   */
  path?: string | null;
  /**
   * Eight, which is what a vault in use lists: the ten rows the card can
   * draw (components/vault-tree `VAULT_ROWS`) less the two book folders,
   * which exist only once a PDF has been imported. Empty rows are
   * dropped, so a fresh vault lists fewer and a reading one all ten; the
   * caller can say so where it knows better. Only consulted where
   * `paths` is absent.
   */
  rows?: number;
  /**
   * The rows this vault listed last visit, by path. A count alone takes
   * the FIRST n, and the rows that go missing are not the last ones: a
   * vault with no books drops `books` and `puzzlebooks` from the middle
   * and still lists `.history.git` and `config.json` at the end. Since
   * each row reserves its own gloss, and the glosses wrap differently,
   * the wrong eight reserved the wrong words.
   */
  paths?: readonly string[];
  className?: string;
}) {
  const listed = paths ? VAULT_ROWS.filter((r) => paths.includes(r.path)) : VAULT_ROWS.slice(0, rows);
  return (
    <Loading className={cn('vault-tree bg-muted rounded-lg px-3.5 pt-3 pb-3.5', className)}>
      {/* The folder line: the real path, and a bar where the totals go,
          on the 20px line box of the text-sm they will be. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        {path === undefined ? (
          <div className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-56" />
          </div>
        ) : (
          <VaultPath path={path} />
        )}
        <div className="flex h-5 items-center">
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <ul>
        {listed.map((row, i) => (
          <li key={i}>
            {/* Every cell is centred rather than left to the row's baseline
                alignment: a bar has no text, so its baseline is its own
                bottom edge, and three bars of three heights pushed the row
                a pixel taller than the row of text it stands for. */}
            {/* The row's own icon: VAULT_ROWS says what kind each row is,
                so the glyph is known before the sizes are. */}
            <span className="icon text-muted-foreground">
              <VaultRowIcon kind={row.kind} />
            </span>
            <div className="path flex h-5 items-center self-center">
              <Skeleton className={cn('h-2.5', PATH_WIDTHS[i % PATH_WIDTHS.length])} />
            </div>
            {/* The gloss is the one cell that wraps, stacked under the
                name below 30rem, and how many lines it takes is a fact
                about the words in the reader's language: three of the
                English glosses take two lines at 390px and one of the
                Korean ones does. A list of wrap marks measured in one
                language stood the Korean tree 40px tall. So the real
                gloss is laid out here invisibly, at the size it will be,
                and a bar is drawn over its first line. */}
            <div className="gloss relative min-w-0 self-center text-sm">
              <span className="invisible">{t(row.gloss)}</span>
              <Skeleton className="absolute top-1.5 left-0 h-2 w-3/4 max-w-full" />
            </div>
            <div className="size flex h-5 items-center self-center">
              <Skeleton className="h-2.5 w-24" />
            </div>
          </li>
        ))}
      </ul>
      <VaultNote />
    </Loading>
  );
}

/** The glyph VaultTree draws for each kind of row, out of its own map, at its size. */
function VaultRowIcon({ kind }: { kind: VaultKind }) {
  const Icon = VAULT_ICONS[kind];
  return <Icon className="size-4" aria-hidden="true" />;
}

/**
 * The width each row's name comes to in the mono face, in `VAULT_ROWS`
 * order, so any prefix of the list is the shape of a vault with fewer
 * rows. The names never wrap; the gloss beside each is laid out from its
 * own words above.
 */
const PATH_WIDTHS = ['w-10', 'w-14', 'w-10', 'w-10', 'w-24', 'w-14', 'w-20', 'w-14', 'w-28', 'w-24'];
