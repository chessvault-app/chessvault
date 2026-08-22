import { PageHeader } from '@/components/page-header';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * The licences, as a page of this app rather than a second window.
 *
 * The page itself is generated at build time (web/vite.licenses.ts) into
 * `licenses/index.html`: a standalone document listing every dependency,
 * its version and its licence, beside the licence texts themselves. It is
 * a document, so it is shown as one — in a frame, with the app's own
 * header over it and a way back.
 *
 * It used to be a link with target="_blank", which in a browser is a tab
 * and in the desktop shell was a whole second app window (main.mjs opens
 * own-origin popups rather than handing our own content to the browser).
 * A window with no way back to what you were reading is not where a
 * footnote belongs, and "every user action possible in the app" reads
 * badly if reading the licences means leaving it.
 *
 * The frame is same-origin — it is our file, served by our server — so
 * nothing here is a boundary; it is a layout choice, and it keeps the
 * generator as the single source of what the page says.
 *
 * In `vite dev` the file does not exist: the generator runs at
 * closeBundle, so this frame is empty until something has been built. The
 * link it replaced had exactly the same gap.
 */
export function LicensesPage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-6">
      <PageHeader
        className="mx-auto w-full max-w-5xl"
        title={t('Licences')}
        back={() => navigate('settings')}
        description={t('Everything this app is built from, and the terms it is used under.')}
      />
      <iframe
        src={`${import.meta.env.BASE_URL}licenses/index.html`}
        title={t('Licences')}
        className="bg-card mx-auto min-h-0 w-full max-w-5xl flex-1 rounded-xl ring-1 ring-foreground/10"
      />
    </div>
  );
}
