import { CircleHelp, User } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { TitleTip } from '@/components/title-tip';
import { SkeletonVaultTree } from '@/components/skeletons';
import { VAULT_ROWS } from '@/components/vault-tree';
import { manualUrl } from '@/lib/manual';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';

/**
 * The top of the Settings page, drawn by the two things that wait for it.
 *
 * Settings has two waits, one behind the other. The page's chunk
 * downloads (components/route-skeleton draws that one), and then the
 * page asks the server for the settings themselves (SettingsPage's own
 * SettingsPlaceholder draws that one). They were the same page and two
 * different pictures, so a slow start redrew the column twice. This is
 * the picture both of them use, which is the only way two placeholders
 * for one page can be made to agree.
 *
 * It is the TOP of the page and not all of it, on a measurement. The
 * cards below reach the setting rows, the switch and the Appearance
 * selects, and a probe that merely touched those modules added three
 * chunks and 4.1 kB gzipped to the launch payload before any of this
 * file's own code. The top reaches one new chunk (the card's help mark)
 * and lands at 2.2 kB gzipped all in, and it is the part that decides
 * whether anything MOVES: the cards below it arrive into empty space and
 * push nothing down. SettingsPage passes the rest as children, from its
 * own chunk, where those modules already are.
 *
 * The card frames are real and the sentences a card prints whatever the
 * answer are the real words; only what waits on the answer is a bar.
 */
export function SettingsOutline({
  children,
}: {
  /** The cards below the fold, drawn by whoever has the chunk for them. */
  children?: ReactNode;
}) {
  const paths = readVaultPaths();
  return (
    <>
      <JumpRow />
      {isDemo() ? (
        <SettingsCard icon={BrandMark} title={t('Vault')}>
          <SkeletonVaultTree path={null} rows={7} paths={paths} />
          <p className="text-muted-foreground text-sm">{t(DEMO_VAULT_NOTE)}</p>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard icon={User} title={t('Profile')}>
            <FieldPlaceholder label="Display name" />
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldPlaceholder label="Chess.com username" />
              <FieldPlaceholder label="Lichess username" />
            </div>
            <p className="text-muted-foreground text-sm">{t(PROFILE_NOTE)}</p>
            <ButtonPlaceholder label="Save profile" />
          </SettingsCard>
          <SettingsCard icon={BrandMark} title={t('Vault')}>
            <FieldPlaceholder label="Vault name" />
            <p className="text-muted-foreground text-sm">{t(VAULT_NAME_NOTE)}</p>
            <ButtonPlaceholder label="Save name" />
            <SkeletonVaultTree paths={paths} />
            <div className="flex flex-wrap items-center gap-2">
              <ButtonPlaceholder variant="secondary" label="Download a copy" />
              <ButtonPlaceholder variant="secondary" label="Copy the path" />
            </div>
            <p className="text-muted-foreground text-sm">{t(VAULT_COPY_NOTE)}</p>
          </SettingsCard>
        </>
      )}
      {children}
    </>
  );
}

/**
 * The section links, as JumpList draws them: text-sm names in px-1
 * buttons, py-2 and mb-1, no row at all below md, and none from xl
 * either, where the names stand in the margin and take no room in the
 * column. The names are the real words in the real button, held inert,
 * so the row wraps where the real one will.
 */
function JumpRow() {
  return (
    <div className="-mx-1 mb-1 hidden flex-wrap gap-x-3 gap-y-1 px-1 py-2 text-sm md:flex xl:hidden">
      {(isDemo() ? JUMP_NAMES_DEMO : JUMP_NAMES_SERVER).map((name) => (
        <button key={name} type="button" disabled tabIndex={-1} className="text-muted-foreground rounded-md px-1">
          {t(name)}
        </button>
      ))}
    </div>
  );
}

/**
 * One settings card: the page's own frame, used by the settled page and
 * by both of its placeholders, so a card that waits cannot be a
 * different box from the card that arrives.
 */
