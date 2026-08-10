import { TextArea } from '@/ui/Input';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getNode } from '@shared/tree';
import { NAG_GLYPH } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { ChipRow } from '@/ui/ChipRow';

/** Move-quality NAGs — one of these at most, like Lichess. */
const QUALITY_NAGS = [1, 2, 3, 4, 5, 6];
/** Positional-assessment NAGs — also mutually exclusive. */
const ASSESSMENT_NAGS = [14, 16, 18, 10, 13, 15, 17, 19];

/** Whether the glyph palette is unfolded — a preference, so it persists. */
const PALETTE_KEY = 'vault:nag-palette';

/**
 * Comment + NAG editor for the cursor node. The textarea is local state
 * flushed on blur and debounced while typing, so every keystroke doesn't
 * churn the tree (and the autosave that watches it).
 */
export function AnnotationPane({
  className,
  rootPlaceholder = 'Chapter introduction…',
  editing = true,
}: {
  className?: string;
  rootPlaceholder?: string;
  /** Reading mode hides the NAG toolbar and the textarea, showing any
      existing comment as plain text — reclaims the space when you are just
      stepping through a study rather than annotating it. */
  editing?: boolean;
}) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setComment = useAnalysis((s) => s.setComment);
  const setNags = useAnalysis((s) => s.setNags);

  const node = getNode(tree, cursorId);
  const atRoot = node.parentId === null;

  const [draft, setDraft] = useState(node.comment ?? '');
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [sheet, setSheet] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(
    () => localStorage.getItem(PALETTE_KEY) !== 'closed',
  );

  useEffect(() => {
    localStorage.setItem(PALETTE_KEY, paletteOpen ? 'open' : 'closed');
  }, [paletteOpen]);

  // Keep the draft in step when the cursor moves to another node.
  useEffect(() => {
    setDraft(node.comment ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);

  // Debounced flush while typing.
  useEffect(() => {
    if (draft === (node.comment ?? '')) return;
    const timer = setTimeout(() => setComment(cursorId, draft), 500);
    return () => clearTimeout(timer);
  }, [draft, node.comment, cursorId, setComment]);

  const toggleNag = (nag: number, group: number[]): void => {
    const has = node.nags.includes(nag);
    const rest = node.nags.filter((n) => !group.includes(n));
    setNags(cursorId, has ? rest : [...rest, nag]);
  };

  // Reading mode: nothing at all. Comments already read inline in the move
  // tree, and the bottom box looked like a dead input (lanph3re's report).
  if (!editing) return null;

  // One line that scrolls, on every pointer: ChipRow pans under a finger
  // and gives a mouse the nudge arrows. It used to wrap on touch, back when
  // the palette was always on screen and a cut-off row read as a clipped
  // editor — now it folds away instead, so the second row it cost is worth
  // more than the wrap.
  const glyphs = (
    <>
      {QUALITY_NAGS.map((nag) => (
        <NagButton
          key={nag}
          glyph={NAG_GLYPH[nag]!}
          active={node.nags.includes(nag)}
          onClick={() => toggleNag(nag, QUALITY_NAGS)}
        />
      ))}
      <span className="bg-line mx-1 h-4 w-px" />
      {ASSESSMENT_NAGS.map((nag) => (
        <NagButton
          key={nag}
          glyph={NAG_GLYPH[nag]!}
          active={node.nags.includes(nag)}
          onClick={() => toggleNag(nag, ASSESSMENT_NAGS)}
        />
      ))}
    </>
  );
  const palette = <ChipRow innerClassName="gap-1">{glyphs}</ChipRow>;

  // The fold is only worth anything if it gives the row back, so the toggle
  // rides beside the comment box rather than taking a row of its own — and
  // the palette above it renders unwrapped, which is what lets ChipRow
  // measure itself and keep its scroll arrows. The glyphs a move carries
  // are already on the move in the tree, so the toggle stays a toggle.
  const toggle = (
    <button
      type="button"
      aria-expanded={paletteOpen}
      title={paletteOpen ? 'Hide glyphs' : 'Show glyphs'}
      onClick={() => setPaletteOpen((open) => !open)}
      className={cn(
        'text-muted hover:bg-surface-2 hover:text-fg flex shrink-0 items-center self-stretch',
        'rounded px-1 transition-colors duration-100',
      )}
    >
      <ChevronDown
        className={cn('size-3.5 transition-transform duration-150', paletteOpen && 'rotate-180')}
      />
    </button>
  );

  const placeholder = atRoot ? rootPlaceholder : `Comment on ${node.san ?? 'this move'}…`;
  const flush = (): void => {
    if (draft !== (node.comment ?? '')) setComment(cursorId, draft);
  };

  return (
    <div className={cn('border-line flex shrink-0 flex-col gap-1.5 border-t px-2 py-2', className)}>
      {!atRoot && paletteOpen && palette}
      <div className="flex items-stretch gap-1">
        {!atRoot && toggle}
        {coarse ? (
          // Touch: the inline textarea sits exactly where the keyboard (and
          // the bottom bar riding above it) land, so typing into it was a
          // mash. Tapping opens a sheet pinned to the TOP of the viewport —
          // the same idiom as the opening search.
          <button
            type="button"
            onClick={() => setSheet(true)}
            className="border-line bg-surface-inset min-h-9 min-w-0 flex-1 rounded-md border px-2.5 py-2 text-left text-xs leading-relaxed"
          >
            {draft ? (
              <span className="text-fg line-clamp-2 whitespace-pre-wrap">{draft}</span>
            ) : (
              <span className="text-subtle">{placeholder}</span>
            )}
          </button>
        ) : (
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={flush}
            placeholder={placeholder}
            rows={2}
            className="min-w-0 flex-1 resize-none leading-relaxed"
          />
        )}
      </div>
      {sheet && coarse && (
        <div
          className="fixed inset-0 z-50 bg-black/50"
          onPointerDown={() => {
            setSheet(false);
            flush();
            suppressNextClick();
          }}
        >
          <div
            className="bg-surface border-line absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex flex-col gap-2 rounded-xl border p-3 shadow-[var(--shadow-pop)]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="text-subtle text-xs">{placeholder}</p>
            <TextArea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="w-full resize-none leading-relaxed"
            />
            <Button
              variant="primary"
              size="sm"
              className="self-end"
              onClick={() => {
                setSheet(false);
                flush();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NagButton({
  glyph,
  active,
  onClick,
}: {
  glyph: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Coarse pointers get a thumb-sized target (these annotate on a
        // phone too); a mouse keeps the compact glyph row.
        'h-6 min-w-6 rounded px-1 font-mono text-xs font-semibold transition-colors duration-100',
        'pointer-coarse:h-8 pointer-coarse:min-w-8',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {glyph}
    </button>
  );
}
