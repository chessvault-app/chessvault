import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FilePicker } from '@/components/file-picker';
import { Inert } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The PDF importer's first screen, outside the importer's lazy chunk.
 *
 * The window is lazy because the page scanner is heavy, and its fallback
 * was four generic bars: measured on a 1280x900 desktop, a 232px window
 * replaced by a 782px one. But the first screen is a form whose every
 * word is known before the chunk lands (only the count of puzzles the
 * book holds varies, and the page has that). So its pieces live here,
 * the importer draws them, and the fallback draws the same pieces inert
 * at the importer's own defaults.
 */
export type ImportMode = 'update' | 'rebuild';

export function ExistingChoice({
  existing,
  mode,
  onMode,
}: {
  existing: number;
  mode: ImportMode;
  onMode: (mode: ImportMode) => void;
}) {
  return (
    <div className="border-card-ring bg-muted flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-foreground text-sm font-medium">
        {t('This book already holds {n} puzzles. What should the import do with them?', {
          n: existing,
        })}
      </p>
      <RadioGroup value={mode} onValueChange={(v) => onMode(v as ImportMode)}>
        {(
          [
            ['update', 'Update in place', 'Re-reads the book and replaces each puzzle with what it finds. Anything the import misses this time is left as it is.'],
            ['rebuild', 'Clear and rebuild', 'Empties the book first, so it holds exactly what this import produces. Your attempt history is kept either way.'],
          ] as const
        ).map(([value, label, blurb]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2">
            {/* mt-0.5 lines the dot up with the first line of the label;
                on iOS the mark is a checkmark centred on the whole row. */}
            <RadioGroupItem value={value} className="mt-0.5 ios:mt-0" />
            <span className="text-base">
              {t(label)}
              <span className="text-muted-foreground block text-sm">{t(blurb)}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

function Option({
  checked,
  onChange,
  title,
  blurb,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  blurb: string;
}) {
  return (
    <label className="text-muted-foreground flex cursor-pointer items-start gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on === true)} className="mt-0.5" />
      <span>
        {title}
        <span className="text-muted-foreground block">{blurb}</span>
      </span>
    </label>
  );
}

type OptionProps = { checked: boolean; onChange: (on: boolean) => void };

export function EngineOption(props: OptionProps) {
  return (
    <Option
      {...props}
      title={t('Ask the engine where the book cannot be read')}
      blurb={t(
        'Searches positions whose printed solution would not replay, and imports them labelled by how much is known. Adds a few seconds per hundred.',
      )}
    />
  );
}

export function RepairOption(props: OptionProps) {
  return (
    <Option
      {...props}
      title={t('Try harder on boards that fail')}
      blurb={t(
        'Re-reads each position whose printed solution would not replay, looking for one misread square. Recovered about 26 more puzzles on a 1,000-puzzle book, and takes longer.',
      )}
    />
  );
}

export function PdfPicker({
  onFile,
  dragging,
  ...handlers
}: {
  onFile: (file: File) => void;
  dragging: boolean;
} & Omit<ComponentProps<typeof FilePicker>, 'accept' | 'onFiles' | 'className'>) {
  return (
    <FilePicker
      accept="application/pdf"
      onFiles={([file]) => {
        if (file) onFile(file);
      }}
      {...handlers}
      className={cn(
        'grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center',
        'transition-colors',
        dragging ? 'border-primary bg-muted' : 'border-border hover:border-border hover:bg-accent',
      )}
    >
      <span className="text-muted-foreground text-base">
        {t('Choose the book’s PDF')}
        <span className="text-muted-foreground block text-sm">
          {t('every page is scanned for diagrams; nothing leaves this device, and you can keep using the app while it runs')}
        </span>
      </span>
    </FilePicker>
  );
}

/**
 * Copyright, said where the decision is actually made.
 * The reader only ever opens a file it was handed and nothing it
 * produces leaves the machine, but a scan of a book still in copyright
 * is a copy of it, and that belongs next to the picker rather than only
 * in a README nobody opens on the way here.
 */
export function OwnershipNote() {
  return (
    <p className="border-card-ring bg-muted text-muted-foreground rounded-lg border p-3 text-sm">
      <span className="text-muted-foreground font-medium">{t('Import only a book you own.')}</span>{' '}
      {t(
        'Crops, page images and solutions stay in your vault and are never published. They remain the publisher’s copyright, and copying or sharing them may not be allowed where you live.',
      )}
    </p>
  );
}

const NOOP = (): void => {};

/**
 * The first screen while the importer is on the wire, at the importer's
 * own defaults: update in place, the engine on, the harder read off.
 * `WindowOpening` stacks its body on gap-3 and the window's card is
 * gap-4, so the rhythm is restated on a box of its own. The footer is
 * the importer's: mt-1, one ghost Cancel.
 *
 * A scan already running for this book draws a different first screen,
 * and is not drawn here: a running scan was started from this chunk, so
 * the chunk is already loaded and this fallback never shows.
 */
export function PdfImportOpening({ existing }: { existing: number }) {
  return (
    <Inert>
      <div className="flex flex-col gap-4">
        {existing > 0 && <ExistingChoice existing={existing} mode="update" onMode={NOOP} />}
        <EngineOption checked onChange={NOOP} />
        <RepairOption checked={false} onChange={NOOP} />
        <PdfPicker onFile={NOOP} dragging={false} />
        <OwnershipNote />
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm">
            {t('Cancel')}
          </Button>
        </div>
      </div>
    </Inert>
  );
}
