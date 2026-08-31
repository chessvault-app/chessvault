import { INPUT_BASE } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getNode } from '@shared/tree';
import { safeCommentText } from '@shared/pgn';
import { NAG_GLYPH } from '@/analysis/notation';
import { cn } from '@/lib/utils';
import { useAnalysis } from '@/store/analysis';
import { autoFocusField, isCoarsePointer } from '@/lib/media';
import { announce } from '@/lib/announce';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ChipRow } from '@/components/chip-row';
import { WikiSuggest } from '@/notes/WikiSuggest';
import { useWikiSuggest } from '@/notes/useWikiSuggest';
import { TitleTip } from '@/components/title-tip';
import { t } from '@/lib/i18n';

/** Move-quality NAGs — one of these at most, like Lichess. */
const QUALITY_NAGS = [1, 2, 3, 4, 5, 6];
/** Positional-assessment NAGs — also mutually exclusive. */
const ASSESSMENT_NAGS = [14, 16, 18, 10, 13, 15, 17, 19];

/** Whether the glyph palette is unfolded — a preference, so it persists. */
const PALETTE_KEY = 'vault:nag-palette';

/**
 * Said when `safeCommentText` has just changed something under the caret.
 *
 * A function holding the literal, not a `const` string handed to `t()`:
 * check-repo's translation sweep only sees literals written inside a `t(`
 * call, and a message parked in a const is exactly the blind spot its own
 * header apologises for. Worded around brackets and commas for the same
 * reason — that sweep counts delimiters without knowing it is inside a
 * string, so a message naming the characters it is about would break it.
 */
const rewriteNotice = (): string =>
  t('Braces and annotation commands cannot be saved in a comment; the text was rewritten.');
