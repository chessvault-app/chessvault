import { TextArea } from '@/ui/Input';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getNode } from '@shared/tree';
import { NAG_GLYPH } from '@/analysis/notation';
import { cn } from '@/lib/utils';
import { useAnalysis } from '@/store/analysis';
import { autoFocusField } from '@/lib/media';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { ChipRow } from '@/ui/ChipRow';
import { t } from '@/lib/i18n';

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
  const box = useRef<HTMLTextAreaElement>(null);

  // The desktop box grows with what is written in it, from its two rows up
  // to eight, instead of staying at two and scrolling everything past the
  // second line out of sight — an editor you cannot read your own note in.
  // The move table above is min-h-0 flex-1, so it yields the rows rather
  // than the panel growing past its column.
  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight is content + padding; the border is ours to add back, or
    // the box settles two pixels short and scrolls its own last line.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, []);

  // `editing` is a dependency because it is what MOUNTS the textarea: turning
  // the toolbar on over a note that was already long left the box at its two
  // rows until the next keystroke, which is when the deps last changed
  // (lanph3re's report). Layout effect, not effect: the resize lands before
  // paint, so a long note never flashes at two rows on the way in.
  useLayoutEffect(fit, [fit, draft, cursorId, coarse, editing]);

  // Width is the other half of how tall the text is: the columns either side
  // are draggable and the window resizes, and either rewraps the note. Width
  // ONLY — our own height write must not feed itself back in.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === last) return;
      last = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, coarse, editing]);

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
      <span className="bg-border mx-1 h-4 w-px" />
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
      title={t(paletteOpen ? 'Hide glyphs' : 'Show glyphs')}
      onClick={() => setPaletteOpen((open) => !open)}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground flex shrink-0 items-center self-stretch',
        'rounded-sm px-1 transition-colors duration-100',
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
    <div className={cn('border-border flex shrink-0 flex-col gap-1.5 border-t px-3 py-2', className)}>
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
            className="border-border bg-surface-inset min-h-9 min-w-0 flex-1 rounded-md border px-2.5 py-2 text-left text-sm leading-relaxed"
          >
            {draft ? (
              <span className="text-foreground line-clamp-2 whitespace-pre-wrap">{draft}</span>
            ) : (
              <span className="text-subtle">{placeholder}</span>
            )}
          </button>
        ) : (
          <TextArea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={flush}
            placeholder={placeholder}
            rows={2}
            // min-h holds the two rows the growth starts from, max-h caps it
            // at eight — past that it scrolls rather than eating the moves.
            className="max-h-48 min-h-16 min-w-0 flex-1 resize-none overflow-y-auto leading-relaxed"
          />
        )}
      </div>
      {/* The app's own window. This was a scrim and a card pinned to the
          TOP of the screen, hand-rolled here from before there was a
          shared sheet — the one window in the app that opened away from
          the thumb, with no handle, no drag and its own idea of the safe
          area. Modal is a bottom sheet on a phone, and this only opens on
          one. */}
      {sheet && coarse && (
        <Modal
          title={placeholder}
          onClose={() => {
            setSheet(false);
            flush();
          }}
        >
          <TextArea
            autoFocus={autoFocusField()}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full resize-none leading-relaxed"
          />
          <Button
            variant="default"
            size="sm"
            className="self-end"
            onClick={() => {
              setSheet(false);
              flush();
            }}
          >
            {t('Done')}
          </Button>
        </Modal>
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
        'h-6 min-w-6 rounded-sm px-1 font-mono text-sm font-semibold transition-colors duration-100',
        'pointer-coarse:h-8 pointer-coarse:min-w-8',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {glyph}
    </button>
  );
}
