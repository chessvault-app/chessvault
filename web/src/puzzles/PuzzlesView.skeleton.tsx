import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { t } from '@/lib/i18n';

/**
 * The Puzzles section while its chunk is on the wire.
 *
 * The shell and the name, and no body. The section is a trainer on a phone and a dashboard on a desktop, and
 * which one it is depends on a media query rather than on the address,
 * so there is nothing here that can be decided from params alone.
 *
 * The body is what the page draws for its own wait, out of its own
 * chunk, and it arrives into empty space below this: nothing here moves
 * when it does. Lifting that body out here is the same measurable trade
 * every other outline made, and it is worth making page by page rather
 * than in passing.
 */
export default function PuzzlesOutline() {
  return (
    <PageShell
      width="medium"
      className="h-full gap-2 pb-3">
      <PageHeader title={t('Puzzles')} />
    </PageShell>
  );
}
