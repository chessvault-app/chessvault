import { AlertTriangle, Grid3x3, Library, NotebookPen, Plus, Swords, Tag, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { fenKey } from '@/repertoire/drill';
import { setMapDrill } from '@/repertoire/mapDrill';
import { setJumpTarget } from '@/studies/jumpTarget';
import { useAnalysis } from '@/store/analysis';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { NAMED_PLIES, useOpeningLabels, useOpeningName } from '@/lib/opening';
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
import { collectStudyTags, type NodeCoverage } from './coverage';
import {
  addChild,
  addTag,
  deleteNode,
  normalizeSan,
  removeTag,
  resolveMap,
  updateFields,
  type MapColor,
  type MapTag,
  type OpeningMap,
  type ResolvedMap,
  type ResolvedNode,
} from './model';
import { useOpeningMap } from './store';
import { TagPicker } from './TagPicker';
import { scopedEntries, useCoverage } from './useCoverage';

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
  const { coverage, missing } = useCoverage(map, resolved);

  // One label lookup for the whole canvas: each node's own position, as
  // deep as the catalogue can possibly name.
  const labelFens = useMemo(() => {
    if (!resolved) return [];
    const fens: string[] = [];
    for (const facts of resolved.nodes.values()) {
      if (facts.fen && facts.ply > 0 && facts.ply <= NAMED_PLIES) fens.push(facts.fen);
    }
    return fens;
  }, [resolved]);
  const names = useOpeningLabels(labelFens);
  const labels = useMemo(() => {
    const out = new Map<string, string>();
    if (!resolved) return out;
    for (const [id, facts] of resolved.nodes) {
      const name = facts.fen ? names.get(facts.fen) : null;
      if (name) out.set(id, name);
    }
    return out;
  }, [resolved, names]);

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
  const panel =
    map && resolved && selected ? (
      <NodePanel
        key={selected}
        map={map}
        resolved={resolved}
        facts={resolved.nodes.get(selected)!}
        coverage={coverage?.get(selected)}
        missing={missing}
        onAddMove={() => setAddTo(selected)}
        onDelete={() => setSelectedId(null)}
      />
    ) : null;

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
                coverage={coverage}
                labels={labels}
                selectedId={selected}
                onSelect={setSelectedId}
              />
            )}
          </div>
          {!phone && !empty && (
            <aside className="border-line bg-surface w-72 shrink-0 overflow-y-auto rounded-xl border p-4">
              {panel ?? (
                <p className="text-muted text-xs leading-relaxed">
                  {t('Select a move to see its details, tag studies to it, or grow the line.')}
                </p>
              )}
            </aside>
          )}
        </div>
      )}
      {phone && panel && (
        <Sheet label={t('Move details')} onClose={() => setSelectedId(null)}>
          {panel}
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
  resolved,
  facts,
  coverage,
  missing,
  onAddMove,
  onDelete,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  facts: ResolvedNode;
  coverage: NodeCoverage | undefined;
  missing: ReadonlySet<string>;
  onAddMove: () => void;
  onDelete: () => void;
}) {
  const { apply } = useOpeningMap();
  const [picking, setPicking] = useState(false);
  const node = facts.mapNode;
  const isRoot = facts.parentId === null;
  const title = isRoot ? t('Start position') : `${moveNumberLabel(facts.ply)} ${node.san ?? ''}`;

  // The line's deepest opening name — what a player calls where they are.
  const lineFens = useMemo(() => {
    const fens: string[] = [];
    let cursor: string | null = node.id;
    while (cursor) {
      const step: ResolvedNode | undefined = resolved.nodes.get(cursor);
      if (!step) break;
      if (step.fen) fens.push(step.fen);
      cursor = step.parentId;
    }
    return fens.reverse();
  }, [resolved, node.id]);
  const lineName = useOpeningName(lineFens);

  const commit = (patch: Parameters<typeof updateFields>[3]): void =>
    apply((d) => updateFields(d, map.id, node.id, patch));

  // Continuations the studies prepare that the map does not chart yet:
  // promoting one onto the map is the primary flow, so it is one tap.
  const chartable = useMemo(() => {
    if (!coverage) return [];
    const charted = new Set(node.children.map((c) => c.san));
    return coverage.preparedMoves.filter((san) => !charted.has(san));
  }, [coverage, node.children]);

  const tags = node.tags ?? [];

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
          {lineName && !isRoot && <p className="text-subtle truncate text-xs">{lineName}</p>}
          {coverage?.covered && (
            <p className="text-muted text-xs">
              {t('Prepared {plies} plies deep, {lines} lines', {
                plies: coverage.preparedPlies,
                lines: coverage.lineCount,
              })}
            </p>
          )}
          {facts.fen === null && !isRoot && (
            <p className="text-bad text-xs">{t('Not a legal move here')}</p>
          )}
        </div>
      </div>

      {!isRoot && (
        <>
          <Field label="Name">
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

      <Field label="Tags">
        <div className="flex flex-col gap-1">
          {tags.map((tag) => {
            const broken = tag.kind === 'study' && missing.has(tag.id);
            const Icon = broken ? AlertTriangle : tag.kind === 'note' ? NotebookPen : Library;
            return (
              <div
                key={`${tag.kind}\n${tag.id}\n${tag.chapter ?? ''}`}
                className="border-line flex items-center gap-2 rounded-lg border px-2 py-1.5"
              >
                <Icon className={broken ? 'text-bad size-4 shrink-0' : 'text-muted size-4 shrink-0'} />
                <button
                  type="button"
                  className="text-fg hover:text-primary min-w-0 flex-1 truncate text-left text-xs"
                  title={tag.id}
                  onClick={() => {
                    // A study opens ON this node's position, not at its
                    // first chapter's first move — that is what following
                    // a tag from a position means.
                    if (tag.kind === 'study' && facts.fen) {
                      setJumpTarget({ fenKey: fenKey(facts.fen), chapter: tag.chapter });
                    }
                    navigate(tag.kind === 'note' ? 'notes' : 'studies', encodeURIComponent(tag.id));
                  }}
                >
                  {tag.id.split('/').pop()}
                  {tag.chapter ? ` · ${tag.chapter}` : ''}
                </button>
                {broken && <span className="text-bad shrink-0 text-xs">{t('Missing')}</span>}
                <button
                  type="button"
                  title={t('Remove tag')}
                  onClick={() => apply((d) => removeTag(d, map.id, node.id, tag))}
                  className="text-subtle hover:text-fg shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setPicking(true)}>
            <Tag className="size-3.5" /> {t('Add a tag')}
          </Button>
        </div>
      </Field>

      {chartable.length > 0 && (
        <Field
          label="Prepared, not on the map"
          hint={<span className="text-subtle text-[0.6875rem]">{t('tap to add')}</span>}
        >
          <div className="flex flex-wrap gap-1.5">
            {chartable.map((san) => (
              <Button
                key={san}
                size="sm"
                onClick={() => apply((d) => addChild(d, map.id, node.id, san))}
              >
                <Plus className="size-3" /> {san}
              </Button>
            ))}
          </div>
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onAddMove} disabled={facts.fen === null}>
          <Plus className="size-3.5" /> {t('Add a move')}
        </Button>
        <Button
          size="sm"
          disabled={!coverage?.covered}
          title={coverage?.covered ? undefined : t('Tag a study first — a drill needs prepared moves')}
          onClick={() => {
            // The trainer takes the map's whole repertoire — every scoped
            // chapter of every tagged study — starting from this node.
            const entries = scopedEntries(collectStudyTags(map));
            if (entries.length === 0) return;
            setMapDrill({
              label: isRoot ? t('Whole map') : title,
              color: map.color,
              entries,
              path: facts.path,
            });
            navigate('repertoire');
          }}
        >
          <Swords className="size-3.5" /> {t('Drill')}
        </Button>
        <Button
          size="sm"
          disabled={facts.treeId === null}
          onClick={() => {
            // The map's own scratch tree, the drill's handoff pattern: the
            // board opens on this node, facing the map's colour.
            useAnalysis.setState({
              tree: resolved.tree,
              cursorId: facts.treeId ?? resolved.tree.rootId,
              orientation: map.color,
              gameHeaders: null,
              handoff: true,
            });
            navigate('analysis');
          }}
        >
          <Grid3x3 className="size-3.5" /> {t('Analyse')}
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

      {picking && (
        <TagPicker
          existing={tags}
          onPick={(tag: MapTag) => {
            apply((d) => addTag(d, map.id, node.id, tag));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
