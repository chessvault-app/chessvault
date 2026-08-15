import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { Button } from '@/ui/Button';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { EmptyState } from '@/ui/EmptyState';
import { CollectionArt } from '@/ui/EmptyArt';
import { Field } from '@/ui/Field';
import { Input, TextArea } from '@/ui/Input';
import { MiniBoard } from '@/ui/MiniBoard';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { PromptSheet } from '@/ui/PromptSheet';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { MapCanvas } from './MapCanvas';
import {
  addChild,
  deleteNode,
  normalizeSan,
  resolveMap,
  updateFields,
  type MapColor,
  type OpeningMap,
  type ResolvedNode,
} from './model';
import { useOpeningMap } from './store';

/**
 * The opening map: the user's prepared openings as a tree, one map per
 * colour. The route carries the colour (#/openingmap/black) so a map is
 * linkable; White is the bare route because it is the convention every
 * chess UI starts from.
 */
export function OpeningMapView({ params }: { params: string[] }) {
  const color: MapColor = params[0] === 'black' ? 'black' : 'white';
  const { doc, loaded, loadError, saveState, saveError, load, apply } = useOpeningMap();
  const phone = useMediaQuery('(max-width: 47.9375rem)');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const map = doc?.maps.find((m) => m.color === color) ?? null;
  const resolved = useMemo(() => (map ? resolveMap(map) : null), [map]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A selection survives edits but not a map switch or its node's deletion.
  const selected = selectedId && resolved?.nodes.get(selectedId) ? selectedId : null;
  useEffect(() => setSelectedId(null), [color]);

  const [addTo, setAddTo] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const submitMove = (input: string): void => {
    if (!map || !resolved || !addTo) return;
    const parent = resolved.nodes.get(addTo);
    if (!parent?.fen) return;
    const san = normalizeSan(parent.fen, input);
    if (!san) {
      setAddError(t('Not a legal move in this position'));
      return;
    }
    apply((d) => addChild(d, map.id, addTo, san));
    setAddError(null);
    setAddTo(null);
  };

  const empty = map !== null && map.root.children.length === 0;

  return (
    <PageShell width="wide" scroll={false} className="h-full">
      <PageHeader
        title={t('Opening map')}
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
              onChange={(c) =>
                c === 'black' ? navigate('openingmap', 'black') : navigate('openingmap')
              }
              segments={[
                { value: 'white', label: t('White') },
                { value: 'black', label: t('Black') },
              ]}
              ariaLabel="Map colour"
            />
          </>
        }
      />
      {!loaded || !map || !resolved ? (
        loadError ? (
          <div className="border-line bg-surface rounded-xl border p-6">
            <p className="text-bad text-sm font-medium">{t('The opening map could not be read')}</p>
            <p className="text-muted mt-1 text-xs leading-relaxed">{loadError}</p>
          </div>
        ) : null
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="border-line bg-surface min-w-0 flex-1 overflow-auto rounded-xl border">
            {empty ? (
              <EmptyState
                art={<CollectionArt />}
                title="No moves yet"
                body="Start with your first move for this colour — the rest of the tree grows from it."
                action={
                  <Button variant="primary" size="sm" onClick={() => setAddTo(map.root.id)}>
                    <Plus className="size-3.5" /> {t('Add a move')}
                  </Button>
                }
              />
            ) : (
              <MapCanvas
                map={map}
                resolved={resolved}
                selectedId={selected}
                onSelect={setSelectedId}
              />
            )}
          </div>
          {!phone && !empty && (
            <aside className="border-line bg-surface w-72 shrink-0 overflow-y-auto rounded-xl border p-4">
              {selected ? (
                <NodePanel
                  key={selected}
                  map={map}
                  facts={resolved.nodes.get(selected)!}
                  onAddMove={() => setAddTo(selected)}
                  onDelete={() => setSelectedId(null)}
                />
              ) : (
                <p className="text-muted text-xs leading-relaxed">
                  {t('Select a move to see its details, tag studies to it, or grow the line.')}
                </p>
              )}
            </aside>
          )}
        </div>
      )}
      {phone && map && resolved && selected && (
        <Sheet label={t('Move details')} onClose={() => setSelectedId(null)}>
          <NodePanel
            key={selected}
            map={map}
            facts={resolved.nodes.get(selected)!}
            onAddMove={() => setAddTo(selected)}
            onDelete={() => setSelectedId(null)}
          />
        </Sheet>
      )}
      {addTo !== null && (
        <PromptSheet
          label={t('Add a move')}
          initial=""
          submitLabel="Add"
          error={addError}
          closeOnSubmit={false}
          onSubmit={submitMove}
          onClose={() => {
            setAddTo(null);
            setAddError(null);
          }}
        />
      )}
    </PageShell>
  );
}

/** The selected node: its position, its editable facts, its actions. */
function NodePanel({
  map,
  facts,
  onAddMove,
  onDelete,
}: {
  map: OpeningMap;
  facts: ResolvedNode;
  onAddMove: () => void;
  onDelete: () => void;
}) {
  const { apply } = useOpeningMap();
  const node = facts.mapNode;
  const isRoot = facts.parentId === null;
  const title = isRoot ? t('Start position') : `${moveNumberLabel(facts.ply)} ${node.san ?? ''}`;

  const commit = (patch: Parameters<typeof updateFields>[3]): void =>
    apply((d) => updateFields(d, map.id, node.id, patch));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {facts.fen && (
          <MiniBoard
            fen={facts.fen}
            size={72}
            className="border-line shrink-0 overflow-hidden rounded-md border"
          />
        )}
        <div className="min-w-0">
          <p className="text-fg text-sm font-semibold">{title}</p>
          {facts.fen === null && !isRoot && (
            <p className="text-bad text-xs">{t('Not a legal move here')}</p>
          )}
        </div>
      </div>

      {!isRoot && (
        <>
          <Field label="Name" hint={undefined}>
            <Input
              defaultValue={node.name ?? ''}
              placeholder={t('Named from the opening catalogue')}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if ((node.name ?? '') !== name) commit({ name: name || undefined });
              }}
            />
          </Field>
          <Field
            label="Intended depth"
            hint={<span className="text-subtle text-[0.6875rem]">{t('full moves')}</span>}
          >
            <Input
              type="number"
              min={1}
              max={40}
              defaultValue={node.depth ?? ''}
              onBlur={(e) => {
                const depth = Math.max(1, Math.min(40, Number(e.target.value)));
                const next = e.target.value === '' || Number.isNaN(depth) ? undefined : depth;
                if (node.depth !== next) commit({ depth: next });
              }}
            />
          </Field>
        </>
      )}
      <Field label="Note">
        <TextArea
          rows={3}
          defaultValue={node.note ?? ''}
          onBlur={(e) => {
            const note = e.target.value.trim();
            if ((node.note ?? '') !== note) commit({ note: note || undefined });
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onAddMove} disabled={facts.fen === null}>
          <Plus className="size-3.5" /> {t('Add a move')}
        </Button>
        {!isRoot && (
          <ConfirmSheet
            icon={Trash2}
            label={t('Delete')}
            triggerTitle={t('Delete this move')}
            triggerTone="quiet"
            question={t('Delete this move and everything after it? Tagged studies are untouched.')}
            confirmLabel={t('Delete')}
            onConfirm={() => {
              apply((d) => deleteNode(d, map.id, node.id));
              onDelete();
            }}
          />
        )}
      </div>
    </div>
  );
}
