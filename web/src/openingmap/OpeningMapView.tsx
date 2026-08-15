import { AlertTriangle, Compass, Grid3x3, Library, NotebookPen, Plus, Repeat, Sparkles, Swords, Tag, Target, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addSan, createTree, moveNumberLabel } from '@shared/tree';
import { fenKey } from '@/repertoire/drill';
import { MY_GAMES_SOURCE, ONLINE_SOURCE, RATING_BANDS } from '@/repertoire/field';
import { setMapDrill } from '@/repertoire/mapDrill';
import { isDemo } from '@/lib/demo';
import { bookLabel } from '@/store/explorer';
import { Select } from '@/ui/Select';
import { setJumpTarget } from '@/studies/jumpTarget';
import { useAnalysis } from '@/store/analysis';
import { navigate, up } from '@/lib/router';
import { t } from '@/lib/i18n';
import { NAMED_PLIES, useOpeningLabels, useOpeningName } from '@/lib/opening';
import { Button } from '@/ui/Button';
import { CanvasOverlay, CanvasShell } from '@/ui/CanvasShell';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { EmptyState } from '@/ui/EmptyState';
import { CollectionArt } from '@/ui/EmptyArt';
import { Field } from '@/ui/Field';
import { Input, TextArea } from '@/ui/Input';
import { MiniBoard } from '@/ui/MiniBoard';
import { Fab } from '@/ui/Fab';
import { PromptSheet } from '@/ui/PromptSheet';
import { Sheet } from '@/ui/Sheet';
import { MapCanvas } from './MapCanvas';
import { collectStudyTags, reachedMove, type NodeCoverage } from './coverage';
import {
  addChild,
  addTag,
  chartLine,
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
import { AddMoveSheet } from './AddMoveSheet';
import { FieldStats } from './FieldStats';
import { GrowSheet } from './GrowSheet';
import { TagPicker } from './TagPicker';
import type { NodeGaps } from './gaps';
import { scopedEntries, useCoverage } from './useCoverage';
import { useDeviations, type Deviation } from './useDeviations';
import { useGaps } from './useGaps';

/**
 * Which field the map checks itself against, device-local like the
 * trainer's last drill: a comparison source is a standing choice, not a
 * per-visit one. '' is off — the default, because gap checking costs
 * requests and the map must be useful before any source is configured.
 */
const FIELD_KEY = 'vault:openingmap-field';

const readFieldPick = (): { source: string; ratings: string } => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FIELD_KEY) ?? '');
    const p = parsed as { source?: unknown; ratings?: unknown };
    if (typeof p?.source === 'string' && typeof p?.ratings === 'string') {
      return { source: p.source, ratings: p.ratings };
    }
  } catch {
    /* an unreadable memo is no memo */
  }
  return { source: '', ratings: '1600' };
};

/**
 * The opening map: the user's prepared openings as a tree, one map per
 * colour. The route carries the colour (#/openingmap/black) so a map is
 * linkable; White is the bare route because it is the convention every
 * chess UI starts from.
 */
