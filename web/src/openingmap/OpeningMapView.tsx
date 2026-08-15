import { useEffect } from 'react';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { Segmented } from '@/ui/Segmented';
import { EmptyState } from '@/ui/EmptyState';
import { CollectionArt } from '@/ui/EmptyArt';
import { useOpeningMap } from './store';
import type { MapColor } from './model';

/**
 * The opening map: the user's prepared openings as a tree, one map per
 * colour. The route carries the colour (#/openingmap/black) so a map is
 * linkable; White is the bare route because it is the convention every
 * chess UI starts from.
 */
export function OpeningMapView({ params }: { params: string[] }) {
  const color: MapColor = params[0] === 'black' ? 'black' : 'white';
  const { doc, loaded, loadError, saveState, saveError, load } = useOpeningMap();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const map = doc?.maps.find((m) => m.color === color) ?? null;

  return (
    <PageShell width="wide">
      <PageHeader
        title={t('Opening map')}
        description={t('Your prepared openings as a tree, with studies and notes on its branches.')}
        actions={
          <>
            <span className="text-subtle text-xs">
              {saveState === 'saving'
                ? t('Saving…')
                : saveState === 'dirty'
                  ? t('Unsaved')
                  : saveState === 'error'
                    ? (saveError ?? t('Save failed'))
                    : null}
            </span>
            <Segmented
              value={color}
              onChange={(c) => (c === 'black' ? navigate('openingmap', 'black') : navigate('openingmap'))}
              segments={[
                { value: 'white', label: t('White') },
                { value: 'black', label: t('Black') },
              ]}
              ariaLabel="Map colour"
            />
          </>
        }
      />
      {!loaded ? null : loadError ? (
        <div className="border-line bg-surface rounded-xl border p-6">
          <p className="text-bad text-sm font-medium">{t('The opening map could not be read')}</p>
          <p className="text-muted mt-1 text-xs leading-relaxed">{loadError}</p>
        </div>
      ) : map && map.root.children.length === 0 ? (
        <div className="border-line bg-surface rounded-xl border">
          <EmptyState
            art={<CollectionArt />}
            title="No moves yet"
            body="Start with your first move for this colour — the rest of the tree grows from it."
          />
        </div>
      ) : null}
    </PageShell>
  );
}
