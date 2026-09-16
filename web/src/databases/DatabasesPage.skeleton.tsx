import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { t } from '@/lib/i18n';

/**
 * The Databases page while its chunk is on the wire.
 *
 * The shell and the name, and no body. Its outline is a panel with a segmented control, a search field and a
 * row of buttons per database, all real controls in the page's chunk.
 *
 * The body is what the page draws for its own wait, out of its own
 * chunk, and it arrives into empty space below this: nothing here moves
 * when it does. Lifting that body out here is the same measurable trade
 * every other outline made, and it is worth making page by page rather
 * than in passing.
 */
export default function DatabasesOutline() {
  return (
    <PageShell
      width="medium"
      // Unscrolling and full height, as DatabasesPage: the manager's own
      // list is what scrolls.
      scroll={false}
      className="h-full min-h-0 pb-4 md:pb-6">
      <PageHeader title={t('Databases')} />
    </PageShell>
  );
}
