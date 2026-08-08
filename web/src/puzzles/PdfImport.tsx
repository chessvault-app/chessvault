import { FileUp, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { useImportJob } from './importJob';
import type { Template } from './ocr/classify';

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
  onDone,
  onClose,
}: {
  slug: string;
  templates: Template[];
  onDone: () => void;
  onClose: () => void;
}) {
  const job = useImportJob();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mine = job.slug === slug;
  const found = mine ? job.found : [];
  const scanning = mine && job.status === 'scanning';

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="bg-surface border-line flex max-h-full w-full max-w-[44rem] flex-col gap-3 overflow-y-auto rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <FileUp className="text-subtle size-4" />
          <h2 className="text-fg flex-1 text-sm font-semibold">Import a book PDF</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            title={scanning ? 'Close — the scan keeps running' : 'Close'}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {!mine && (
          <label className="border-line hover:border-line-strong hover:bg-surface-2 grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) job.start(slug, file, templates);
              }}
            />
            <span className="text-muted text-sm">
              Choose the book&rsquo;s PDF
              <span className="text-subtle block text-xs">
                every page is scanned for diagrams; nothing leaves this machine — and you can
                keep using the app while it runs
              </span>
            </span>
          </label>
        )}

        {scanning && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            page {job.page}/{job.pages || '…'} — {found.length} diagrams so far
          </p>
        )}
        {mine && job.error && <p className="text-bad text-xs">{job.error}</p>}
        {saveError && <p className="text-bad text-xs">{saveError}</p>}

        {found.length > 0 && (
          <>
            <p className="text-subtle text-xs">
              {found.length} diagram{found.length === 1 ? '' : 's'} found — untick any false
              positives, then add them as drafts.
              {found.every((f) => f.fen === null) &&
                ' Positions are unread for now: confirming the first draft teaches this book’s font.'}
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
                    p.{f.page}
                    {f.fen !== null && (
                      <span className={cn('ml-1', f.uncertain > 0 ? 'text-warn' : 'text-good')}>
                        {f.uncertain > 0 ? `${f.uncertain} unsure` : 'read'}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="text-subtle mr-auto text-xs">
                {selectedCount} selected{scanning ? ' — still scanning' : ''}
              </span>
              <Button variant="ghost" size="sm" onClick={onClose}>
                {scanning ? 'Hide' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={saving || scanning || selectedCount === 0}
                onClick={() => void save()}
              >
                {saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                Add {selectedCount} as drafts
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