export function OpeningMapView({ params }: { params: string[] }) {
  const color: MapColor = params[0] === 'black' ? 'black' : 'white';
  const { doc, loaded, loadError, saveState, saveError, load, apply } = useOpeningMap();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const map = doc?.maps.find((m) => m.color === color) ?? null;
  const resolved = useMemo(() => (map ? resolveMap(map) : null), [map]);
  const { coverage, missing } = useCoverage(map, resolved);
  const deviations = useDeviations(map, resolved);

  // The field the map checks itself against — see useGaps.
  const [field, setField] = useState(readFieldPick);
  const [databases, setDatabases] = useState<{ name: string }[]>([]);
  useEffect(() => {
    void fetch('/api/refgames')
      .then((r) => (r.ok ? r.json() : { databases: [] }))
      .then((body: { databases?: { name: string }[] }) => setDatabases(body.databases ?? []))
      .catch(() => setDatabases([]));
  }, []);
  const pickField = (next: { source: string; ratings: string }): void => {
    setField(next);
    try {
      localStorage.setItem(FIELD_KEY, JSON.stringify(next));
    } catch {
      /* full or blocked storage loses the memo, nothing else */
    }
  };
  const { gaps, shares } = useGaps(map, resolved, coverage, field.source, field.ratings);

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

  // Two ways in: the explorer-like list (addTo), and typed SAN (typeFor)
  // for the move nobody has played yet — the whole point of preparing it.
  const [addTo, setAddTo] = useState<string | null>(null);
  const [typeFor, setTypeFor] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [growFrom, setGrowFrom] = useState<string | null>(null);

  const submitMove = (input: string): void => {
    if (!map || !resolved || !typeFor) return;
    const parent = resolved.nodes.get(typeFor);
    if (!parent?.fen) return;
    const san = normalizeSan(parent.fen, input);
    if (!san) {
      setAddError(t('Not a legal move in this position'));
      return;
    }
    apply((d) => addChild(d, map.id, typeFor, san));
    setAddError(null);
    setTypeFor(null);
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
        gaps={field.source ? gaps.get(selected) : undefined}
        deviations={deviations.get(selected) ?? []}
        source={field.source}
        ratings={field.ratings}
        missing={missing}
        onAddMove={() => setAddTo(selected)}
        onGrow={() => setGrowFrom(selected)}
        onSelectChild={setSelectedId}
        onDelete={() => setSelectedId(null)}
      />
    ) : null;

  return (
    <CanvasShell
      title={t('Opening map')}
      // The phone reaches this page through More, and has to get back.
      back={() => up('more')}
      meta={
        <>
          <span className="text-muted text-xs">{color === 'white' ? t('White') : t('Black')}</span>
          <span className="text-subtle text-xs">
            {saveState === 'saving'
              ? t('Saving…')
              : saveState === 'dirty'
                ? t('Unsaved')
                : saveState === 'error'
                  ? (saveError ?? t('Save failed'))
                  : null}
          </span>
        </>
      }
      panel={panel && { label: t('Move details'), content: panel, onClose: () => setSelectedId(null) }}
    >
      {/* The universe itself — no box, no border, edge to edge. */}
      {loaded && map && resolved && !empty && (
        <MapCanvas
          map={map}
          resolved={resolved}
          coverage={coverage}
          gaps={field.source ? gaps : undefined}
          shares={field.source ? shares : undefined}
          labels={labels}
          selectedId={selected}
          onSelect={setSelectedId}
        />
      )}

      {loadError && (
        <CanvasOverlay className="z-10 p-6">
          <div className="border-line bg-surface max-w-md rounded-xl border p-6">
            <p className="text-bad text-sm font-medium">{t('The opening map could not be read')}</p>
            <p className="text-muted mt-1 text-xs leading-relaxed">{loadError}</p>
          </div>
        </CanvasOverlay>
      )}

      {loaded && map && empty && (
        <CanvasOverlay>
          <EmptyState
            art={<CollectionArt />}
            title="No moves yet"
            body="Start with your first move for this colour — the rest of the tree grows from it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" size="sm" onClick={() => setAddTo(map.root.id)}>
                  <Plus className="size-3.5" /> {t('Add a move')}
                </Button>
                <Button size="sm" onClick={() => setGrowFrom(map.root.id)}>
                  <Sparkles className="size-3.5" /> {t('Grow from my games')}
                </Button>
              </div>
            }
          />
        </CanvasOverlay>
      )}

      {/* Every page-level control lives behind the one floating button,
          and the button itself can be parked wherever the hand likes. */}
      {loaded && map && (
        <Fab
          label={t('Map menu')}
          icon={Compass}
          dragKey="openingmap"
          className="md:bottom-6"
          actions={[
            {
              label: color === 'white' ? 'Switch to the black map' : 'Switch to the white map',
              icon: Repeat,
              onSelect: () =>
                color === 'white' ? navigate('openingmap', 'black') : navigate('openingmap'),
            },
            {
              label: 'Check coverage against…',
              icon: Target,
              onSelect: () => setOptionsOpen(true),
            },
          ]}
        />
      )}

      {optionsOpen && (
        <Sheet label={t('Check coverage against')} onClose={() => setOptionsOpen(false)}>
          <p className="text-muted text-xs leading-relaxed">
            {t('The field the map compares itself with: gap badges, dot sizes and the statistics table all read from it.')}
          </p>
          <Select
            value={field.source || 'off'}
            onChange={(v) => pickField({ ...field, source: v === 'off' ? '' : v })}
            ariaLabel={t('Where opponent replies come from')}
            steady
            groups={[
              { options: [{ value: 'off', label: t('Nothing — hide gaps') }] },
              // Your own games: the field you have actually been facing.
              { options: [{ value: MY_GAMES_SOURCE, label: t('My games') }] },
              ...(isDemo()
                ? []
                : [
                    {
                      label: 'Online (via proxy)',
                      options: [{ value: ONLINE_SOURCE, label: 'Lichess database' }],
                    },
                  ]),
              ...(databases.length > 0
                ? [
                    {
                      label: t('Reference databases'),
                      options: databases.map((b) => ({ value: b.name, label: bookLabel(b.name) })),
                    },
                  ]
                : []),
            ]}
          />
          {field.source === ONLINE_SOURCE && (
            <Select
              value={field.ratings}
              onChange={(v) => pickField({ ...field, ratings: v })}
              ariaLabel={t('Opponent strength')}
              steady
              groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
            />
          )}
        </Sheet>
      )}

      {addTo !== null && map && resolved?.nodes.get(addTo) && (
        <AddMoveSheet
          facts={resolved.nodes.get(addTo)!}
          coverage={coverage?.get(addTo)}
          source={field.source}
          ratings={field.ratings}
          side={map.color}
          onAdd={(san) => apply((d) => addChild(d, map.id, addTo, san))}
          onSelectChild={setSelectedId}
          onType={() => {
            setTypeFor(addTo);
            setAddTo(null);
          }}
          onClose={() => setAddTo(null)}
        />
      )}
      {growFrom !== null && map && resolved?.nodes.get(growFrom) && (
        <GrowSheet
          map={map}
          facts={resolved.nodes.get(growFrom)!}
          onApply={(lines) =>
            apply((d) => lines.reduce((acc, l) => chartLine(acc, map.id, l), d))
          }
          onClose={() => setGrowFrom(null)}
        />
      )}
      {typeFor !== null && (
        <PromptSheet
          label={t('Add a move')}
          initial=""
          submitLabel="Add"
          error={addError}
          closeOnSubmit={false}
          onSubmit={submitMove}
          onClose={() => {
            setTypeFor(null);
            setAddError(null);
          }}
        />
      )}
    </CanvasShell>
  );
}