export function SettingsCard({
  icon: Icon,
  title,
  anchor,
  children,
}: {
  /** A lucide icon, or the brand mark: anything that takes a className. */
  icon: ComponentType<{ className?: string }>;
  title: string;
  /** An id another card can scroll to (the Storage rows). */
  anchor?: string;
  children: ReactNode;
}) {
  return (
    // data-settings-card is what the jump list above the cards reads.
    <section id={anchor} className="bg-card rounded-xl ring-1 ring-card-ring scroll-mt-14 p-4" data-settings-card>
      <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
        <Icon className="text-muted-foreground size-4" />
        {title}
        {/* The manual is written card by card, and nothing in the app
            pointed at it. One quiet mark per card opens the manual's
            Settings page in a new tab; the shortcut sheet stays what it
            was. */}
        <TitleTip title={t('Open the manual')}>
          <a
            href={manualUrl('settings')}
            target="_blank"
            rel="noreferrer"
            aria-label={t('Open the manual')}
            className="text-muted-foreground hover:text-foreground ml-auto grid size-6 place-items-center rounded-md pointer-coarse:size-9"
          >
            <CircleHelp className="glyph" />
          </a>
        </TitleTip>
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * A labelled input, held inert: the real Field with its real label over
 * the real control, lg at h-9 and h-9 again under a coarse pointer. The
 * label is known before the answer is, so it is the real words rather
 * than a bar; the value is not, so the input is empty.
 *
 * The SELECT form of this stays in SettingsPage. Only the Appearance
 * card draws one, that card sits below this outline, and ui/select is
 * launch payload this does not have to spend.
 */
function FieldPlaceholder({ label }: { label: string }) {
  return (
    <Field label={label}>
      <Input inputSize="lg" disabled tabIndex={-1} />
    </Field>
  );
}

/** A default button, held inert, with the label the real one carries: h-8, and h-9 under a coarse pointer. */
function ButtonPlaceholder({
  label,
  variant = 'default',
}: {
  label: string;
  variant?: 'default' | 'secondary';
}) {
  return (
    <Button variant={variant} disabled tabIndex={-1}>
      {t(label)}
    </Button>
  );
}

/** The sentences the first cards print, shared with the placeholders that print them too. */
export const DEMO_VAULT_NOTE =
  'This tab holds the demo vault. Installing the app puts one on disk, and this card shows where.';
export const VAULT_NAME_NOTE =
  'Names this vault at the foot of the sidebar and in the window title. Every device that opens it sees the same name.';
export const VAULT_COPY_NOTE =
  'The copy is one tar file of every document and the change history. Settings and tokens stay on the server.';
export const PROFILE_NOTE = 'Usernames pre-fill the archive browser on the Games page.';

/**
 * The names the section links will carry, in card order, one list per
 * start (SettingsPage's render is the source; the desktop shell adds one
 * card, "Desktop app", and the lag build another). The placeholder lays
 * them out invisibly, because how many lines the row takes is a fact
 * about the words: nine Korean names fit one line at the narrow width
 * and the same nine in English take two.
 */
const JUMP_NAMES_DEMO = ['Vault', 'Documents', 'Appearance', 'Storage used', 'Deleted documents', 'Sound', 'Home screen', 'This is a demo', 'Version'];
const JUMP_NAMES_SERVER = ['Profile', 'Vault', 'Documents', 'Security', 'Lichess token', 'Tablebase', 'Browsed games', 'Appearance', 'Storage used', 'Deleted documents', 'Sound', 'Home screen', 'Danger zone', 'Version'];

/**
 * The vault rows this device saw listed last visit, so a placeholder
 * reserves the rows that are coming rather than the first seven.
 *
 * The placeholder reserves each row's own gloss, laid out invisible, so
 * it has to know WHICH rows and not merely how many: a vault with no
 * books drops two folders from the MIDDLE of the list and still ends on
 * `.history.git` and `config.json`, and the first eight reserved two
 * glosses that never arrive and missed the two that do. The same bargain
 * as the other reservations: a paint hint, wrong by at most one visit,
 * corrected by whatever /api/storage says.
 *
 * Here rather than in SettingsPage because the route placeholder reads
 * it too, and it cannot read a constant inside the chunk it waits for.
 */
export const VAULT_ROWS_KEY = 'vault:storage-rows';
export const readVaultPaths = (): readonly string[] | undefined => {
  try {
    const raw = localStorage.getItem(VAULT_ROWS_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const known = parsed.filter((v): v is string => typeof v === 'string' && VAULT_ROWS.some((r) => r.path === v));
    // An empty list is not "nothing listed", it is a record we cannot
    // use: fall back to the count, as an absent record does.
    return known.length > 0 ? known : undefined;
  } catch {
    return undefined;
  }
};
