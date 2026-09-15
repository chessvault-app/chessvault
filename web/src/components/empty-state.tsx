import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { t } from '@/lib/i18n';

/**
 * A panel with nothing in it yet, saying so properly — shadcn's Empty,
 * with the one shape all thirteen call sites share so no shelf words its
 * emptiness differently: say what is missing, say how it gets filled, and
 * offer the press that fills it.
 *
 * The picture is the registry's icon tile, not a drawing: the knight
 * plates that used to sit here were leftovers of the old logo work.
 * Nothing here is centred in the VIEWPORT; it centres in the panel it was
 * given, which is where the reader is already looking.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  ground = false,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /**
   * The press that resolves it. Always give one if one exists.
   *
   * Its variant says what kind of press it is, and the split is the
   * app's, counted across all 28 of these on 2026-09-15: the DEFAULT
   * variant for the press that resolves the state (make one, import one,
   * go where the content is, leave a page that failed to load, try the
   * load again), and `secondary` only for the press that undoes what the
   * reader themselves asked for (Clear search, Clear filters, and the
   * re-run of a search that sits under its own filter bar). Four sites
   * disagreed with that and were brought into line; three of them had
   * never been counted, and the fourth was a conversion of this very
   * component that kept two call sites' old variants instead of matching
   * the two screens already doing the same job.
   *
   * Size follows the surround, not the variant: `sm` where the state
   * sits in a panel or under a toolbar (21 of them), the default 32px on
   * a bare screen whose only content is this (the seven that say a
   * document could not be opened).
   */
  action?: ReactNode;
  /**
   * The state stands on the page rather than in a panel: the tile and a
   * secondary press take the ground rung (index.css, `[data-ground]`),
   * since the muted fill is the light page's own tone.
   */
  ground?: boolean;
  className?: string;
}) {
  return (
    <Empty data-ground={ground ? '' : undefined} className={cn('py-12', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{t(title)}</EmptyTitle>
        <EmptyDescription>{t(body)}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
