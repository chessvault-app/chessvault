import { ExternalLink, MousePointerClick } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';

import { Board } from '@/board/Board';
import { cn } from '@/lib/utils';

import { Panel, PanelHeader } from '@/components/panel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/empty-state';
import { SideDot } from '@/components/side-dot';

import { t } from '@/lib/i18n';
import {
  ResultScore,
  OpeningTag,
  formatTimeControl,
  safeLink,
  type GameSummary,
} from './shared';
import { moveCount, numberedSan } from './GameTable';

/**
 * What a list hands the details panel when a row is selected: the
 * summary it already has, the way to get the whole game, and the verbs
 * that belong to that row (Open, Add, Bookmark… — each list packages
 * its own, so the panel needs to know nothing about databases or
 * collections).
 */
export interface DetailsSelection {
  /** Distinguishes rows across lists and reloads (gameKey / db:id). */
  key: string;
  summary: GameSummary;
  /** The full game, fetched lazily on selection; null when it cannot
      be had (the panel then falls back to the summary's sanPrefix). */
  loadPgn?: () => Promise<string | null>;
  actions?: ReactNode;
}

interface Replay {
  startFen: string;
  plies: { san: string; fen: string }[];
}

/**
 * The selected game, replayable: board on top, the mainline as
 * clickable notation under it, the headers around them. One content
 * component, two hosts — the desktop column's panel and the phone's
 * details sheet.
 */
