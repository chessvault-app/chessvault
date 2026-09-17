import { CanvasShell } from '@/components/canvas-shell';
import { navigate } from '@/lib/router';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/lib/i18n';

/**
 * The opening map while its chunk is on the wire.
 *
 * It drew nothing, with the editor, the repertoire trainer and the
 * workspace: the four routes the shell's old guessing table had no shape
 * for. The shape is not a guess from here — the page is CanvasShell, one
 * of the app's four page families (components/layout), with its name in
 * the header and a canvas under it, and this draws that shell with the
 * canvas empty.
 *
 * What is NOT drawn is the header's search field and its row of map
 * actions: the page itself withholds both until the map has loaded
 * (OpeningMapView, `loaded && map`), and they sit in the title row's own
 * `ml-auto` group where their arrival moves nothing.
 *
 * The spinner and its line are the page's own words for this wait — it
 * prints them over the canvas while it lays the map out, so the reader
 * sees one message rather than two.
 */
export default function OpeningMapOutline() {
  return (
    <CanvasShell title={t('Opening map')} back={() => navigate('more')}>
      <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
        <Spinner />
        {t('Preparing the map…')}
      </div>
    </CanvasShell>
  );
}
