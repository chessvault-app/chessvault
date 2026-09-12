import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { ChipRow } from '@/components/chip-row';
import { TitleTip } from '@/components/title-tip';
import { Button } from '@/components/ui/button';
import { FilterChip } from '@/components/filter-chip';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SearchInput } from '@/components/text-fields';
import { Arrival, Skeleton, SkeletonLicenceRows, useSlowLoad } from '@/components/skeletons';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The licences, as a page of this app.
 *
 * The inventory is generated at build time (web/vite.licenses.ts): every
 * dependency, its version and its licence, beside the licence texts. That
 * generator writes two things from one list. `licenses/index.html` is the
 * standalone notice, which the landing site links to and which anyone can
 * open from the installed files. `licenses/index.json` is the same rows as
 * data, and it is what this page draws, with the app's own header, search
 * field, chips and rows, so that reading the licences looks like reading
 * any other page here.
 *
 * It was an iframe over index.html for a while: a document in a card,
 * with the document's own fonts and controls inside the app's. Same
 * content, but a page that plainly is not the app, in the app, reads as
 * something bolted on (lanph3re's report). One list feeds both, so the
 * two cannot say different things.
 *
 * Chromium's texts (desktop app only) are not in the JSON: 19 MB for a
 * list almost nobody expands. A row that has none carries `lazy`, its
 * index into `licenses/chromium.json`, fetched the first time such a row
 * is opened.
 *
 * In `vite dev` the plugin serves the same paths, so the page is never a
 * dead end before something has been built.
 *
 * Everything the inventory adds to the page has its place held before it
 * lands: the copyright line under the title (year and holder as bars, the
 * licence link live since its file is a fixed path), the search field,
 * the chip row, and rows in the row's own shape. The page used to draw
 * only the title, one line of description and a generic list placeholder,
 * then grew the rest when the JSON arrived: measured on the demo, the
 * list dropped 117px on a desktop and 145px on a phone at that moment.
 */

interface Entry {
  name: string;
  /** What the name alone does not say: which set, which build. A bundled
      asset's, from ASSETS in web/vite.licenses.ts; packages have none. */
  note?: string;
  version: string;
  license: string;
  url: string;
  text: string | null;
  group: string;
  lazy?: number;
}

interface Inventory {
  year: string;
  holder: string;
  repo: string;
  entries: Entry[];
}

const BASE = `${import.meta.env.BASE_URL}licenses/`;

/**
 * How many group chips this build drew last time, so the row holds its
 * place before the inventory lands. The count is a property of the
 * BUILD, not the vault: the web build has two groups and the desktop
 * app three, since it adds Chromium's own notices (web/vite.licenses.ts).
 * A placeholder that always drew two was right on the web and one chip
 * short in the app. Same bargain as the other reservations: a paint
 * hint, wrong by at most one visit, corrected by whatever lands.
 */
const GROUPS_KEY = 'vault:licences-groups';
/** What a device that has not seen this page reserves: the web build's. */
const FRESH_GROUPS = 2;
const MAX_GROUPS = 6;
const readGroups = (): number => {
  const n = Number(localStorage.getItem(GROUPS_KEY));
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_GROUPS) : FRESH_GROUPS;
};