/** Long enough to read one short line without it outliving the edit. */
const NOTICE_MS = 6000;

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
  // Counts rewrites rather than flagging one, so a second `}` restarts the
  // timer below instead of being swallowed by an unchanged `true`.
  const [rewrites, setRewrites] = useState(0);
  const [coarse] = useState(isCoarsePointer);
  const [sheet, setSheet] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(
    () => localStorage.getItem(PALETTE_KEY) !== 'closed',
  );
  const box = useRef<HTMLTextAreaElement>(null);
  const sheetBox = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);

  // `[[` completes here exactly as it does in a note, and from the same
  // list — a comment that names a study should be able to LINK it, which
  // is the whole point of the vault. One per box: the sheet and the inline
  // textarea are never both on screen, but they are two elements, and a
  // list anchored to the wrong one hangs off nothing.
  // Through `safeCommentText` like every other way text reaches this box:
  // completing a name is the one path that writes without passing a
  // keystroke through `edit`, and a document whose name holds a brace would
  // otherwise put back exactly what the file cannot keep. Idempotent on
  // text that is already safe, which every id in practice is.
  const put = useCallback((next: string) => setDraft(safeCommentText(next)), []);
  const inline = useWikiSuggest({ box, value: draft, onChange: put });
  const sheetSuggest = useWikiSuggest({ box: sheetBox, value: draft, onChange: put });

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

  // Putting the caret back after a rewrite. React writes a value the DOM
  // does not have, which sends the caret to the end of the box; sanitising
  // the text BEFORE it gives its new offset exactly, however many characters
  // the rewrite moved. Layout effect, so it lands before paint rather than
  // showing a frame with the caret at the end.
  useLayoutEffect(() => {
    const at = caret.current;
    if (at === null) return;
    caret.current = null;
    // activeElement, not `box`: the same handler serves the phone sheet's
    // textarea, which is the focused one while that is open.
    const el = document.activeElement;
    if (el instanceof HTMLTextAreaElement) el.setSelectionRange(at, at);
  }, [draft]);

  // The notice goes away on its own — it reports one keystroke, and left up
  // it would still be sitting there over a note typed minutes later.
  useEffect(() => {
    if (rewrites === 0) return;
    // Only the first of a burst is spoken; the timer restarts on each.
    if (rewrites === 1) announce(rewriteNotice());
    const timer = setTimeout(() => setRewrites(0), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [rewrites]);

  // A cursor move is a different comment, so it is not what the notice was about.
  useEffect(() => setRewrites(0), [cursorId]);

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
    <TitleTip title={t(paletteOpen ? 'Hide glyphs' : 'Show glyphs')}>
      <button
        type="button"
        aria-expanded={paletteOpen}
        aria-label={t(paletteOpen ? 'Hide glyphs' : 'Show glyphs')}
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
    </TitleTip>
  );

  const placeholder = atRoot ? rootPlaceholder : `Comment on ${node.san ?? 'this move'}…`;
  const flush = (): void => {
    if (draft !== (node.comment ?? '')) setComment(cursorId, draft);
  };

  // Where the two silent losses are made visible. Rewriting on the way IN
  // rather than letting the save eat it is the whole of the fix: a comment
  // stripped by `makePgn` is discovered on the next reload, if ever, whereas
  // this changes under the caret while the writer is still looking at it.
  const edit = (el: HTMLTextAreaElement): void => {
    const clean = safeCommentText(el.value);
    setDraft(clean);
    if (clean === el.value) return;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    caret.current = safeCommentText(before).length;
    setRewrites((n) => n + 1);
  };

  // Beside the text it is about, not a toast in the corner: the writer is
  // already looking here, which is the only reason to say it now at all.
  // The editor's own warning row, in the shape it wears there — one size
  // down, because this pane counts its rows and a text-sm line of this
  // costs three of them in a column that narrow. The icon is what makes it
  // read as a warning before it is read at all, so that stays.
  const notice =
    rewrites > 0 ? (
      <p className="text-warn flex items-start gap-1.5 text-xs leading-4">
        {/* mt-px: text-xs's 16px line around a 14px icon, centred on the
            first line the way EditorView centres its own. */}
        <AlertCircle className="mt-px size-3.5 shrink-0" />
        {rewriteNotice()}
      </p>
    ) : null;

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
            // The Input face from the source, not a hand copy of it: this
            // stands where the Textarea stands on a desktop, and the two
            // must weather a face change together.
            className={cn(INPUT_BASE, 'min-h-9 min-w-0 flex-1 px-2.5 py-2 text-left leading-relaxed')}
          >
            {draft ? (
              <span className="text-foreground line-clamp-2 whitespace-pre-wrap">{draft}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </button>
        ) : (
          <Textarea
            ref={box}
            value={draft}
            onChange={(e) => {
              edit(e.target);
              inline.sync();
            }}
            onKeyDown={inline.onKeyDown}
            onBlur={flush}
            placeholder={placeholder}
            rows={2}
            // min-h holds the two rows the growth starts from, max-h caps it
            // at eight — past that it scrolls rather than eating the moves.
            className="max-h-48 min-h-16 min-w-0 flex-1 resize-none overflow-y-auto leading-relaxed"
          />
        )}
      </div>
      {!coarse && <WikiSuggest store={inline.store} host={box.current} />}
      {!sheet && notice}
      {/* The app's own window. This was a scrim and a card pinned to the
          TOP of the screen, hand-rolled here from before there was a
          shared sheet — the one window in the app that opened away from
          the thumb, with no handle, no drag and its own idea of the safe
          area. Modal is a bottom sheet on a phone, and this only opens on
          one. */}
      {sheet && coarse && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setSheet(false);
              flush();
            }
          }}
        >
          <DialogContent title={placeholder}>
            <Textarea
              ref={sheetBox}
              autoFocus={autoFocusField()}
              value={draft}
              onChange={(e) => {
                edit(e.target);
                sheetSuggest.sync();
              }}
              onKeyDown={sheetSuggest.onKeyDown}
              rows={4}
              className="w-full resize-none leading-relaxed"
            />
            <WikiSuggest store={sheetSuggest.store} host={sheetBox.current} />
            {notice}
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
          </DialogContent>
        </Dialog>
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
          ? 'bg-muted text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {glyph}
    </button>
  );
}
