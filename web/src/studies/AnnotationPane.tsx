import { useEffect, useState } from 'react';
import { getNode } from '@shared/tree';
import { NAG_GLYPH } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';

/** Move-quality NAGs — one of these at most, like Lichess. */
const QUALITY_NAGS = [1, 2, 3, 4, 5, 6];
/** Positional-assessment NAGs — also mutually exclusive. */
const ASSESSMENT_NAGS = [14, 16, 18, 10, 13, 15, 17, 19];

/**
 * Comment + NAG editor for the cursor node. The textarea is local state
 * flushed on blur and debounced while typing, so every keystroke doesn't
 * churn the tree (and the autosave that watches it).
 */
export function AnnotationPane({
  className,
  rootPlaceholder = 'Chapter introduction…',
}: {
  className?: string;
  rootPlaceholder?: string;
}) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setComment = useAnalysis((s) => s.setComment);
  const setNags = useAnalysis((s) => s.setNags);

  const node = getNode(tree, cursorId);
  const atRoot = node.parentId === null;

  const [draft, setDraft] = useState(node.comment ?? '');

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

  return (
    <div className={cn('border-line flex shrink-0 flex-col gap-1.5 border-t px-2 py-2', className)}>
      {!atRoot && (
        <div className="flex flex-wrap items-center gap-1">
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
        </div>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== (node.comment ?? '')) setComment(cursorId, draft);
        }}
        placeholder={atRoot ? rootPlaceholder : `Comment on ${node.san ?? 'this move'}…`}
        rows={2}
        className={cn(
          'bg-surface-inset border-line text-fg w-full resize-none rounded-md border px-2 py-1.5',
          'text-xs leading-relaxed outline-none focus:border-line-strong',
        )}
      />
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
        'h-6 min-w-6 rounded px-1 font-mono text-xs font-semibold transition-colors duration-100',
        active
          ? 'bg-primary-soft text-primary'
          : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {glyph}
    </button>
  );
}
