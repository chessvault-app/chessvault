import { useState } from 'react';
import { getNode } from '@shared/tree';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useAnalysis } from '@/store/analysis';
import { announce } from '@/ui/announce';
import { Input, noAutofill } from '@/ui/Input';
import { moveTextToUci } from './moveText';

/**
 * Typed move entry — the keyboard's way onto the board.
 *
 * The board itself is chessground, which is pointer-only: no focusable
 * squares, nothing for Tab to land on. Until the squares themselves can
 * be driven, this input is what makes puzzles, analysis and studies
 * possible without a mouse — and it doubles as the fast lane for anyone
 * who thinks in notation. Parsing lives in ./moveText.
 */

/**
 * The input row. `fen` is the position being typed against; `onPlay`
 * receives the parsed UCI and may veto it (returning false keeps the
 * text for correction — the puzzle trainer accepts any legal move and
 * judges it, so it never vetoes; analysis only refuses if the tree
 * does).
 */
export function MoveEntry({
  fen,
  onPlay,
  className,
}: {
  fen: string;
  onPlay: (uci: string) => boolean | void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);

  const submit = (): void => {
    const raw = text.trim();
    if (!raw) return;
    const uci = moveTextToUci(fen, raw);
    if (uci !== null && onPlay(uci) !== false) {
      setText('');
      setBad(false);
      return;
    }
    setBad(true);
    announce(t('Not a legal move'));
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Input
        {...noAutofill}
        inputSize="sm"
        value={text}
        aria-label={t('Type a move')}
        aria-invalid={bad || undefined}
        placeholder={t('Type a move — Nf3, e4, 0-0')}
        className={cn('w-full font-mono', bad && 'border-bad/60')}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {bad && <p className="text-bad text-xs">{t('Not a legal move')}</p>}
    </div>
  );
}

/** MoveEntry wired to the shared analysis store, for the moves panels. */
export function AnalysisMoveEntry({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playUci = useAnalysis((s) => s.playUci);
  return (
    <MoveEntry fen={getNode(tree, cursorId).fen} onPlay={(uci) => playUci(uci)} className={className} />
  );
}
