import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { INPUT_BASE } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { autoFocusField, useMediaQuery } from '@/lib/media';
import { SearchInput } from '@/components/text-fields';
import { t } from '@/lib/i18n';

/** An entry in the openings catalogue: a name and the line that earns it.
    Named for what it is — `Template` collided with the OCR pipeline's
    unrelated Template. */
export interface OpeningTemplate {
  eco: string;
  name: string;
  sans: string[];
}

// A spread of the major openings, each seeded to the point where it earns its
// name. "Free" starts at move one. ECO codes are the opening's root.
export const TEMPLATES: OpeningTemplate[] = [
  { eco: '', name: 'Start position', sans: [] },
  { eco: 'B20', name: 'Sicilian Defence', sans: ['e4', 'c5'] },
  { eco: 'C00', name: 'French Defence', sans: ['e4', 'e6'] },
  { eco: 'B10', name: 'Caro-Kann Defence', sans: ['e4', 'c6'] },
  { eco: 'B01', name: 'Scandinavian Defence', sans: ['e4', 'd5'] },
  { eco: 'B07', name: 'Pirc Defence', sans: ['e4', 'd6'] },
  { eco: 'C60', name: 'Ruy López', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C50', name: 'Italian Game', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C45', name: 'Scotch Game', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C25', name: 'Vienna Game', sans: ['e4', 'e5', 'Nc3'] },
  { eco: 'D06', name: "Queen's Gambit", sans: ['d4', 'd5', 'c4'] },
  { eco: 'D10', name: 'Slav Defence', sans: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D02', name: 'London System', sans: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'] },
  { eco: 'E60', name: "King's Indian Defence", sans: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E20', name: 'Nimzo-Indian Defence', sans: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'A80', name: 'Dutch Defence', sans: ['d4', 'f5'] },
  { eco: 'A10', name: 'English Opening', sans: ['c4'] },
  { eco: 'A04', name: 'Réti Opening', sans: ['Nf3'] },
];

/**
 * The catalogue, fetched once per session and shared across mounts. The
 * picker unmounts whenever the idle panel leaves, and each return used to
 * re-download all ~3,800 entries; the answer never changes, so it is
 * cached at module level with racing callers sharing the one in-flight
 * request — the pattern lib/opening.ts uses. A failure answers an empty
 * list without being cached, so the next mount asks again.
 */
let catalogue: OpeningTemplate[] | null = null;
let inFlight: Promise<OpeningTemplate[]> | null = null;

function loadCatalogue(): Promise<OpeningTemplate[]> {
  if (catalogue) return Promise.resolve(catalogue);
  inFlight ??= api<{ openings?: OpeningTemplate[] }>('/api/openings')
    .then((body) => {
      catalogue = body.openings ?? [];
      return catalogue;
    })
    .catch(() => {
      inFlight = null;
      return [];
    });
  return inFlight;
}

/**
 * Opening picker: the curated spread when idle, the ENTIRE ECO catalogue
 * (served from the vendored lichess chess-openings set) as soon as you type.
 * A combobox rather than a Select — 3,800 openings need a filter, not a list.
 *
 * Touch gets a different shape: an inline input under the board sits exactly
 * where the keyboard lands, so tapping it hid everything (lanph3re's report).
 * On coarse pointers the trigger is a plain button and the search opens as a
 * sheet pinned to the TOP of the viewport — visible above any keyboard, and
 * nothing on the page is scripted to scroll while it animates.
 */
/**
 * Pick an opening to spar from.
 *
 * Two shapes for two pointers. On a phone it is the app's own sheet —
 * rising from the bottom with the drag, the scrim and the Escape every
 * other window has. On a desktop it is shadcn's Popover: the list drops
 * anchored under the field itself (portalled past the Panel's clipping,
 * placed inside the window by Radix, flipping above only when below has
 * no room), capped in height with the search pinned above the scroll —
 * so the board stays on screen while an opening is being chosen, instead
 * of disappearing behind a centred card. lanph3re's report: the modal
 * covered the board and broke the visual context.
 */
export function OpeningPicker({
  value,
  onChange,
}: {
  value: OpeningTemplate;
  onChange: (tpl: OpeningTemplate) => void;
}) {
  const [all, setAll] = useState<OpeningTemplate[] | null>(() => catalogue);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  // The popover on a desktop, the sheet on a phone — decided live, the
  // way every other two-shaped control here decides.
  const wide = useMediaQuery('(min-width: 40rem)');

  useEffect(() => {
    let cancelled = false;
    void loadCatalogue().then((list) => {
      if (!cancelled) setAll(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Rendered at once. The catalogue is thousands of entries, and building
      that many buttons to open a list costs most of a second. */
  const SHOWN = 300;

  const { matches, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    // An empty box offers the whole catalogue, ordered by ECO, with the
    // curated few first — so the picker can be browsed and not only
    // searched.
    const pool = q
      ? (all ?? []).filter(
          (o) => o.eco.toLowerCase().startsWith(q) || o.name.toLowerCase().includes(q),
        )
      : [...TEMPLATES, ...(all ?? []).filter((o) => !TEMPLATES.some((tpl) => tpl.name === o.name))];
    return { matches: pool.slice(0, SHOWN), hidden: Math.max(0, pool.length - SHOWN) };
  }, [query, all]);

  const pick = (o: OpeningTemplate): void => {
    onChange(o);
    setOpen(false);
  };

  const setOpenFresh = (next: boolean): void => {
    if (next) setQuery('');
    setOpen(next);
  };

  const trigger = (
    <button
      type="button"
      onClick={wide ? undefined : () => setOpenFresh(!open)}
      className={cn(
        // The Input face from the source, not a hand copy of it — the
        // trigger reads as the field it opens into.
        INPUT_BASE,
        'text-foreground flex h-9 min-w-0 items-center px-2.5 text-left duration-100',
        'hover:border-primary/40',
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {/* t() so "Start position" translates; real opening names are
            proper nouns and pass through untouched. */}
        {value.eco ? `${value.eco}  ${value.name}` : t(value.name)}
      </span>
    </button>
  );

  const body = ((): { searchBox: React.ReactNode; list: React.ReactNode } => {
          // One search box and one list, whichever container they open in.
          // A real SearchInput: it filters the list live, so it gets the
          // X and Cancel every other live filter carries. Desktop-only
          // autofocus, per the search-field rule — on a phone the sheet
          // opens to browse the list, not with a keyboard over it.
          const searchBox = (
            <SearchInput
              autoFocus={autoFocusField()}
              inputSize="sm"
              className="w-full"
              value={query}
              placeholder={t('Search any opening or ECO code…')}
              onChange={(e) => setQuery(e.target.value)}
            />
          );
          // The container owns the height; the list scrolls inside it
          // rather than growing past the keyboard (sheet) or the
          // viewport (popover).
          const list = (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {matches.length === 0 ? (
                <li className="text-muted-foreground px-2 py-1.5 text-sm">
                  {all === null ? t('Reading the catalogue…') : t('No opening matches that.')}
                </li>
              ) : (
                matches.map((o, i) => (
                  <li key={`${o.eco}-${o.name}-${i}`} className="[content-visibility:auto]">
                    <button
                      type="button"
                      onClick={() => pick(o)}
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        'hover:bg-accent transition-colors duration-100 pointer-coarse:py-2.5',
                        o.name === value.name && o.eco === value.eco
                          ? 'text-primary font-medium'
                          : 'text-foreground',
                      )}
                    >
                      {o.eco && (
                        <span className="text-muted-foreground w-7 shrink-0 font-mono text-xs">
                          {o.eco}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{t(o.name)}</span>
                    </button>
                  </li>
                ))
              )}
              {hidden > 0 && (
                <li className="text-muted-foreground px-2 py-1.5 text-xs">
                  {t('{count} more — type to narrow.', { count: hidden.toLocaleString() })}
                </li>
              )}
            </ul>
          );

          return { searchBox, list };
        })();

  if (!wide) {
    return (
      <>
        {trigger}
        {open && (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
          >
            <DialogContent size="sm" title={t('Opening')} className="gap-2">
              {body.searchBox}
              {body.list}
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }

  // As wide as the field, and never so narrow that a name is unreadable;
  // 384 is as tall as this wants to be, less where the room is less, and
  // the catalogue scrolls inside it. Radix's popper publishes both numbers.
  return (
    <Popover open={open} onOpenChange={setOpenFresh}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        collisionPadding={12}
        aria-label={t('Opening')}
        className="flex w-[max(var(--anchor-width),18rem)] max-h-[min(24rem,var(--available-height))] flex-col gap-0 overflow-hidden p-0"
      >
        {/* Above the scroll, not inside it: the search stays put while the
            catalogue scrolls under it. */}
        <div className="border-border shrink-0 border-b p-2">{body.searchBox}</div>
        <div className="flex min-h-0 flex-1 flex-col p-1">{body.list}</div>
      </PopoverContent>
    </Popover>
  );
}