export function LicensesPage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [reservedGroups] = useState(readGroups);
  const slow = useSlowLoad(!inventory && !failed);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Inventory>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => live && setInventory(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of inventory?.entries ?? []) counts.set(e.group, (counts.get(e.group) ?? 0) + 1);
    return [...counts];
  }, [inventory]);
  useEffect(() => {
    if (groups.length === 0) return;
    try {
      localStorage.setItem(GROUPS_KEY, String(groups.length));
    } catch {
      // Nothing to reserve next time; the web build's two serve.
    }
  }, [groups]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (inventory?.entries ?? [])
      .map((e, i) => [e, i] as const)
      .filter(
        ([e]) =>
          (!group || e.group === group) &&
          (!term ||
            e.name.toLowerCase().includes(term) ||
            (e.note ?? '').toLowerCase().includes(term) ||
            e.license.toLowerCase().includes(term)),
      );
  }, [inventory, query, group]);

  const total = inventory?.entries.length ?? 0;
  const toggle = (i: number): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <PageShell width="medium">
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
              onChange={(e) => setQuery(e.target.value)}
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
                <FilterChip label="All" count={total} active={group === ''} onClick={() => setGroup('')} />
                {groups.map(([g, n]) => (
                  <FilterChip
                    key={g}
                    label={g}
                    count={n}
                    active={group === g}
                    onClick={() => setGroup(group === g ? '' : g)}
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
                  <Skeleton
                    key={i}
                    className={cn(
                      'h-7.5 shrink-0 rounded-full pointer-coarse:h-9',
                      ['w-36', 'w-28', 'w-44'][i % 3],
                    )}
                  />
                ))}
              </>
            )}
          </ChipRow>
        </div>
      )}
      <Arrival pending={slow && !inventory && !failed}>
      {failed ? (
        <p className="text-muted-foreground text-sm">{t('The licence list could not be loaded.')}</p>
      ) : !inventory ? (
        slow && <SkeletonLicenceRows rows={10} />
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('Nothing matches this filter.')}</p>
      ) : (
        // data-ground: the rows and the text well stand on the page, where
        // the muted fill is the page's own tone (index.css, `[data-ground]`).
        <ul data-ground="" className="divide-border divide-y" aria-label={t('Licences')}>
          {shown.map(([e, i]) => (
            <Row key={i} entry={e} open={open.has(i)} onToggle={() => toggle(i)} />
          ))}
        </ul>
      )}
      </Arrival>
    </PageShell>
  );
}

/** Chromium's texts, one file for every row, fetched once. */
let chromiumTexts: Promise<string[]> | null = null;
const chromiumText = (at: number): Promise<string> => {
  chromiumTexts ??= fetch(`${BASE}chromium.json`).then((r) => r.json() as Promise<string[]>);
  return chromiumTexts.then((all) => all[at] ?? t('Licence text unavailable.'));
};

function Row({ entry, open, onToggle }: { entry: Entry; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  const [lazyText, setLazyText] = useState<string | null>(null);
  useEffect(() => {
    if (!open || entry.lazy === undefined || lazyText !== null) return;
    let live = true;
    chromiumText(entry.lazy)
      .then((s) => live && setLazyText(s))
      .catch(() => live && setLazyText(t('The licence text could not be loaded.')));
    return () => {
      live = false;
    };
  }, [open, entry.lazy, lazyText]);

  const text =
    entry.lazy !== undefined
      ? (lazyText ?? t('Loading…'))
      : (entry.text ?? t('No licence file ships with this component. It is under {license}.', { license: entry.license }));

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // The full muted fill, the ghost variant's hover, not a wash of it:
        // half of the ground rung over the page measured 1.04:1.
        className="hover:bg-muted flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-100"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform duration-(--pane-turn) ease-(--pane-turn-ease)',
            open && 'rotate-90',
          )}
        />
        {/* The name wraps, and below sm the version and the licence pill
            take a line of their own under it. It was one truncated line:
            at 320px CSS wide 43 of the 204 names were cut, and the two
            Lichess packages both read "@lichess-o…", with nothing on the
            page giving the rest. The name is what the page is for. */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 basis-full font-medium break-words sm:flex-1 sm:basis-0">
            {entry.name}
            {entry.note && (
              <span className="text-muted-foreground font-normal">
                {' '}
                {entry.note}
              </span>
            )}
          </span>
          {entry.version && (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">{entry.version}</span>
          )}
          <TitleTip title={entry.license}>
            <span className="text-muted-foreground border-border max-w-full shrink-0 truncate rounded-full border px-2 py-px text-xs whitespace-nowrap">
              {entry.license}
            </span>
          </TitleTip>
        </span>
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-2 px-2 pt-1 pb-3">
          {entry.url && (
            <a
              className="text-primary text-xs break-all underline underline-offset-2"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
            >
              {entry.url}
            </a>
          )}
          {/* A well that scrolls, not a text poured into the page: the
              longest text is 35,799 characters, which stood 13,159px tall
              on a desktop and 28,935px on a phone, with the only way to
              close it fourteen to forty screens back up. The well is
              focusable so the keyboard can scroll it, and named so a
              reader knows what it has landed in. */}
          <pre
            tabIndex={0}
            aria-label={t('Licence text')}
            className="bg-muted max-h-[60vh] overflow-auto rounded-md px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            {text}
          </pre>
          <Button variant="ghost" size="sm" className="self-start" onClick={onToggle}>
            {t('Close')}
          </Button>
        </div>
      )}
    </li>
  );
}
