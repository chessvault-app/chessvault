import { ChevronLeft, ChevronRight, CircleHelp, Palette, Save, User } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageShell } from '@/components/page-shell';
import { pageTitleClass } from '@/components/page-header';
import { SettingRow, SkeletonSettingRow } from '@/components/setting-row';
import { TitleTip } from '@/components/title-tip';
import { SkeletonVaultTree } from '@/components/skeletons';
import { VAULT_ROWS } from '@/components/vault-tree';
import { cn } from '@/lib/utils';
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
function SettingsOutlineTop({
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
 * What an iOS phone gives every direct child of a card's body: a row of
 * the group, 44px under a thumb, with an inset hairline above it.
 *
 * Stated once, here, so every card inherits the shape rather than
 * restating it fifteen times ("Platform-specific design",
 * docs/design-principles.md: grouped inset lists are the iOS form of a
 * list, and the grouped list IS the card there, as on the More page).
 * A control that fits a right-aligned slot is a SettingRow, flattened
 * below; anything else (a labelled field, a slider, a listing, a
 * paragraph, a row of buttons) takes a full-width row of its own by
 * being a child, which is what this rule hands it.
 *
 * The hairline is an inset ::before and not a border, because iOS starts
 * a separator at the label's left edge rather than at the card's; a
 * border cannot be inset. `max-md:` because this is the phone's chrome:
 * an iPad in landscape is `data-platform="ios"` too and draws the
 * desktop page.
 */
const IOS_GROUP =
  'max-md:ios:gap-0 max-md:ios:overflow-hidden max-md:ios:rounded-xl max-md:ios:bg-card max-md:ios:ring-1 max-md:ios:ring-card-ring ' +
  'max-md:ios:[&>*]:relative max-md:ios:[&>*]:min-h-11 max-md:ios:[&>*]:px-4 max-md:ios:[&>*]:py-2.5 ' +
  "max-md:ios:[&>*:not(:first-child)]:before:absolute max-md:ios:[&>*:not(:first-child)]:before:top-0 max-md:ios:[&>*:not(:first-child)]:before:left-4 max-md:ios:[&>*:not(:first-child)]:before:right-0 max-md:ios:[&>*:not(:first-child)]:before:h-px max-md:ios:[&>*:not(:first-child)]:before:bg-border max-md:ios:[&>*:not(:first-child)]:before:content-[''] " +
  // A switch row gives up its own well and becomes the group's row: the
  // label on the left, the control on the right, which is the shape it
  // already had inside the box. Selected by its data-slot so these beat
  // the row's own classes on specificity rather than on source order.
  'max-md:ios:[&>[data-slot=setting-row]]:rounded-none max-md:ios:[&>[data-slot=setting-row]]:border-0 max-md:ios:[&>[data-slot=setting-row]]:bg-transparent max-md:ios:[&>[data-slot=setting-row]]:px-4 max-md:ios:[&>[data-slot=setting-row]]:py-2.5 ' +
  // A rule between two rows is the hairline's job here, and a Separator
  // beside it draws the same line twice.
  'max-md:ios:[&>[data-slot=separator]]:hidden';

/**
 * The same list in Material's flavour, for an Android phone.
 *
 * Android is not the platform that has to keep the desktop page. Its own
 * Settings (Android 16) and Material 3 Expressive's list guidance draw a
 * grouped list too, and the two platforms differ in the DRAWING rather
 * than in the idea: iOS runs the rows together inside one card and rules
 * between them; Material gives every row a card of its own, separated by
 * a 2px gap, with the group's outer corners large and the ones facing
 * the gap small, and no hairline anywhere. So the two rules say the same
 * thing about which element is a row and disagree only about its box.
 *
 * 48px and not 44: Material's minimum touch target is 48dp where Apple's
 * is 44pt, and a settings row is the one control on this page under a
 * thumb for its whole height.
 *
 * `rounded-sm` before `rounded-t-xl` relies on Tailwind emitting the
 * shorthand before the longhand, which is how every corner override in
 * the app is written.
 */
const ANDROID_GROUP =
  'max-md:android:gap-0.5 ' +
  'max-md:android:[&>*]:bg-card max-md:android:[&>*]:min-h-12 max-md:android:[&>*]:rounded-sm max-md:android:[&>*]:px-4 max-md:android:[&>*]:py-3 ' +
  'max-md:android:[&>*:first-child]:rounded-t-xl max-md:android:[&>*:last-child]:rounded-b-xl ' +
  // A switch row gives up its own well and becomes the group's segment,
  // the same handover the iOS rule makes, by the same data-slot.
  'max-md:android:[&>[data-slot=setting-row]]:rounded-sm max-md:android:[&>[data-slot=setting-row]]:border-0 max-md:android:[&>[data-slot=setting-row]]:bg-card max-md:android:[&>[data-slot=setting-row]]:px-4 max-md:android:[&>[data-slot=setting-row]]:py-3 ' +
  'max-md:android:[&>[data-slot=setting-row]:first-child]:rounded-t-xl max-md:android:[&>[data-slot=setting-row]:last-child]:rounded-b-xl ' +
  // Material separates its rows by the gap, so a rule between two of
  // them is a second separator drawn over the first.
  'max-md:android:[&>[data-slot=separator]]:hidden';

/**
 * One settings card: the page's own frame, used by the settled page and
 * by both of its placeholders, so a card that waits cannot be a
 * different box from the card that arrives.
 *
 * On a phone it is a grouped inset list instead: the name above the
 * group in the section-label voice, and the rows below it (IOS_GROUP and
 * ANDROID_GROUP above, one card holding hairlined rows or one card per
 * row). Desktop is unchanged.
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
    <section
      id={anchor}
      className={cn(
        'bg-card rounded-xl ring-1 ring-card-ring scroll-mt-14 p-4',
        // iOS: the box moves off the section and onto the body below, and
        // what is left is a group heading over a card.
        'max-md:ios:flex max-md:ios:flex-col max-md:ios:gap-2 max-md:ios:rounded-none max-md:ios:bg-transparent max-md:ios:p-0 max-md:ios:ring-0',
        // Android: the same handover, Material's grouped list (below).
        'max-md:android:flex max-md:android:flex-col max-md:android:gap-2 max-md:android:rounded-none max-md:android:bg-transparent max-md:android:p-0 max-md:android:ring-0',
      )}
      data-settings-card
    >
      <h2
        className={cn(
          'mb-3 flex items-center gap-2 text-base font-medium',
          // The group's name, in the voice the More page's headings use.
          'max-md:ios:type-row max-md:ios:mb-0 max-md:ios:px-4 max-md:ios:text-muted-foreground',
          // Material names a group in the accent, which is the one thing
          // its heading says that iOS's grey one does not.
          'max-md:android:type-row max-md:android:mb-0 max-md:android:px-4 max-md:android:text-primary',
        )}
      >
        {/* A group heading on either phone is words and nothing else. */}
        <Icon className="text-muted-foreground size-4 max-md:ios:hidden max-md:android:hidden" />
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
      <div className={cn('flex flex-col gap-3', IOS_GROUP, ANDROID_GROUP)}>{children}</div>
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

/**
 * The page's whole outline, for the wait BEFORE the page's own chunk.
 *
 * `lib/lazyRoute` imports this module in parallel with SettingsPage and
 * draws this while the page is still on the wire; SettingsPage draws
 * `SettingsPlaceholder` out of the same module while /api/settings is
 * out. One picture over both waits, and it cannot be two pictures,
 * because it is one component.
 *
 * The shell is the page's own (`PageShell width="narrow"`), which is all
 * SettingsPage puts around the placeholder itself.
 */
export default function SettingsOutlinePage() {
  return (
    <PageShell width="narrow">
      <SettingsPlaceholder />
    </PageShell>
  );
}

export function SettingsPlaceholder() {
  return (
    <div role="status" aria-label={t('Loading')} aria-live="polite" className="contents">
      {/* The page title, as PageHeader draws it: text-xl on a desktop,
          whose line box is 28px; below md the header is the phone's 44px
          bar (PageHeader's min-h-11) with the back chevron before the
          name. The title is known without the answer, so it is the real
          words, and the chevron is the real button held inert. */}
      <div className="flex h-7 items-center gap-x-3 max-md:h-11" data-ground="" data-chrome="">
        <Button variant="ghost" size="icon-sm" className="md:hidden" disabled tabIndex={-1} aria-hidden>
          <ChevronLeft className="glyph" />
        </Button>
        <h1 className={pageTitleClass}>{t('Settings')}</h1>
      </div>
      {/* The link row and the first cards are the shared outline, which
          the route placeholder draws too (settings/SettingsPage.skeleton):
          two waits for one page, one picture. What follows is the cards
          that outline leaves to whoever holds this chunk. */}
      <SettingsOutlineTop>
        <SettingsCard icon={Save} title={t('Documents')}>
          <SkeletonSettingRow title="Auto-save" blurb="Write changes to the vault as you make them. Off, they wait for you to save." />
        </SettingsCard>
        {isDemo() && (
          <SettingsCard icon={Palette} title={t('Appearance')}>
            {APPEARANCE_SHAPES.map(({ label, full }) =>
              full ? (
                <SelectFieldPlaceholder key={label} label={label} />
              ) : (
                <SelectRowPlaceholder key={label} label={label} />
              ),
            )}
            <SkeletonSettingRow title="Board coordinates" blurb="File and rank labels on the board edge." />
            <SkeletonSettingRow title="Move box" blurb="Play moves from the keyboard." />
            <DisclosurePlaceholder />
          </SettingsCard>
        )}
      </SettingsOutlineTop>
    </div>
  );
}

/**
 * The Appearance card's seven Selects, in the card's order. The card
 * (settings/cards/appearance-card) labels its fields out of this, so a
 * renamed field is renamed in the placeholder by the same edit.
 */
export const APPEARANCE_LABELS = {
  language: 'App language',
  theme: 'App theme',
  density: 'Density',
  colours: 'Colours',
  board: 'Board',
  pieces: 'Pieces',
  castling: 'Castling',
} as const;

/**
 * Which of the two shapes each Appearance choice takes, in the card's
 * order: a row with the control on the right, or the label over a
 * full-width control.
 *
 * Here rather than in the card because the placeholder is the one that
 * has to draw the card without importing it, and the two shapes are
 * different HEIGHTS — a row is one line, a field is two. A list of
 * labels alone was enough while all seven were the same shape; it is
 * not any more. `full` is the picture-picking three (a swatch, a board,
 * a piece set), which keep the card's width to show their art.
 */
const APPEARANCE_SHAPES = [
  { label: APPEARANCE_LABELS.language, full: false },
  { label: APPEARANCE_LABELS.theme, full: false },
  { label: APPEARANCE_LABELS.density, full: false },
  { label: APPEARANCE_LABELS.colours, full: true },
  { label: APPEARANCE_LABELS.board, full: true },
  { label: APPEARANCE_LABELS.pieces, full: true },
  { label: APPEARANCE_LABELS.castling, full: false },
] as const;

/**
 * A labelled control, held inert: the real Field with its real label
 * over the real control, a lg input at h-9 or a select trigger at h-8,
 * both h-9 under a coarse pointer. The label is known before the answer
 * is, so it is the real words rather than a bar; the value is not, so
 * the input is empty and the select shows its no-value dash. The select
 * sits under `inert` rather than `disabled`, because the phone's trigger
 * is its own button and does not take the prop.
 */
function SelectFieldPlaceholder({ label }: { label: string }) {
  return (
    <Field label={label}>
      <div inert>
        <Select value="" ariaLabel={t(label)} groups={[{ options: [] }]} className="w-full" />
      </div>
    </Field>
  );
}

/**
 * The same control in the row it now stands in: the real SettingRow with
 * its real title, and the real select on the right at the row's settled
 * width, empty. The row is the shape the card draws (SettingRow,
 * `control="wide"`), so the two cannot be different heights.
 */
function SelectRowPlaceholder({ label }: { label: string }) {
  return (
    <SettingRow title={t(label)} control="wide">
      <div inert className="w-full">
        <Select value="" ariaLabel={t(label)} groups={[{ options: [] }]} className="w-full" />
      </div>
    </SettingRow>
  );
}

/** The closed "More options" row of a Disclosure, held inert: one text-sm line, 36px under a coarse pointer. */
function DisclosurePlaceholder() {
  return (
    <button
      type="button"
      disabled
      tabIndex={-1}
      className="text-muted-foreground flex items-center gap-1.5 self-start text-sm pointer-coarse:min-h-9"
    >
      <ChevronRight className="glyph" aria-hidden />
      {t('More options')}
    </button>
  );
}

