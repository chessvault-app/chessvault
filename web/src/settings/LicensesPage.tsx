import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { TitleTip } from '@/components/title-tip';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/page-shell';
import { Arrival, SkeletonLicenceRows, useSlowLoad } from '@/components/skeletons';
import { GROUPS_KEY, HOLDER_KEY, LicencesHead, groupsOf, readGroups } from '@/settings/LicensesPage.skeleton';
import { routePlaceholderShown } from '@/lib/lazyRoute';
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
/** The group names the licence walk writes, in its order (web/vite.licenses.ts). */

export function LicensesPage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [reservedGroups] = useState(readGroups);
  /** The route's outline drew this same head and these same rows while
      the chunk came down (lib/lazyRoute); without this the two waits hand
      over through useSlowLoad's 180ms and the page blinks out and back. */
  const [continuing] = useState(routePlaceholderShown);
  const slow = useSlowLoad(!inventory && !failed) || (continuing && !inventory && !failed);

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`${BASE}index.json`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Inventory>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => !ctl.signal.aborted && setInventory(data))
      .catch(() => !ctl.signal.aborted && setFailed(true));
    return () => {
      ctl.abort();
    };
  }, []);

  const groups = useMemo(() => groupsOf(inventory), [inventory]);
  useEffect(() => {
    if (groups.length === 0) return;
    try {
      localStorage.setItem(GROUPS_KEY, String(groups.length));
      if (inventory) localStorage.setItem(HOLDER_KEY, `${inventory.year} ${inventory.holder}`);
    } catch {
      // Nothing to reserve next time; the web build's two serve.
    }
  }, [groups, inventory]);

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

  const toggle = (i: number): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <PageShell width="medium">
      <LicencesHead
        inventory={inventory}
        failed={failed}
        query={query}
        onQuery={setQuery}
        group={group}
        onGroup={setGroup}
        reservedGroups={reservedGroups}
      />
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
        className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-(--row-py-dense) text-left type-row transition-colors duration-100 pointer-coarse:min-h-9"
      >
        <ChevronRight
          className={cn(
            'text-muted-foreground glyph shrink-0 transition-transform duration-(--pane-turn) ease-(--pane-turn-ease)',
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
            <span className="text-muted-foreground shrink-0 font-mono type-row-sub">{entry.version}</span>
          )}
          <TitleTip title={entry.license}>
            <span className="text-muted-foreground border-border max-w-full shrink-0 truncate rounded-full border px-2 py-px type-row-sub font-medium whitespace-nowrap">
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
