import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import { MY_GAMES_SOURCE } from '@/repertoire/field';
import { myFilterQuery } from '@/store/explorer';
import { FilterChip } from '@/ui/FilterChip';
import type { Speed } from '@shared/gameIndex';
import { Button } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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

/**
 * Which of your games Grow reads.
 *
 * Not every game is repertoire evidence: a bullet scramble is what you
 * had time for rather than what you have prepared, and a map grown from
 * everything charts the panic as though it were the plan. The two that
 * change the answer most are the clock and whether you kept the game.
 *
 * Side is not offered — the map's colour already decides it — and neither
 * is the result: you play the same first ten moves whether you went on to
 * win or lose, so filtering by outcome would narrow the evidence without
 * sharpening it. The explorer's bar asks both, because it is answering a
 * different question about the same games.
 *
 * Remembered per device, like the arrangement: which games count is a
 * standing opinion about your own play, not a per-visit decision.
 */
const SPEEDS: { id: Speed; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classical', label: 'Classical' },
];
const SPEEDS_KEY = 'vault:openingmap-grow-speeds';
const COLLECTION_KEY = 'vault:openingmap-grow-collection';

const storedSpeeds = (): Speed[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(SPEEDS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((s): s is Speed => SPEEDS.some((known) => known.id === s))
      : [];
  } catch {
    return [];
  }
};

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
  const [speeds, setSpeeds] = useState<Speed[]>(storedSpeeds);
  const [collectionOnly, setCollectionOnly] = useState(
    () => localStorage.getItem(COLLECTION_KEY) === '1',
  );
  // Empty means every game — myFilterQuery leaves out what is not set, and
  // the server reads a missing filter as no filter.
  const filters = useMemo(
    () => myFilterQuery({ speeds: speeds.length > 0 ? speeds : undefined, collectionOnly }),
    [speeds, collectionOnly],
  );
  const toggleSpeed = (id: Speed): void =>
    setSpeeds((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      localStorage.setItem(SPEEDS_KEY, JSON.stringify(next));
      return next;
    });
  /**
   * How many of your games reach this position at all, which is a
   * different question from how many reach it often enough.
   *
   * Finding nothing has two causes and they need different answers. The
   * floor was too high, or there is nothing to read: a vault whose games
   * have never been indexed — a fresh one, most obviously — answers every
   * position with silence, and being told that YOUR GAMES do not reach the
   * starting position often enough is both false and unactionable, since
   * every game ever played reaches it.
   *
   * The same cached call the walk makes, so it costs no extra request.
   */
  const [reach, setReach] = useState<number | null>(null);
  useEffect(() => {
    if (!facts.fen) return;
    let live = true;
    void fieldMovesFor(MY_GAMES_SOURCE, '', facts.fen, map.color, filters).then((moves) => {
      if (live) setReach(moves.reduce((sum, m) => sum + m.total, 0));
    });
    return () => {
      live = false;
    };
  }, [facts.fen, map.color, filters]);

  useEffect(() => {
    let live = true;
    setLines(null);
    void seedFromGames({
      color: map.color,
      startPath: facts.path,
      minGames: Number(floor),
      moves: (fen) => fieldMovesFor(MY_GAMES_SOURCE, '', fen, map.color, filters),
    }).then((found) => {
      if (live) setLines(found);
    });
    return () => {
      live = false;
    };
  }, [map.color, facts.path, floor, filters]);

  // The tips alone — a charted prefix is implied by its continuation.
  const tips = useMemo(() => {
    if (!lines) return [];
    const prefixes = new Set(lines.map((l) => l.slice(0, -1).join(' ')));
    return lines.filter((l) => !prefixes.has(l.join(' ')));
  }, [lines]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" title={t('Grow from my games')}>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('Chart moves seen in at least')}</span>
          <Segmented
            value={floor}
            onChange={setFloor}
            segments={[
              { value: '2', label: '2' },
              { value: '5', label: '5' },
              { value: '10', label: '10' },
            ]}
            ariaLabel="Games floor"
            // Three numerals inside a sentence: the track keeps them one
            // question rather than three little buttons. See `look`.
            look="track"
          />
          <span className="text-muted-foreground text-sm">{t('games')}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-subtle text-xs label-caps">
            {t('From which games')}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {SPEEDS.map(({ id, label }) => (
              <FilterChip
                key={id}
                label={t(label)}
                active={speeds.includes(id)}
                onClick={() => toggleSpeed(id)}
              />
            ))}
            <FilterChip
              label={t('Kept only')}
              title="Only the games in your collection, not every archived game"
              active={collectionOnly}
              onClick={() =>
                setCollectionOnly((on) => {
                  localStorage.setItem(COLLECTION_KEY, on ? '0' : '1');
                  return !on;
                })
              }
            />
          </div>
        </div>
        {lines === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4" />
            <Skeleton className="h-4" />
          </div>
        ) : lines.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {reach === 0
              ? facts.parentId === null
                ? t(
                    'None of your games are indexed yet. Collect some on the Games page — from an online archive or a PGN — and this will have something to read.',
                  )
                : t('None of your games reach this position.')
              : t('Your games do not reach this position often enough — lower the floor, or play more.')}
          </p>
        ) : (
          <>
            <p className="text-foreground text-sm font-medium">
              {t('{n} moves to chart, ending in {k} lines', { n: lines.length, k: tips.length })}
            </p>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {tips.slice(0, 8).map((l) => (
                <p key={l.join(' ')} className="text-muted-foreground truncate text-sm">
                  {line(l)}
                </p>
              ))}
              {tips.length > 8 && (
                <p className="text-subtle text-sm">{t('and {n} more', { n: tips.length - 8 })}</p>
              )}
            </div>
          </>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
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
      </DialogContent>
    </Dialog>
  );
}
