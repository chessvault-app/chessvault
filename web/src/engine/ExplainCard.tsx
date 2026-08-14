import { useEffect } from 'react';
import { getNode } from '@shared/tree';
import { t } from '@/lib/i18n';
import { useAnalysis } from '@/store/analysis';
import { useExplain, type WhyNotData } from '@/store/explain';
import { formatPv } from './pv.ts';

/**
 * The Why card: on-demand probe results for the position on screen.
 *
 * Two rows, each an answer to the question people actually ask an
 * engine and never get answered:
 *  - Threat — "what happens if I do nothing" (a null-move search): the
 *    single fact behind most mysterious quiet moves.
 *  - The last move — "was that any good, and if not, how does it fail":
 *    the played move searched against the best one at equal depth, the
 *    failure named (mate / material / positional) by replaying the
 *    engine's reply, never guessed.
 *
 * Everything else on the card's beat (plan, motifs, WDL, tablebase) is
 * free and lives in the pane itself; only the rows that cost a search
 * live here, behind the click.
 */
export function ExplainCard() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playSan = useAnalysis((s) => s.playSan);

  const cardOpen = useExplain((s) => s.cardOpen);
  const card = useExplain((s) => s.card);
  const ensureCard = useExplain((s) => s.ensureCard);

  const node = getNode(tree, cursorId);
  const parentFen = node.parentId ? getNode(tree, node.parentId).fen : undefined;
  const turn: 'white' | 'black' = node.fen.split(' ')[1] === 'b' ? 'black' : 'white';

  useEffect(() => {
    if (cardOpen) ensureCard(node.fen, node.uci, parentFen);
  }, [cardOpen, node.fen, node.uci, parentFen, ensureCard]);

  if (!cardOpen || !card) return null;

  const threatRow = card.threatLoading ? (
    <Row label={t('Threat')}>
      <span className="text-subtle">{t('Thinking…')}</span>
    </Row>
  ) : card.threat ? (
    <Row label={t('Threat')}>
      <span>
        {t('If {side} does nothing:', { side: turn === 'white' ? t('White') : t('Black') })}{' '}
      </span>
      {/* Not clickable — a pass is not a move that can land on the board. */}
      <span className="text-muted">{formatPv(card.threat.fen, card.threat.moves).text}</span>
    </Row>
  ) : null;

  const lastMoveRow =
    node.san === undefined ? null : card.whyNotLoading ? (
      <Row label={node.san}>
        <span className="text-subtle">{t('Thinking…')}</span>
      </Row>
    ) : card.whyNot ? (
      <WhyNotRow san={node.san} fen={node.fen} parentFen={parentFen!} data={card.whyNot} onPlay={playSan} />
    ) : null;

  return (
    <div className="border-line/50 grid gap-1.5 border-t px-3 py-2 text-xs">
      {threatRow}
      {lastMoveRow}
      {!threatRow && !lastMoveRow && (
        <p className="text-subtle">{t('Nothing to probe in this position.')}</p>
      )}
    </div>
  );
}

function Row({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2" title={title}>
      <span className="text-muted w-14 shrink-0 truncate font-medium">{label}</span>
      <div className="text-fg min-w-0 flex-1">{children}</div>
    </div>
  );
}

function WhyNotRow({
  san,
  fen,
  parentFen,
  data,
  onPlay,
}: {
  san: string;
  fen: string;
  parentFen: string;
  data: WhyNotData;
  onPlay: (san: string) => boolean;
}) {
  const bestSan = formatPv(parentFen, [data.bestUci]).firstSan ?? data.bestUci;
  const tooltip = t('{a}% → {b}% winning chances', { a: data.bestPercent, b: data.playedPercent });

  if (data.agreement) {
    return (
      <Row label={san} title={tooltip}>
        {t('The engine’s own choice.')}
      </Row>
    );
  }
  if (!data.refutation) {
    return (
      <Row label={san} title={tooltip}>
        {t('Fine — nearly as good as the best move, {best}.', { best: bestSan })}
      </Row>
    );
  }

  const reply = formatPv(fen, data.replyMoves);
  const line =
    reply.firstSan !== undefined ? (
      // The refutation continues from the position on screen, so it can
      // be stepped into, exactly like an engine line.
      <button
        type="button"
        className="text-muted hover:text-fg text-left transition-colors duration-100"
        onClick={() => {
          if (reply.firstSan) onPlay(reply.firstSan);
        }}
      >
        {reply.text}
      </button>
    ) : null;

  if (data.refutation.kind === 'mate') {
    return (
      <Row label={san} title={tooltip}>
        <span>{t('Refuted — the reply forces mate:')} </span>
        {line}
      </Row>
    );
  }
  if (data.refutation.kind === 'material') {
    return (
      <Row label={san} title={tooltip}>
        <span>
          {t('Refuted — the reply wins material worth {n} pawns:', { n: data.refutation.amount })}{' '}
        </span>
        {line}
      </Row>
    );
  }
  return (
    <Row label={san} title={tooltip}>
      {t('No tactic — the engine simply prefers {best}.', { best: bestSan })}
    </Row>
  );
}
