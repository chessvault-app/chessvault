import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChipRow } from '@/components/chip-row';
import { FilterChip } from '@/components/filter-chip';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SearchInput, searchRowClass } from '@/components/text-fields';
import { SkeletonRows, useSlowLoad } from '@/components/skeletons';
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
 */

interface Entry {
  name: string;
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

export function LicensesPage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
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

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (inventory?.entries ?? [])
      .map((e, i) => [e, i] as const)
      .filter(
        ([e]) =>
          (!group || e.group === group) &&
          (!term || e.name.toLowerCase().includes(term) || e.license.toLowerCase().includes(term)),
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
        description={t('Everything this app is built from, and the terms it is used under.')}
      />
      {inventory && (
        <p className="text-muted-foreground text-sm leading-relaxed">
          Chess Vault © {inventory.year} {inventory.holder}.{' '}
          <a
            className="text-primary underline underline-offset-2"
            href={`${BASE}GPL-3.0.txt`}
            target="_blank"
            rel="noreferrer"
          >
            {t('GNU General Public License v3')}
          </a>
          {' · '}
          <a
            className="text-primary underline underline-offset-2"
            href={inventory.repo}
            target="_blank"
            rel="noreferrer"
          >
            {t('Source code')}
          </a>
        </p>
      )}
      {inventory && (
        <div className="flex flex-col gap-2">
          <div className={cn('flex gap-2', searchRowClass)}>
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Filter by package or licence')}
              aria-label={t('Filter by package or licence')}
              className="min-w-0 flex-1 sm:max-w-sm"
            />
          </div>
          <ChipRow>
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
          </ChipRow>
        </div>
      )}
      {failed ? (
        <p className="text-muted-foreground text-sm">{t('The licence list could not be loaded.')}</p>
      ) : !inventory ? (
        slow && <SkeletonRows rows={10} />
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('Nothing matches this filter.')}</p>
      ) : (
        <ul className="divide-border divide-y" aria-label={t('Licences')}>
          {shown.map(([e, i]) => (
            <Row key={i} entry={e} open={open.has(i)} onToggle={() => toggle(i)} />
          ))}
        </ul>
      )}
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
        className="hover:bg-muted/50 flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-100"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        {entry.version && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs">{entry.version}</span>
        )}
        <span
          className="text-muted-foreground border-input max-w-[45%] shrink-0 truncate rounded-full border px-2 py-px text-xs whitespace-nowrap"
          title={entry.license}
        >
          {entry.license}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2 pt-1 pb-3">
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
          <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      )}
    </li>
  );
}
