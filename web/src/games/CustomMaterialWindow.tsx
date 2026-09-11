import { ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';

/**
 * The custom material editor, in a file of its own so that the endgame
 * drill can ask the same question the games hunt asks. One editor, one
 * vocabulary: a spec built here is a spec the server's parser takes
 * (shared/scanMatch.ts), whichever page opens the window.
 */

/**
 * The custom material editor's vocabulary: per piece, per side, one of
 * a curated set of count ranges rather than two bare number fields —
 * every real question ("no queens", "exactly one rook", "a pair of
 * knights at most") is one pick, and an impossible range (min above
 * max) cannot be built at all. '2+' is open-ended: the spec's ceiling
 * is 10, past any promotion spree worth searching for.
 */
const RANGE_CHOICES: { id: string; label: string; range: [number, number] | null }[] = [
  { id: 'any', label: 'Any', range: null },
  { id: '0', label: '0', range: [0, 0] },
  { id: '1', label: '1', range: [1, 1] },
  { id: '2', label: '2', range: [2, 2] },
  { id: '0-1', label: '0–1', range: [0, 1] },
  { id: '1-2', label: '1–2', range: [1, 2] },
  { id: '2+', label: '2+', range: [2, 10] },
];

const PIECES: { letter: 'p' | 'n' | 'b' | 'r' | 'q'; label: string }[] = [
  { letter: 'p', label: 'Pawns' },
  { letter: 'n', label: 'Knights' },
  { letter: 'b', label: 'Bishops' },
  { letter: 'r', label: 'Rooks' },
  { letter: 'q', label: 'Queens' },
];

export type CustomDraft = Record<'white' | 'black', Record<string, string>>;
export type CustomSpec = Record<'white' | 'black', Record<string, [number, number]>>;

export const EMPTY_CUSTOM: CustomDraft = { white: {}, black: {} };

/** The draft's non-Any picks as the spec the server takes; null when
    nothing is constrained (the server refuses a spec that would match
    every game, and so does the Apply button). */
function draftToSpec(draft: CustomDraft): CustomSpec | null {
  const side = (from: Record<string, string>): Record<string, [number, number]> => {
    const out: Record<string, [number, number]> = {};
    for (const { letter } of PIECES) {
      const range = RANGE_CHOICES.find((c) => c.id === (from[letter] ?? 'any'))?.range;
      if (range) out[letter] = range;
    }
    return out;
  };
  const spec = { white: side(draft.white), black: side(draft.black) };
  return Object.keys(spec.white).length + Object.keys(spec.black).length > 0 ? spec : null;
}

/**
 * The custom material spec, drafted in a window and applied on Done —
 * the StructuredFiltersWindow pattern: ten picks are a form to be READ,
 * not chips to tap live, and a hunt re-run per pick would be noise.
 */
export function CustomMaterialWindow({
  initial,
  onApply,
  onClose,
}: {
  initial: CustomDraft;
  onApply: (draft: CustomDraft, spec: CustomSpec) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CustomDraft>(initial);
  const spec = draftToSpec(draft);
  const sideGrid = (side: 'white' | 'black', label: string) => (
    <Field label={label}>
      <div className="grid w-full grid-cols-5 gap-1.5">
        {PIECES.map(({ letter, label: piece }) => (
          <div key={letter} className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground truncate text-xs">{t(piece)}</span>
            <Select
              value={draft[side][letter] ?? 'any'}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, [side]: { ...d[side], [letter]: v } }))
              }
              ariaLabel={`${t(label)}, ${t(piece)}`}
              size="sm"
              className="w-full"
              groups={[
                { options: RANGE_CHOICES.map((c) => ({ value: c.id, label: t(c.label) })) },
              ]}
            />
          </div>
        ))}
      </div>
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Custom material" icon={ScanSearch}>
        {sideGrid('white', 'White has')}
        {sideGrid('black', 'Black has')}
        {/* The refusal the server would give, said before the press. */}
        {!spec && (
          <p className="text-muted-foreground text-sm">
            {t('Pick at least one count, or every game matches.')}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => setDraft(EMPTY_CUSTOM)}
          >
            {t('Clear')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!spec}
            onClick={() => spec && onApply(draft, spec)}
          >
            {t('Apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
