import { BookOpen, ChevronLeft, Library, NotebookPen, Swords } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pgnToChapters } from '@shared/pgn';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/text-fields';
import { Segmented } from '@/components/segmented';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import type { MapTag } from './model';

/**
 * Picking what a node points at: a study (optionally one chapter of it),
 * a collected game, or a note. Listings come from the metadata routes the
 * shelves already use; the study itself is fetched only when the user asks
 * to scope a tag to one chapter, because the listing's chapterNames are a
 * card caption, capped at four, not a table of contents.
 *
 * A game is a one-chapter study living in games/collection/, so it speaks
 * the same document API and needs nothing here but its own base path — and
 * no Chapter button, because there is never a second chapter to scope to.
 */

/** Where each kind's listing lives, and what its rows wear. */
const KINDS = {
  game: { base: 'games/docs', icon: Swords, search: 'Search games…' },
  study: { base: 'studies', icon: Library, search: 'Search studies…' },
  note: { base: 'notes', icon: NotebookPen, search: 'Search notes…' },
} as const;

type Kind = keyof typeof KINDS;

interface Row {
  id: string;
  chapters?: number;
}

export function TagPicker({
  existing,
  onPick,
  onClose,
}: {
  existing: MapTag[];
  onPick: (tag: MapTag) => void;
  onClose: () => void;
}) {
  // Games, matching the leftmost segment: the picker opens on what a node
  // most often wants tagged, and a control whose first segment is not the
  // selected one asks the reader to check which of the two is lying.
  const [kind, setKind] = useState<Kind>('game');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Record<Kind, Row[] | null>>({
    study: null,
    game: null,
    note: null,
  });
  /** A study whose chapter is being chosen, with its full chapter list. */
  const [scoping, setScoping] = useState<{ id: string; chapters: string[] } | null>(null);
  /**
   * Behind the threshold, unlike the placeholders that hold a block's
   * PLACE: this list lives in a grown, scrolling box, so rows filling it
   * move nothing around them. Nothing to shove means a wait too short to
   * notice is best not mentioned — and against a local vault most of
   * them are.
   */
  const listPending = useSlowLoad(rows[kind] === null);

  useEffect(() => {
    if (rows[kind] !== null) return;
    let live = true;
    void (async () => {
      const { base } = KINDS[kind];
      const body = await api<{ studies: { id: string; chapters: number }[] }>(`/api/${base}`);
      if (live) {
        setRows((r) => ({
          ...r,
          [kind]: body.studies.map(({ id, chapters }) => ({ id, chapters })),
        }));
      }
    })().catch(() => {
      if (live) setRows((r) => ({ ...r, [kind]: [] }));
    });
    return () => {
      live = false;
    };
  }, [kind, rows]);

  const list = useMemo(() => {
    const all = rows[kind] ?? [];
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter((r) => r.id.toLowerCase().includes(needle)) : all;
  }, [rows, kind, filter]);

  const tagged = (tag: MapTag): boolean =>
    existing.some(
      (e) => e.kind === tag.kind && e.id === tag.id && (e.chapter ?? '') === (tag.chapter ?? ''),
    );

  const openScoping = async (id: string): Promise<void> => {
    try {
      const { pgn } = await api<{ pgn: string }>(`/api/studies/${encodeURIComponent(id)}`);
      setScoping({ id, chapters: pgnToChapters(pgn).map((c) => c.name) });
    } catch {
      // The listing said it exists; a race deleting it just means no tag.
    }
  };

  return (
    // `fill`: this is a PAGE of the details sheet it opens over — pick
    // what this node points at — so it takes that sheet's height rather
    // than shrinking to its own list and reading as a second, smaller
    // window stacked on the first. The same call AddMoveDialog makes.
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" title={t('Link a game, study or note')} fill>
        {scoping === null ? (
          <>
            <div className="flex items-center gap-2">
              <Segmented
                value={kind}
                onChange={setKind}
                segments={[
                  { value: 'game', label: t('Games') },
                  { value: 'study', label: t('Studies') },
                  { value: 'note', label: t('Notes') },
                ]}
                ariaLabel="What to link"
                kind="tabs"
              />
              <SearchInput
                className="flex-1"
                // "Search studies", not "Filter": it wears a magnifier, it
                // sits where every other search field in the app sits, and
                // it does what they do — a field that looks like one thing
                // and is labelled another makes the reader decide which to
                // believe. Naming what it searches is the shelves' own
                // wording, and it follows the segmented control, which is
                // the only thing that says which list is under it.
                placeholder={t(KINDS[kind].search)}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            {/* Grows into whatever the sheet has, capped only where the
                sheet is a window rather than a page: on a phone `fill` has
                made the card as tall as its parent, and a list that stopped
                at 20rem would leave the bottom third of it empty. */}
            <div className="flex min-h-0 grow flex-col gap-1 overflow-y-auto sm:max-h-80">
              {rows[kind] === null ? (
                // The shelf that is coming: an icon beside a name, on the
                // same 36px row the real ones keep so the list does not
                // re-space itself as it lands.
                listPending ? (
                  <div role="status" aria-label={t('Loading')} aria-live="polite">
                    {['w-2/5', 'w-3/5', 'w-1/2', 'w-2/3', 'w-5/12', 'w-1/2'].map((w, i) => (
                      <div key={i} className="flex min-h-9 items-center gap-1">
                        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                          <Skeleton className="size-4 shrink-0 rounded-sm" />
                          <Skeleton className={`h-3 ${w}`} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null
              ) : list.length === 0 ? (
                <p className="text-muted-foreground px-2 py-4 text-center text-sm">
                  {t('Nothing here matches.')}
                </p>
              ) : (
                list.map((row) => {
                  const wholeTag: MapTag = { kind, id: row.id };
                  const Icon = KINDS[kind].icon;
                  return (
                    // One height for every row, whether or not it carries
                    // a Chapter button: a study row stood a touch target
                    // taller than a note row, so switching the segmented
                    // control above shuffled the whole list's rhythm.
                    <div key={row.id} className="flex min-h-9 items-center gap-1">
                      <button
                        type="button"
                        disabled={tagged(wholeTag)}
                        onClick={() => onPick(wholeTag)}
                        className="hover:bg-accent flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-45"
                      >
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                        <span className="text-foreground min-w-0 flex-1 truncate text-base">{row.id}</span>
                        {tagged(wholeTag) && (
                          <span className="text-subtle shrink-0 text-sm">{t('Linked')}</span>
                        )}
                      </button>
                      {kind === 'study' && (row.chapters ?? 1) > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t('Link one chapter')}
                          onClick={() => void openScoping(row.id)}
                        >
                          <BookOpen className="size-3.5" /> {t('Chapter')}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon-sm" title={t('Back')} onClick={() => setScoping(null)}>
                <ChevronLeft className="size-3.5" />
              </Button>
              <p className="text-foreground min-w-0 truncate text-base font-medium">{scoping.id}</p>
            </div>
            <div className="flex min-h-0 grow flex-col gap-1 overflow-y-auto sm:max-h-80">
              {scoping.chapters.map((name) => {
                const tag: MapTag = { kind: 'study', id: scoping.id, chapter: name };
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={tagged(tag)}
                    onClick={() => onPick(tag)}
                    className="hover:bg-accent flex items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-45"
                  >
                    <BookOpen className="text-muted-foreground size-4 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate text-base">{name}</span>
                    {tagged(tag) && <span className="text-subtle shrink-0 text-sm">{t('Linked')}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
