import { ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Inert } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The picture flow's first screen, outside the flow's lazy chunk.
 *
 * Every way into the flow hands it a picture, so what lands is always the
 * same screen: one line of instruction, the picture with its handles, a
 * switch, and Cancel beside Read position. The fallback was four
 * generic bars. Measured on a 1280x900 desktop: a 290px window replaced
 * by a 604px one. The words and the controls live here so the flow and
 * its fallback draw the same ones.
 */
export function QuadHint() {
  return (
    <p className="text-muted-foreground text-sm">
      {t('Drag the four handles onto the corners of the diagram.')}
    </p>
  );
}

export function BlackAtBottom({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    // A lone boolean is a switch (lanph3re, 2026-09-21). No settings-row
    // frame here: this sits loose under the picture it describes, with no
    // blurb and nothing above or below it to line a boxed row up with, so
    // it keeps the flow's own row and only moves the control to the right
    // where a switch belongs. The label still wraps it, so the words are
    // its name and toggle it.
    <label className="text-muted-foreground flex cursor-pointer items-center justify-between gap-3 text-sm">
      {t('Black at the bottom')}
      <Switch checked={checked} onCheckedChange={(on) => onChange(on)} />
    </label>
  );
}

/** The corner row's frame. mt-auto sinks it in a sheet taller than its
    content; embedded, the row follows the content instead. */
export function PhotoFooter({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return <div className={cn('flex justify-end gap-2 pt-1', !embedded && 'mt-auto')}>{children}</div>;
}

export function ReadButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="default" size="sm" onClick={onClick}>
      <ScanSearch className="glyph" data-icon="inline-start" />
      {t('Read position')}
    </Button>
  );
}

const NOOP = (): void => {};

/**
 * The screen while the flow is on the wire. The picture's size is the one
 * thing not known here: the flow fits it inside 560 by 480 and the card's
 * own width, which for a square picture (a diagram nearly always is one)
 * comes to a square as wide as the card, 480 at most. So that is the
 * block drawn. A wide screenshot lands shorter than this and the window
 * closes up by the difference, which is the part of the drift that needs
 * the picture decoded to remove.
 *
 * gap-4 restated: `WindowOpening` and `WindowPageOpening` stack on gap-3
 * and both hosts of the real flow are gap-4.
 */
export function PhotoImportOpening({ embedded = false }: { embedded?: boolean }) {
  return (
    <Inert>
      <div className="flex flex-col gap-4">
        <QuadHint />
        <Skeleton className="mx-auto aspect-square w-full max-w-[480px] rounded-md" />
        <BlackAtBottom checked={false} onChange={NOOP} />
        <PhotoFooter embedded={embedded}>
          <Button variant="ghost" size="sm">
            {t('Cancel')}
          </Button>
          <ReadButton onClick={NOOP} />
        </PhotoFooter>
      </div>
    </Inert>
  );
}
