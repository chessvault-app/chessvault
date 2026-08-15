import { BookOpen, ChevronLeft, Library, NotebookPen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pgnToChapters } from '@shared/pgn';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/Button';
import { SearchInput } from '@/ui/Input';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import type { MapTag } from './model';

/**
 * Picking what a node points at: a study (optionally one chapter of it)
 * or a note. Listings come from the metadata routes the shelves already
 * use; the study itself is fetched only when the user asks to scope a
 * tag to one chapter, because the listing's chapterNames are a card
 * caption, capped at four, not a table of contents.
 */

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
  const [kind, setKind] = useState<'study' | 'note'>('study');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Record<'study' | 'note', Row[] | null>>({
    study: null,
    note: null,
  });
  /** A study whose chapter is being chosen, with its full chapter list. */
  const [scoping, setScoping] = useState<{ id: string; chapters: string[] } | null>(null);

  useEffect(() => {
    if (rows[kind] !== null) return;
    let live = true;
    void (async () => {
      const base = kind === 'study' ? 'studies' : 'notes';
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
    <Sheet label={t('Add a tag')} onClose={onClose}>
      {scoping === null ? (
        <>
          <div className="flex items-center gap-2">
            <Segmented
              value={kind}
              onChange={setKind}
              segments={[
                { value: 'study', label: t('Studies') },
                { value: 'note', label: t('Notes') },
              ]}
              ariaLabel="Tag kind"
            />
            <SearchInput
              className="flex-1"
              placeholder={t('Filter…')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {rows[kind] === null ? null : list.length === 0 ? (
              <p className="text-muted px-1 py-4 text-center text-xs">
                {t('Nothing here matches.')}
              </p>
            ) : (
              list.map((row) => {
                const wholeTag: MapTag = { kind, id: row.id };
                const Icon = kind === 'study' ? Library : NotebookPen;
                return (
                  <div key={row.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={tagged(wholeTag)}
                      onClick={() => onPick(wholeTag)}
                      className="hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-45"
                    >
                      <Icon className="text-muted size-4 shrink-0" />
                      <span className="text-fg min-w-0 flex-1 truncate text-sm">{row.id}</span>
                      {tagged(wholeTag) && (
                        <span className="text-subtle shrink-0 text-xs">{t('Tagged')}</span>
                      )}
                    </button>
                    {kind === 'study' && (row.chapters ?? 1) > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={t('Tag one chapter')}
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
            <p className="text-fg min-w-0 truncate text-sm font-medium">{scoping.id}</p>
          </div>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {scoping.chapters.map((name) => {
              const tag: MapTag = { kind: 'study', id: scoping.id, chapter: name };
              return (
                <button
                  key={name}
                  type="button"
                  disabled={tagged(tag)}
                  onClick={() => onPick(tag)}
                  className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-45"
                >
                  <BookOpen className="text-muted size-4 shrink-0" />
                  <span className="text-fg min-w-0 flex-1 truncate text-sm">{name}</span>
                  {tagged(tag) && <span className="text-subtle shrink-0 text-xs">{t('Tagged')}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
