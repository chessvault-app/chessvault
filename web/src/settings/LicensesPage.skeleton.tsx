import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { t } from '@/lib/i18n';

/**
 * The licences page while its chunk is on the wire.
 *
 * The shell and the name, and no body. Under the name the page prints a paragraph about what it lists, a
 * filter field and a row of chips, all of them real controls it draws
 * without waiting for anything. Reserving the licence rows under a
 * header that has none of that put them 145px high, measured on the
 * demo.
 *
 * The body is what the page draws for its own wait, out of its own
 * chunk, and it arrives into empty space below this: nothing here moves
 * when it does. Lifting that body out here is the same measurable trade
 * every other outline made, and it is worth making page by page rather
 * than in passing.
 */
export default function LicencesOutline() {
  return (
    <PageShell width="medium">
      <PageHeader title={t('Licences')} />
    </PageShell>
  );
}
