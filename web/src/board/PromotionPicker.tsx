import { useEffect } from 'react';
import type { Role } from 'chessops/types';
import type { Color } from '@lichess-org/chessground/types';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useDialogFocus } from '@/ui/dialogFocus';

const CHOICES: Role[] = ['queen', 'knight', 'rook', 'bishop'];

interface PromotionPickerProps {
  color: Color;
  /** Destination square, e.g. `e8` — used to align the picker over that file. */
  dest: string;
  orientation: Color;
  onSelect: (role: Role) => void;
  onCancel: () => void;
}

/**
 * Overlay for choosing a promotion piece.
 *
 * chessground reports a move as orig/dest only, so the promotion piece has to be
 * collected separately before the move can be added to the tree.
 */
export function PromotionPicker({
  color,
  dest,
  orientation,
  onSelect,
  onCancel,
}: PromotionPickerProps) {
  // The one dialog in the app that could not be dismissed with Escape —
  // and a promotion is exactly the moment a misdrag wants taking back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  const focusRef = useDialogFocus();

  const file = dest.charCodeAt(0) - 97; // 'a' -> 0
  // Flip the column when viewing from Black's side.
  const column = orientation === 'white' ? file : 7 - file;
  // A promotion always lands on the rank furthest from the mover, which is the
  // top of the board for whoever is viewing from their own side.
  const fromTop = (orientation === 'white') === (color === 'white');

  return (
    <div
      className="bg-scrim absolute inset-0 z-40 backdrop-blur-[2px]"
      onClick={onCancel}
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('Choose promotion piece')}
      ref={focusRef}
    >
      {/* `cg-wrap promo-host` exists purely to bring chessground's piece sprites
          into scope; it is deliberately not the positioned overlay itself. */}
      <div
        className={cn('cg-wrap promo-host absolute flex', fromTop ? 'flex-col' : 'flex-col-reverse')}
        style={{
          left: `${column * 12.5}%`,
          width: '12.5%',
          ...(fromTop ? { top: 0 } : { bottom: 0 }),
        }}
      >
        {CHOICES.map((role) => (
          <button
            key={role}
            type="button"
            aria-label={`Promote to ${role}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(role);
            }}
            className={cn(
              'relative aspect-square w-full cursor-pointer border-none p-0',
              'bg-surface/95 hover:bg-primary-soft transition-colors duration-100',
              'shadow-pop',
            )}
          >
            {/* Injected as raw HTML because React rejects `<piece>` as an unknown
                non-hyphenated tag and logs a warning for it. The sprite CSS keys
                off that exact tag name, so this reuses the board's own piece set
                instead of shipping a second copy. */}
            <span
              className="block size-full"
              dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${color}"></piece>` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
