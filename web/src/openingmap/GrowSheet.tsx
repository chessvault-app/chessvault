import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import { MY_GAMES_SOURCE } from '@/repertoire/field';
import { Button } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Skeleton } from '@/ui/Skeleton';
import type { OpeningMap, ResolvedNode } from './model';
import { seedFromGames } from './seed';
import { fieldMovesFor } from './useGaps';

/**
 * The map, read out of the games already played: your most-played move
 * on your turns, every reply you keep meeting on theirs. A preview with
 * a games floor to adjust, then one press charts the lot — the walk
 * itself lives in seed.ts and every answer goes through the session's
 * field cache, so tightening the floor re-filters instead of re-asking.
 */

const line = (sans: string[]): string =>
  sans.map((san, at) => (at % 2 === 0 ? `${at / 2 + 1}. ${san}` : san)).join(' ');

export function GrowSheet({
  map,
  facts,
  onApply,
  onClose,
}: {
  map: OpeningMap;
  facts: ResolvedNode;
  onApply: (lines: string[][]) => void;
  onClose: () => void;
}) {
  const [floor, setFloor] = useState<'2' | '5' | '10'>('5');
  const [lines, setLines] = useState<string[][] | null>(null);

  useEffect(() => {
    let live = true;
    setLines(null);
    void seedFromGames({
      color: map.color,
      startPath: facts.path,
      minGames: Number(floor),
      moves: (fen) => fieldMovesFor(MY_GAMES_SOURCE, '', fen, map.color),
    }).then((found) => {
      if (live) setLines(found);
    });
    return () => {
      live = false;
    };
  }, [map.color, facts.path, floor]);

  // The tips alone — a charted prefix is implied by its continuation.
  const tips = useMemo(() => {
    if (!lines) return [];
    const prefixes = new Set(lines.map((l) => l.slice(0, -1).join(' ')));
    return lines.filter((l) => !prefixes.has(l.join(' ')));
  }, [lines]);

  return (
    <Sheet label={t('Grow from my games')} onClose={onClose}>
      <div className="flex items-center gap-2">
        <span className="text-muted text-xs">{t('Chart moves seen in at least')}</span>
        <Segmented
          value={floor}
          onChange={setFloor}
          segments={[
            { value: '2', label: '2' },
            { value: '5', label: '5' },
            { value: '10', label: '10' },
          ]}
          ariaLabel="Games floor"
        />
        <span className="text-muted text-xs">{t('games')}</span>
      </div>
      {lines === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ) : lines.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          {t('Your games do not reach this position often enough — lower the floor, or play more.')}
        </p>
      ) : (
        <>
          <p className="text-fg text-xs font-medium">
            {t('{n} moves to chart, ending in {k} lines', { n: lines.length, k: tips.length })}
          </p>
          <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
            {tips.slice(0, 8).map((l) => (
              <p key={l.join(' ')} className="text-muted truncate text-xs">
                {line(l)}
              </p>
            ))}
            {tips.length > 8 && (
              <p className="text-subtle text-xs">{t('and {n} more', { n: tips.length - 8 })}</p>
            )}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!lines || lines.length === 0}
          onClick={() => {
            onApply(lines!);
            onClose();
          }}
        >
          <Sparkles className="size-3.5" /> {t('Chart them')}
        </Button>
      </div>
    </Sheet>
  );
}
