import { useState } from 'react';
import { ChipRow } from '@/components/chip-row';
import { FilterChip } from '@/components/filter-chip';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SearchInput } from '@/components/text-fields';
import { Arrival, Inert, Skeleton, SkeletonLicenceRows } from '@/components/skeletons';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

const BASE = `${import.meta.env.BASE_URL}licenses/`;

/** What the head prints once the walk has landed; null while it has not. */
export interface Inventory {
  year: string;
  holder: string;
  repo: string;
  entries: { group: string }[];
}

/**
 * How many group chips this build drew last time, so the row holds its
 * place before the inventory lands. The count is a property of the
 * BUILD, not the vault: the web build has two groups and the desktop
 * app three, since it adds Chromium's own notices (web/vite.licenses.ts).
 * A placeholder that always drew two was right on the web and one chip
 * short in the app. Same bargain as the other reservations: a paint
 * hint, wrong by at most one visit, corrected by whatever lands.
 *
 * Here rather than in the page because the outline reserves the row too,
 * and it is drawn before the page that writes this key exists.
 */
export const GROUPS_KEY = 'vault:licences-groups';

/** Each group and how many entries are in it, in the walk's own order. */
export const groupsOf = (inventory: Inventory | null): [string, number][] => {
  const counts = new Map<string, number>();
  for (const e of inventory?.entries ?? []) counts.set(e.group, (counts.get(e.group) ?? 0) + 1);
  return [...counts];
};

const GROUP_NAMES = ['Bundled assets', 'Packages', 'Chromium (desktop app)'];
/** What a device that has not seen this page reserves: the web build's. */
const FRESH_GROUPS = 2;
const MAX_GROUPS = 6;
export const readGroups = (): number => {
  const n = Number(localStorage.getItem(GROUPS_KEY));
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_GROUPS) : FRESH_GROUPS;
};

/**
 * The whole page while its chunk is on the wire.
 *
 * Not a reduced version of the page: the page's OWN head, drawn with no
 * inventory, over the page's own rows placeholder. LicensesPage renders
 * the same head with the answer in it, so there is one composition and
 * the wait cannot disagree with what replaces it about where the search
 * field, the chips or the first row sit.
 *
 * Held inert as a whole (skeletons, `Inert`): every control in it is the
 * real one, and a placeholder's controls take no focus and no clicks.
 */
export default function LicencesOutline() {
  const [reservedGroups] = useState(readGroups);
  return (
    <PageShell width="medium">
      <Inert>
        <LicencesHead
          inventory={null}
          failed={false}
          query=""
          onQuery={NOOP}
          group=""
          onGroup={NOOP}
          reservedGroups={reservedGroups}
        />
      </Inert>
      <Arrival pending>
        <SkeletonLicenceRows rows={10} />
      </Arrival>
    </PageShell>
  );
}

const NOOP = (): void => {};

/**
 * The page's head: what it is, what it is built from, the filter field
 * and the group chips.
 *
 * Its own component so the page and the page's outline draw one head.
 * Every piece of it is known before the licence walk lands except three
 * numbers — the copyright year, the holder, and each chip's count — and
 * those are the only bars in it. The chip COUNT is reserved from what
 * this build drew last time, because it is a property of the build and
 * not of the vault: the web build has two groups and the desktop app
 * three.
 */
export function LicencesHead({
  inventory,
  failed,
  query,
  onQuery,
  group,
  onGroup,
  reservedGroups,
}: {
  inventory: Inventory | null;
  failed: boolean;
  query: string;
  onQuery: (value: string) => void;
  group: string;
  onGroup: (value: string) => void;
  reservedGroups: number;
}) {
  const total = inventory?.entries.length ?? 0;
  const groups = groupsOf(inventory);
  return (
    <>
  <PageHeader
    title={t('Licences')}
    back={() => navigate('settings')}
    description={
      <>
        {t('Everything this app is built from, and the terms it is used under.')}
        {!failed && (
          <>
            {' '}
            Chess Vault ©{' '}
            {inventory ? (
              `${inventory.year} ${inventory.holder}`
            ) : (
              // A year and a holder's name, as words in the sentence.
              <>
                <Skeleton className="inline-block h-2.5 w-8 align-middle" />{' '}
                <Skeleton className="inline-block h-2.5 w-36 align-middle" />
              </>
            )}
            .{' '}
            <a
              className="text-primary underline underline-offset-2"
              href={`${BASE}GPL-3.0.txt`}
              target="_blank"
              rel="noreferrer"
            >
              {t('GNU General Public License v3')}
            </a>
            {' · '}
            {inventory ? (
              <a
                className="text-primary underline underline-offset-2"
                href={inventory.repo}
                target="_blank"
                rel="noreferrer"
              >
                {t('Source code')}
              </a>
            ) : (
              <span>{t('Source code')}</span>
            )}
          </>
        )}
      </>
    }
    search={
      !failed && (
        <SearchInput
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('Filter by package or licence')}
          aria-label={t('Filter by package or licence')}
          className="min-w-0 flex-1"
        />
      )
    }
  />
  {!failed && (
    <div className="flex flex-col gap-2">
      <ChipRow>
        {inventory ? (
          <>
            <FilterChip label="All" count={total} active={group === ''} onClick={() => onGroup('')} />
            {groups.map(([g, n]) => (
              <FilterChip
                key={g}
                label={g}
                count={n}
                active={group === g}
                onClick={() => onGroup(group === g ? '' : g)}
              />
            ))}
          </>
        ) : (
          // The All chip with its count still to come, and the group
          // chips' own pills (a chip is text-sm, py-1 and its border;
          // 36px under a coarse pointer). The group names are fixed in
          // the licence walk, so the widths are theirs: measured 142
          // and 116px in English, 108 and 90 in Korean, against the 96
          // and 80 that stood here and left the row short.
          <>
            <FilterChip
              label={
                <>
                  {t('All')}
                  {/* The lit chip is filled accent, the fill a bar has
                      everywhere else, so this one was invisible in
                      both themes: the primary at 20% is the rung
                      deeper in the same ink. */}
                  <Skeleton className="bg-primary/20 ml-1 inline-block h-2.5 w-6 align-middle" />
                </>
              }
              active
              onClick={() => {}}
            />
            {Array.from({ length: reservedGroups }, (_, i) => (
              <FilterChip
                key={i}
                label={
                  <>
                    {t(GROUP_NAMES[i % GROUP_NAMES.length]!)}
                    <Skeleton className="ml-1 inline-block h-2.5 w-6 align-middle" />
                  </>
                }
                active={false}
                onClick={() => {}}
              />
            ))}
          </>
        )}
      </ChipRow>
    </div>
  )}
    </>
  );
}