function GameDetailsContent({
  selection,
  withKeys = false,
  className,
}: {
  selection: DetailsSelection;
  /** Steer the board from the keyboard (←/→, Home/End) — the desktop
      panel's affordance; a sheet has no keyboard to speak of. */
  withKeys?: boolean;
  /** The panel host pads here; the sheet's DialogContent already pads. */
  className?: string;
}) {
  const { summary } = selection;
  const [replay, setReplay] = useState<Replay | null>(null);
  // Plies PLAYED: 0 is the start, plies.length is the final position.
  const [idx, setIdx] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setReplay(null);
    if (!selection.loadPgn) return;
    void selection
      .loadPgn()
      .then((pgn) => {
        if (!pgn || seq.current !== mine) return;
        // The same parse the analysis board trusts; a PGN it refuses
        // leaves the fallback standing rather than a broken viewer.
        const chapter = pgnToChapters(pgn)[0];
        if (!chapter) return;
        const ids = mainlineFrom(chapter.tree, chapter.tree.rootId);
        const plies = ids.map((id) => {
          const node = getNode(chapter.tree, id);
          return { san: node.san ?? '?', fen: node.fen };
        });
        setReplay({ startFen: getNode(chapter.tree, chapter.tree.rootId).fen, plies });
        // Opened on the END: what the eye's preview always showed —
        // how it finished — with the whole game one Home away.
        setIdx(plies.length);
      })
      .catch(() => {});
    // The selection's key is its identity; loadPgn is a fresh closure
    // every render and must not re-fetch per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.key]);

  useEffect(() => {
    if (!withKeys) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!replay) return;
      // The list's own navigation owns ↑/↓; the board answers ←/→ —
      // unless the keys were meant for a field.
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const last = replay.plies.length;
      const jump = (next: number): void => {
        e.preventDefault();
        setIdx(Math.max(0, Math.min(last, next)));
      };
      if (e.key === 'ArrowLeft') jump(idx - 1);
      else if (e.key === 'ArrowRight') jump(idx + 1);
      else if (e.key === 'Home') jump(0);
      else if (e.key === 'End') jump(last);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [withKeys, replay, idx]);

  const fen = replay
    ? idx === 0
      ? replay.startFen
      : replay.plies[idx - 1]!.fen
    : summary.finalFen;
  const orientation = summary.userSide ?? 'white';

  const player = (name: string, elo: number, side: 'white' | 'black') => (
    <p className="flex items-baseline gap-1.5 text-sm">
      <SideDot side={side} className="shrink-0 translate-y-[-1px]" />
      <span
        className={cn(
          'min-w-0 truncate font-semibold',
          summary.userSide === side && 'text-primary',
        )}
      >
        {name}
      </span>
      {elo ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{elo}</span>
      ) : null}
    </p>
  );

  const link = safeLink(summary.link);
  const detail: ReactNode[] = [];
  const push = (node: ReactNode): void => {
    if (detail.length > 0) detail.push(' · ');
    detail.push(node);
  };
  if (summary.date && summary.date !== '????.??.??') push(summary.date);
  if (summary.plyCount > 0)
    push(t('{n} moves', { n: String(moveCount(summary.plyCount)) }));
  const tc = formatTimeControl(summary.timeControl);
  if (tc) push(tc);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {player(summary.white, summary.whiteElo, 'white')}
          {player(summary.black, summary.blackElo, 'black')}
        </div>
        <ResultScore result={summary.result} userSide={summary.userSide} />
      </div>

      <div className="text-muted-foreground -mt-1 flex flex-col gap-0.5 text-xs">
        {(summary.opening || summary.eco) && (
          <p className="truncate" title={summary.opening?.name ?? undefined}>
            {summary.opening ? (
              <OpeningTag eco={summary.opening.eco} name={summary.opening.name} />
            ) : (
              <OpeningTag eco={summary.eco!} />
            )}
          </p>
        )}
        {summary.event && (
          <p className="truncate" title={summary.event}>
            {summary.event}
            {summary.round ? ` · ${t('round {n}', { n: summary.round })}` : ''}
          </p>
        )}
        {detail.length > 0 && (
          <p className="truncate">
            {detail.map((part, i) => (
              <Fragment key={i}>{part}</Fragment>
            ))}
            {link && (
              <>
                {' · '}
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-0.5 underline underline-offset-2"
                >
                  {t('View online')}
                  <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {selection.actions && (
        <div className="flex flex-wrap items-center gap-2">{selection.actions}</div>
      )}

      {fen && (
        <Board
          fen={fen}
          orientation={orientation}
          viewOnly
          coordinates={false}
          className="w-full rounded-lg"
        />
      )}

      {replay ? (
        replay.plies.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 font-mono text-xs leading-5">
            {replay.plies.map((ply, i) => (
              <Fragment key={i}>
                {i % 2 === 0 && (
                  <span className="text-muted-foreground">{i / 2 + 1}.</span>
                )}
                <button
                  type="button"
                  // Out of the focus story on purpose: the list is
                  // driven by ←/→ (and Home/End), not by tabbing
                  // through hundreds of plies — and a clicked ply that
                  // KEPT focus grew a focus-visible ring the moment
                  // the arrows were used, a second, stale marker
                  // beside the filled highlight that had walked on.
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setIdx(i + 1);
                  }}
                  className={cn(
                    'hover:bg-accent cursor-pointer rounded-sm px-0.5',
                    idx === i + 1
                      ? 'bg-accent text-foreground font-semibold'
                      : 'text-muted-foreground',
                  )}
                >
                  {ply.san}
                </button>
              </Fragment>
            ))}
          </div>
        )
      ) : summary.sanPrefix ? (
        // The game is still on its way (or could not be had): the
        // summary's opening plies, read-only, so the panel says
        // something true meanwhile.
        <p className="text-muted-foreground font-mono text-xs leading-5">
          {numberedSan(summary.sanPrefix, summary.plyCount > 24)}
        </p>
      ) : null}
    </div>
  );
}

/** The desktop column: the selected game beside the table. */
export function GameDetailsPanel({
  selection,
  className,
}: {
  selection: DetailsSelection | null;
  className?: string;
}) {
  return (
    <Panel className={cn('min-h-0', className)}>
      <PanelHeader title={t('Game')} />
      {selection ? (
        <GameDetailsContent
          key={selection.key}
          selection={selection}
          withKeys
          className="px-4 pb-4"
        />
      ) : (
        <EmptyState
          className="min-h-0 flex-1"
          icon={MousePointerClick}
          title="No game selected"
          body="Select a game from the list to see it here — its players, its opening, and the game itself, move by move."
        />
      )}
    </Panel>
  );
}

/** The phone's ⋯ → Game details bottom sheet — the same content. */
export function GameDetailsSheet({
  selection,
  onClose,
}: {
  selection: DetailsSelection;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={`${selection.summary.white} vs ${selection.summary.black}`}
        className="max-sm:h-[88%] sm:max-w-[26rem]"
        size="full"
      >
        <GameDetailsContent key={selection.key} selection={selection} />
      </DialogContent>
    </Dialog>
  );
}
