import { useId, useState } from 'react';
import { getNode } from '@shared/tree';
import { typedMove } from '@shared/moveInput';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAnalysis } from '@/store/analysis';
import { usePrefs } from '@/store/prefs';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The keyboard's way onto the board.
 *
 * chessground is pointer-only: nothing in it takes focus, so a keyboard
 * user could step through a game and never make a move in it. This is
 * the row at the foot of every moves panel that closes the gap: type a
 * move in any spelling a person uses (SAN, UCI, figurines, `0-0`, `e8Q`;
 * see shared/moveInput.ts), Enter plays it, and the box empties for the
 * next one. A move that is not legal here stays in the box, marked
 * invalid and explained under it, so the correction is one edit away.
 *
 * `onMove` gets the standard UCI, which is what every board's pointer
 * path hands its caller, so a typed move takes the same road as a
 * dragged one and a trainer judges both alike. It never takes focus on
 * mount: it is a row in a panel, not a dialog's sole field.
 *
 * Settings > Appearance > "Move box" hides it. The gate lives here, in
 * the one component every panel renders, so no caller has to remember
 * the setting and a panel added later gets it for free.
 */
export function MoveBox({
  fen,
  onMove,
  disabled = false,
  className,
}: {
  /** The position the move is read against. */
  fen: string;
  /** Called with the legal move's UCI and canonical SAN. */
  onMove: (uci: string, san: string) => void;
  /** True while the board is not taking moves (a puzzle between phases). */
  disabled?: boolean;
  className?: string;
}) {
  const shown = usePrefs((p) => p.moveBox);
  const errorId = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!shown) return null;

  const submit = (): void => {
    const raw = typed.trim();
    if (!raw) return;
    const move = typedMove(fen, raw);
    if (!move) {
      setError(t('Not a legal move here'));
      return;
    }
    setTyped('');
    setError(null);
    onMove(move.uci, move.san);
  };

  return (
    <form
      data-slot="move-box"
      className={cn('border-border shrink-0 border-t px-3 py-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field data-invalid={error ? true : undefined} className="gap-1">
        <Input
          inputSize="md"
          value={typed}
          placeholder={t('Type a move…')}
          aria-label={t('Type a move…')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled}
          // Enter plays the move, said outright rather than left to the
          // form's implicit submission, which needs a submit button or a
          // key event carrying its character and gets neither from every
          // keyboard (the Browser pane's Enter reached the input and
          // submitted nothing).
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          onChange={(e) => {
            setTyped(e.target.value);
            setError(null);
          }}
        />
        <FieldError id={errorId}>{error}</FieldError>
      </Field>
    </form>
  );
}

/** The box wired to the analysis store, for every panel that shows its tree. */
export function AnalysisMoveBox({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playUci = useAnalysis((s) => s.playUci);
  return (
    <MoveBox
      fen={getNode(tree, cursorId).fen}
      onMove={(uci) => {
        playUci(uci);
      }}
      className={className}
    />
  );
}
