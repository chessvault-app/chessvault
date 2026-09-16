import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { t } from '@/lib/i18n';

/**
 * The Insights page while its chunk is on the wire.
 *
 * The shell and the name, and no body. Its outline is the longest column in the app and the page builds it
 * from the shape this device saw last visit, through the filter rail
 * above it, which is a rail of real controls held inert.
 *
 * The body is what the page draws for its own wait, out of its own
 * chunk, and it arrives into empty space below this: nothing here moves
 * when it does. Lifting that body out here is the same measurable trade
 * every other outline made, and it is worth making page by page rather
 * than in passing.
 */
export default function InsightsOutline() {
  return (
    <PageShell width="medium">
      <PageHeader title={t('Insights')} />
    </PageShell>
  );
}
