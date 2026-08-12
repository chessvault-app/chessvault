import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_TAGS, normaliseTags } from '@shared/tags';
import { cn } from '@/lib/cn';
import { Input } from './Input';
import { TagPill } from './TagPill';
import { t } from '@/lib/i18n';

/**
 * A document's tags, editable.
 *
 * Reading tags shipped before writing them, which left the only way to
 * tag anything outside the app — against the rule that every user action
 * must be possible inside it. This is that missing half, and it is the
 * same control for a note and a study: they store tags differently (YAML
 * front matter, a PGN header) and that is the caller's business, not this
 * one's.
 *
 * Shown only while a document is being EDITED. A reader has no use for a
 * text field, and the tags themselves are already on the shelf card.
 */
export function TagEditor({
  tags,
  onChange,
  className,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const full = tags.length >= MAX_TAGS;

  const commit = (): void => {
    // Comma-separated too, so pasting "endgame, rook" adds both rather
    // than one tag with a comma in the middle of it.
    const next = normaliseTags([...tags, ...draft.split(',')]);
    setDraft('');
    setAdding(false);
    if (next.length !== tags.length || next.some((tag, at) => tag !== tags[at])) onChange(next);
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tags.map((tag) => (
        <span key={tag} className="group/tag inline-flex items-center gap-0.5">
          <TagPill tag={tag} />
          <button
            type="button"
            title={t('Remove this tag')}
            aria-label={t('Remove this tag')}
            onClick={() => onChange(tags.filter((other) => other !== tag))}
            className="text-subtle hover:text-bad grid size-4 place-items-center rounded-full transition-colors duration-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <Input
          ref={field}
          autoFocus
          inputSize="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder={t('endgame, sicilian…')}
          className="h-6 w-32 text-[0.6875rem]"
        />
      ) : (
        !full && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'border-line text-subtle hover:border-line-strong hover:text-fg inline-flex items-center gap-0.5',
              'rounded-full border border-dashed px-1.5 py-px text-[0.625rem] leading-4',
              'transition-colors duration-100',
            )}
          >
            <Plus className="size-2.5" />
            {t('Tag')}
          </button>
        )
      )}
    </div>
  );
}
