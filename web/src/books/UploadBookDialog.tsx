import { BookText, Loader2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiErrorMessage } from '@/lib/api';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { inspectPdf } from '@/puzzles/ocr/pdfPage';

import { MAX_PDF_BYTES, suggestTitle, uploadBook } from './data';
import { fileSize } from './BooksPage';

/**
 * Adding a book to the library — the same window shape as the puzzle
 * importer's: one dashed box to choose or drop the PDF into, then what
 * was picked shown back before anything is uploaded: its first page, a
 * title to keep or change, its page count and size. Nothing leaves the
 * machine until "Add to library"; a wrong file is one Cancel away.
 *
 * Opened with a file already in hand (a PDF dropped on the shelf) it
 * skips straight to the confirmation.
 */
export function UploadBookDialog({
  initialFile,
  onClose,
  onUploaded,
}: {
  initialFile?: File | null;
  onClose: () => void;
  /** The new book's id, once it is on the shelf. */
  onUploaded: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [looked, setLooked] = useState<{ pages: number; cover: string | null } | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // Open the picked file once: its page count proves it is a PDF, its
  // first page is the cover shown here and kept on the shelf.
  useEffect(() => {
    if (!file) return;
    let live = true;
    setLooked(null);
    setError(null);
    if (file.size > MAX_PDF_BYTES) {
      setError(t('That PDF is too big — the limit is {mb} MB.', { mb: MAX_PDF_BYTES / (1024 * 1024) }));
      setFile(null);
      return;
    }
    setTitle(suggestTitle(file) ?? t('Untitled book'));
    void inspectPdf(file).then((got) => {
      if (!live) return;
      if (got.pages === 0) {
        setError(t('That file could not be read as a PDF.'));
        setFile(null);
        return;
      }
      setLooked(got);
    });
    return () => {
      live = false;
    };
  }, [file]);

  const drop = useFileDrop({
    accept: byExtension('.pdf'),
    onFiles: ([first]) => setFile(first ?? null),
    onReject: () => setError(t('Drop a PDF here.')),
  });

  const upload = async (): Promise<void> => {
    if (!file || !looked) return;
    setProgress(0);
    try {
      const id = await uploadBook(file, {
        title: title.trim() || t('Untitled book'),
        inspected: looked,
        onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
      });
      onUploaded(id);
    } catch (e) {
      setError(apiErrorMessage(e));
      setProgress(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && progress === null) onClose();
      }}
    >
      <DialogContent title={t('Add a book')} icon={Upload}>
        {!file ? (
          <label
            {...drop.handlers}
            className={cn(
              'grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors',
              drop.dragging ? 'border-primary bg-muted' : 'border-border hover:bg-accent',
            )}
          >
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = '';
                if (picked) setFile(picked);
              }}
            />
            <span className="text-muted-foreground text-base">
              {t('Choose the book’s PDF')}
              <span className="text-muted-foreground block text-sm">
                {t('any chess book — it is kept in your vault and read here, beside a board')}
              </span>
            </span>
          </label>
        ) : (
          <div className="flex gap-4">
            {looked?.cover ? (
              <img
                src={looked.cover}
                alt=""
                className="border-border h-40 w-[7.5rem] shrink-0 rounded-md border object-cover object-top"
              />
            ) : (
              <span className="bg-muted/50 border-border grid h-40 w-[7.5rem] shrink-0 place-items-center rounded-md border">
                {looked ? (
                  <BookText className="text-muted-foreground size-6" />
                ) : (
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                )}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-sm">{t('Book title')}</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && looked && progress === null) void upload();
                  }}
                />
              </label>
              <p className="text-muted-foreground truncate text-sm" title={file.name}>
                {file.name}
              </p>
              <p className="text-muted-foreground text-sm">
                {looked
                  ? `${t('{n} pages', { n: looked.pages })} · ${fileSize(file.size)}`
                  : t('Opening…')}
              </p>
              {progress !== null && (
                <p className="text-primary flex items-center gap-2 text-sm">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('Uploading… {pct}%', { pct: progress })}
                </p>
              )}
            </div>
          </div>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          {file && progress === null && (
            <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
              {t('Choose another')}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={progress !== null} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!file || !looked || progress !== null}
            onClick={() => void upload()}
          >
            {t('Add to library')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