/** The selected node: its position, its editable facts, its actions. */
function NodePanel({
  map,
  resolved,
  facts,
  coverage,
  gaps,
  deviations,
  source,
  ratings,
  missing,
  onAddMove,
  onGrow,
  onSelectChild,
  onDelete,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  facts: ResolvedNode;
  coverage: NodeCoverage | undefined;
  gaps: NodeGaps | undefined;
  /** Your games whose first step off prepared ground happened HERE. */
  deviations: Deviation[];
  source: string;
  ratings: string;
  missing: ReadonlySet<string>;
  onAddMove: () => void;
  onGrow: () => void;
  onSelectChild: (id: string) => void;
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
          {node.depth !== undefined && coverage && (
            <p
              className={
                reachedMove(facts.ply, coverage.preparedPlies) < node.depth
                  ? 'text-warn text-xs'
                  : 'text-muted text-xs'
              }
            >
              {t('Prepared to move {reached} — target {target}', {
                reached: reachedMove(facts.ply, coverage.preparedPlies),
                target: node.depth,
              })}
            </p>
          )}
          {(coverage?.reviewCount ?? 0) > 0 && (
            <p className="text-warn text-xs">
              {t('{n} fumbled in drills — drill from here', { n: coverage!.reviewCount })}
            </p>
          )}
          {(coverage?.gapCount ?? 0) > 0 && (
            <p className="text-bad text-xs">
              {t('{n} drill gaps — the studies lack an answer', { n: coverage!.gapCount })}
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
          className="resize-none"
          defaultValue={node.note ?? ''}
          onBlur={(e) => {
            const note = e.target.value.trim();
            if ((node.note ?? '') !== note) commit({ note: note || undefined });
          }}
        />
      </Field>

      <Field label="Linked studies and notes">
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
                  title={t('Remove link')}
                  onClick={() => apply((d) => removeTag(d, map.id, node.id, tag))}
                  className="text-subtle hover:text-fg shrink-0"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setPicking(true)}>
            <Tag className="size-3.5" /> {t('Link a study or note')}
          </Button>
        </div>
      </Field>

      <FieldStats
        facts={facts}
        node={node}
        coverage={coverage}
        gaps={gaps}
        source={source}
        ratings={ratings}
        side={map.color}
        onAdd={(san) => apply((d) => addChild(d, map.id, node.id, san))}
        onSelectChild={onSelectChild}
      />

      {deviations.length > 0 && (
        <Field
          label="Games that left here"
          hint={
            <span className="text-subtle text-[0.6875rem]">
              {t('{n} games', { n: deviations.length })}
            </span>
          }
        >
          <div className="flex flex-col gap-1">
            {deviations.slice(0, 4).map((d) => {
              const san = d.sans[d.ply]!;
              const charted = node.children.some((c) => c.san === san);
              return (
                <div key={`${d.file}#${d.idx}`} className="flex items-center gap-2 px-1">
                  <span className="text-fg min-w-0 flex-1 truncate text-xs">
                    {d.white} – {d.black}
                  </span>
                  <span className="text-subtle shrink-0 text-xs">{d.result}</span>
                  <span
                    className={d.userDeviated ? 'text-warn shrink-0 text-xs font-medium' : 'text-muted shrink-0 text-xs font-medium'}
                    title={d.userDeviated ? t('You left the book with this move') : t('They left the book with this move')}
                  >
                    {san}
                  </span>
                  {!charted && (
                    <button
                      type="button"
                      title={t('Chart it on the map')}
                      onClick={() => apply((doc) => addChild(doc, map.id, node.id, san))}
                      className="text-subtle hover:text-fg shrink-0"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('Analyse to the deviation')}
                    onClick={() => {
                      let gameTree = createTree();
                      let tip = gameTree.rootId;
                      for (const step of d.sans) {
                        const added = addSan(gameTree, tip, step);
                        if (!added) break;
                        gameTree = added.tree;
                        tip = added.nodeId;
                      }
                      useAnalysis.setState({
                        tree: gameTree,
                        cursorId: tip,
                        orientation: map.color,
                        gameHeaders: null,
                        handoff: true,
                      });
                      navigate('analysis');
                    }}
                  >
                    <Grid3x3 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
            {deviations.length > 4 && (
              <p className="text-subtle px-1 text-xs">{t('and {n} more', { n: deviations.length - 4 })}</p>
            )}
          </div>
        </Field>
      )}

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
          onClick={onGrow}
          disabled={facts.fen === null}
          title={t('Chart what your games already play from here')}
        >
          <Sparkles className="size-3.5" /> {t('Grow')}
        </Button>
        <Button
          size="sm"
          disabled={!coverage?.covered}
          title={coverage?.covered ? undefined : t('Link a study first — a drill needs prepared moves')}
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
            question={t('Delete this move and everything after it? Linked studies are untouched.')}
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
