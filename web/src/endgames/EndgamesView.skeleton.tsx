import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { SkeletonBoard } from '@/components/skeletons';
import { t } from '@/lib/i18n';

/**
 * The Endgame drills section while its chunk is on the wire.
 *
 * A class in the address opens a drill, which is a board in
 * BOARD_HELD_SHELL, the shell SkeletonBoard carries. Nothing in the
 * address opens the list of drills, which is a page of rows that needs
 * no fetch at all: its names come from DRILL_PRESETS, so the page has no
 * wait of its own and there is no body here to reserve. The shell and
 * the name are drawn because both are known, and the rows fill in under
 * them without moving anything.
 */
export default function EndgamesOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? (
    <SkeletonBoard />
  ) : (
    <PageShell width="medium">
      <PageHeader title={t('Endgame drills')} />
    </PageShell>
  );
}
