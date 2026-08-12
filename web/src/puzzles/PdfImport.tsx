import { FileUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { useImportJob } from './importJob';
import type { Template } from './ocr/classify';
import { t } from '@/lib/i18n';

/**
 * Whole-book import (lanph3re's original ask): pick the book's PDF, every
 * page is rendered and scanned for diagrams, and the crops land on the book
 * as DRAFTS — each waiting for its solution.
 *
 * The scan itself is a BACKGROUND JOB (importJob.ts): closing this dialog
 * or browsing elsewhere doesn't stop it, classification runs in a worker,
 * and the book page shows live progress with a way back here.
 */
export function PdfImport({
  slug,
  templates,
  existing,
  onDone,
  onClose,
}: {
  slug: string;
  templates: Template[];
  /** Puzzles and drafts already in the book — 0 means a first import. */
  existing: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const job = useImportJob();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Re-importing a book that already has content is a real choice, so it
  // is asked rather than assumed. Imported puzzles are keyed by their
  // printed number, so updating in place genuinely updates them.
  const [mode, setMode] = useState<'update' | 'rebuild'>('update');
  const [repair, setRepair] = useState(false);
  const [preparing, setPreparing] = useState(false);

  const begin = async (file: File): Promise<void> => {
    setSaveError(null);
    if (existing > 0 && mode === 'rebuild') {
      setPreparing(true);
      try {
        const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`could not clear the book (${res.status})`);
      } catch (e) {
        setSaveError((e as Error).message);
        setPreparing(false);
        return;
      }
      setPreparing(false);
    }
    job.start(slug, file, templates, { repair });
  };
  const mine = job.slug === slug;
  const found = mine ? job.found : [];
  const scanning = mine && job.status === 'scanning';
  const reading = mine && job.status === 'reading';
  const solve = mine ? job.solve : null;

  const save = async (): Promise<void> => {
    const chosen = found.filter((f) => f.selected);
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      // Chunked: hundreds of crops would make one giant request body.
      for (let at = 0; at < chosen.length; at += 20) {
        const chunk = chosen.slice(at, at + 20);
        const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            drafts: chunk.map((f) => ({ image: f.dataUrl, fen: f.fen })),
          }),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
      }
      job.clear();
      onDone();
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(false);
    }
  };

  const selectedCount = found.filter((f) => f.selected).length;

  return (
    <Modal
      title="Import a book PDF"
      icon={FileUp}
      onClose={onClose}
      className="max-w-[44rem]"
    >

        {!mine && existing > 0 && (
          <div className="border-line bg-surface-2 flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-fg text-xs font-medium">
              {t('This book already holds {n} puzzles. What should the import do with them?', {
                n: existing,
              })}
            </p>
            {(
              [
                ['update', 'Update in place', 'Re-reads the book and replaces each puzzle with what it finds. Anything the import misses this time is left as it is.'],
                ['rebuild', 'Clear and rebuild', 'Empties the book first, so it holds exactly what this import produces. Your attempt history is kept either way.'],
              ] as const
            ).map(([value, label, blurb]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="reimport-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  {t(label)}
                  <span className="text-subtle block text-xs">{t(blurb)}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {!mine && (
          <label className="text-muted flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={repair}
              onChange={(e) => setRepair(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('Try harder on boards that fail')}
              <span className="text-subtle block">
                {t(
                  'Re-reads each position whose printed solution would not replay, looking for a single misread square. On a 1,000-puzzle book this recovered about 26 more puzzles and took twenty minutes.',
                )}
              </span>
            </span>
          </label>
        )}

        {!mine && (
          <label className="border-line hover:border-line-strong hover:bg-surface-2 grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void begin(file);
              }}
            />
            <span className="text-muted text-sm">
              {t('Choose the book’s PDF')}
            <span className="text-subtle block text-xs">
                {t('every page is scanned for diagrams; nothing leaves this machine — and you can keep using the app while it runs')}
              </span>
            </span>
          </label>
        )}

        {preparing && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('clearing the book')}
          </p>
        )}
        {scanning && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('page {page}/{pages} — {n} diagrams so far', {
              page: job.page,
              pages: job.pages || '…',
              n: found.length,
            })}
          </p>
        )}
        {reading && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("reading the book’s solutions")}
          </p>
        )}
        {solve && (
          <div
            className={cn(
              'rounded-lg border p-3 text-xs',
              solve.confident ? 'border-good/40 bg-good/5' : 'border-warn/40 bg-warn/5',
            )}
          >
            <p className="text-fg text-sm font-medium">
              {t('{n} puzzles imported with their solutions', { n: solve.solved })}
            </p>
            <p className="text-muted pt-1">
              {solve.confident
                ? t('Each one replays the move the book prints, from the position on the page.')
                : t(
                    'Too few solutions replayed for this to be trusted — treat these as a starting point and check them.',
                  )}
              {solve.repaired > 0 &&
                ` ${t('{n} had a square misread, found by the book’s own solution.', { n: solve.repaired })}`}
              {solve.unresolved > 0 &&
                ` ${t('{n} numbered diagrams had no solution we could read.', { n: solve.unresolved })}`}
            </p>
            <p className="text-subtle pt-1">
              {t('Answers found on {pages}.', {
                pages:
                  solve.answerRanges.length > 0
                    ? solve.answerRanges
                        .map(([a, b]) => (a === b ? `p.${a}` : `p.${a}–${b}`))
                        .join(', ')
                    : t('no page we could identify'),
              })}
            </p>
          </div>
        )}
        {mine && job.error && <p className="text-bad text-xs">{job.error}</p>}
        {saveError && <p className="text-bad text-xs">{saveError}</p>}

        {found.length > 0 && (
          <>
            <p className="text-subtle text-xs">
              {t('{n} diagrams found — untick any false positives, then add the rest as drafts.', {
                n: found.length,
              })}
              {found.every((f) => f.fen === null) &&
                ` ${t('Positions are unread for now: confirming the first draft teaches this book’s font.')}`}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {found.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => job.toggle(i)}
                  className={cn(
                    'relative rounded-lg border p-1 transition-colors [content-visibility:auto]',
                    f.selected ? 'border-primary/60' : 'border-line opacity-40',
                  )}
                >
                  <img src={f.dataUrl} alt={`page ${f.page}`} className="w-full rounded" />
                  <span className="text-subtle block pt-0.5 text-[0.625rem]">
                    {f.number === undefined ? `p.${f.page}` : `#${f.number}`}
                    {f.solved && <span className="text-good ml-1">{t('solved')}</span>}
                    {!f.solved && f.fen !== null && (
                      <span className={cn('ml-1', f.uncertain > 0 ? 'text-warn' : 'text-good')}>
                        {f.uncertain > 0 ? t('{n} unsure', { n: f.uncertain }) : t('read')}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* The footer is NOT part of the results: it used to be, so a window
            that had not scanned anything yet — or was still scanning its
            first page — had no button at all, and no X either. Cancel is
            always here; Add appears once there is something to add. */}
        <div className="flex items-center justify-end gap-2">
          {found.length > 0 && (
            <span className="text-subtle mr-auto text-xs">
              {t('{n} selected', { n: selectedCount })}
              {scanning ? t(' — still scanning') : ''}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            title={scanning ? t('The scan keeps running') : undefined}
            onClick={onClose}
          >
            {t(scanning ? 'Hide' : 'Cancel')}
          </Button>
          {found.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={saving || scanning || selectedCount === 0}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {t('Add {n} as drafts', { n: selectedCount })}
            </Button>
          )}
        </div>
    </Modal>
  );
}
