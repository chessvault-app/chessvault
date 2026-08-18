import { AlertTriangle, Check, Compass, Grid3x3, Library, Loader2, NotebookPen, Plus, Repeat, Sparkles, Swords, Target, Trash2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addSan, createTree, moveNumberLabel } from '@shared/tree';
import { treeToPgn } from '@shared/pgn';
import { sanitizeSegment } from '@shared/vaultNames';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { fenKey } from '@/lib/fen';
import { fieldDatabases, MY_GAMES_SOURCE, ONLINE_SOURCE, RATING_BANDS, type FieldDatabase } from '@/repertoire/field';
import { setMapDrill } from '@/repertoire/mapDrill';
import { cn } from '@/lib/cn';
import { isDemo } from '@/lib/demo';
import { bookLabel } from '@/store/explorer';
import { setJumpTarget } from '@/studies/jumpTarget';
import { useAnalysis } from '@/store/analysis';
import { navigate, up } from '@/lib/router';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { NAMED_PLIES, useOpeningLabels, useOpeningName } from '@/lib/opening';
import { Button } from '@/ui/Button';
import { CanvasOverlay, CanvasShell } from '@/ui/CanvasShell';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { EmptyState } from '@/ui/EmptyState';
import { CollectionArt } from '@/ui/EmptyArt';
import { Field } from '@/ui/Field';
import { ClearableInput, Input, SearchInput, TextArea } from '@/ui/Input';
import { MiniBoard } from '@/ui/MiniBoard';
import { Fab, type FabAction } from '@/ui/Fab';
import { Select } from '@/ui/Select';
import { Sheet } from '@/ui/Sheet';
import { MapCanvas } from './MapCanvas';
import { collectStudyTags, reachedMove, type NodeCoverage } from './coverage';
import {
  addChild,
  addTag,
  chartLine,
  deleteNode,
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
  const { coverage, missing, ready: coverageReady } = useCoverage(map, resolved);
  const deviations = useDeviations(map, resolved);

  // The field the map checks itself against — see useGaps.
  const [field, setField] = useState(readFieldPick);
  const [databases, setDatabases] = useState<FieldDatabase[]>([]);
  useEffect(() => {
    // Not `databases ?? []`: a single-file mount has one database and no
    // list to put it in — see fieldDatabases. Any failure is simply "no
    // databases to offer" — the map is useful without a field.
    void api<Parameters<typeof fieldDatabases>[0]>('/api/refgames')
      .then((body) => setDatabases(fieldDatabases(body)))
      .catch(() => setDatabases([]));
  }, []);
  /**
   * Which reference database IS the field, if any.
   *
   * Its picker is a dropdown, and a dropdown's trigger states the
   * current answer: left at the last database anyone browsed to, it
   * would state one while "my games" sat ticked above it. Empty is the
   * honest reading of "the field is not a database".
   */
  const pickedDatabase = databases.some((b) => b.name === field.source) ? field.source : '';
  const pickField = (next: { source: string; ratings: string }): void => {
    setField(next);
    try {
      localStorage.setItem(FIELD_KEY, JSON.stringify(next));
    } catch {
      /* full or blocked storage loses the memo, nothing else */
    }
  };

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
  const { names, ready: labelsReady } = useOpeningLabels(labelFens);
  const labels = useMemo(() => {
    const out = new Map<string, string>();
    if (!resolved) return out;
    for (const [id, facts] of resolved.nodes) {
      const name = facts.fen ? names.get(facts.fen) : null;
      if (name) out.set(id, name);
    }
    return out;
  }, [resolved, names]);

  /**
   * The search. It matches a node's move, the name you gave it and the
   * name the catalogue gives its position, so "naj", "Bg5" and "6." all
   * find something — and it answers by fading the rest of the
   * constellation rather than by taking you somewhere. Where the hits sit
   * relative to everything else IS the answer on a map; a result list
   * that flies you to one dot throws that away.
   */
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !resolved) return null;
    const out = new Set<string>();
    for (const [id, facts] of resolved.nodes) {
      const node = facts.mapNode;
      const move = facts.parentId === null ? t('Start') : `${moveNumberLabel(facts.ply)} ${node.san ?? ''}`;
      const haystack = `${move} ${node.name ?? ''} ${labels.get(id) ?? ''}`.toLowerCase();
      if (haystack.includes(needle)) out.add(id);
    }
    return out;
  }, [query, resolved, labels]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A selection survives edits but not a map switch or its node's deletion.
  const selected = selectedId && resolved?.nodes.get(selectedId) ? selectedId : null;
  // The selection's facts, resolved once for everything below that names it.
  const selectedFacts = selected ? (resolved?.nodes.get(selected) ?? null) : null;
  useEffect(() => setSelectedId(null), [color]);

  /**
   * What a line is lit down from. A search speaks for the whole set of
   * hits; otherwise the selection speaks for itself; a search with no
   * hits lights nothing, which is the right answer to a question with no
   * answer.
   *
   * It lives here rather than in the canvas because the field sweep is
   * asked for from here and is told to answer these lines FIRST. The two
   * readings have to be one reading: a line drawn from one node and
   * fetched for another would be the last thing on the map to appear.
   */
  const focus = useMemo(
    () => (matches ? [...matches] : selected ? [selected] : []),
    [matches, selected],
  );
  const {
    gaps,
    shares,
    ready: fieldReady,
  } = useGaps(map, resolved, coverage, field.source, field.ratings, focus);

  /**
   * Hold the canvas until its colours are known, then show it once, whole.
   *
   * It used to go up neutral and colour in as the answers landed —
   * coverage first, then names, then the field — which read as flicker
   * now that the answers arrive in under a second. So the view waits for
   * all three and paints the finished picture, behind a small spinner.
   *
   * With a deadline, because "wait for everything" must not outstay its
   * welcome: the online field warming a cold cache can take many seconds
   * (one Lichess request per uncached position), and behind an unreachable
   * source it would never come. Past the deadline the map goes up as it
   * is and colours progressively, exactly as it always did.
   *
   * Revealing is one-way per map: switching the comparison source while
   * looking at the map recolours in place rather than pulling the whole
   * canvas back behind a spinner.
   */
  const ready = coverageReady && labelsReady && fieldReady;
  const [revealed, setRevealed] = useState(false);
  const mapId = map?.id ?? null;
  useEffect(() => setRevealed(false), [mapId]);
  useEffect(() => {
    if (revealed || !mapId) return;
    if (ready) {
      setRevealed(true);
      return;
    }
    const deadline = window.setTimeout(() => setRevealed(true), 2500);
    return () => clearTimeout(deadline);
  }, [ready, revealed, mapId]);

  // One way in, with two halves: the explorer-like list, and the field
  // at the foot of it for the move nobody has played yet — the whole
  // point of preparing it. Typing used to close this sheet and open a
  // prompt on top of it; AddMoveSheet asks and answers both now.
  const [addTo, setAddTo] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [growFrom, setGrowFrom] = useState<string | null>(null);

  // The page's own controls, written once. The Fab fans them out as
  // labelled pills on a phone; the top-right corner draws them as icons
  // on anything with a pointer.
  const mapActions: FabAction[] = [
    {
      label: color === 'white' ? 'Switch to the black map' : 'Switch to the white map',
      icon: Repeat,
      onSelect: () => (color === 'white' ? navigate('openingmap', 'black') : navigate('openingmap')),
    },
    {
      label: 'Check coverage against…',
      icon: Target,
      onSelect: () => setOptionsOpen(true),
    },
  ];

  /**
   * On a phone, selecting a dot used to be the same gesture as burying
   * the map: the details arrived as a Sheet over the thing you had just
   * asked a question about, so the lit mainline you selected FOR was
   * behind it. Selection and inspection are two acts now. A tap lights
   * the line and claims the bottom bar with the move's name; the details
   * open from there, on purpose, and closing them leaves the dot still
   * selected. A pointer device keeps both at once — the floating panel
   * has never been in the map's way.
   */
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => setDetailsOpen(false), [selectedId]);

  const empty = map !== null && map.root.children.length === 0;
  const panelShown = map && resolved && selected && (!phone || detailsOpen);
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

  /**
   * The sheets a panel action opens, built once and rendered INSIDE the
   * panel whenever there is one.
   *
   * They used to be siblings of it, and `CoverParent` flows through the
   * React tree — so a sheet written beside the details sheet rather than
   * within it found no parent to measure, took no ceiling, and grew to
   * the safe area: "add a move" stood taller than the details sheet that
   * opened it and hung over its top edge. TagPicker never had the
   * problem, because NodePanel renders it in its own children, which is
   * the shape these three now share.
   */
  const opened = (
    <>
        {addTo !== null && map && resolved?.nodes.get(addTo) && (
          <AddMoveSheet
            facts={resolved.nodes.get(addTo)!}
            coverage={coverage?.get(addTo)}
            source={field.source}
            ratings={field.ratings}
            side={map.color}
            onAdd={(san) => apply((d) => addChild(d, map.id, addTo, san))}
            onSelectChild={setSelectedId}
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
    </>
  );

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
      search={
        loaded && map ? (
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search the map')}
            aria-label={t('Search moves and opening names')}
            // No backdrop of its own. SearchInput puts `className` on its
            // WRAPPER, which is square, so a translucent fill there
            // painted a phantom rectangle behind the rounded field and
            // around its clear button. It was there for a header that
            // floated over the canvas; the header sits above the canvas
            // now and the page's own background is behind it.
            className="w-full"
          />
        ) : null
      }
      actions={
        loaded && map
          ? // The same actions the Fab carries, drawn straight onto the
            // map — no card behind them, and big enough to read as marks
            // on the surface rather than as a toolbar sitting on it.
            mapActions.map(({ label, icon: Icon, onSelect }) => (
              <Button
                key={label}
                variant="ghost"
                size="icon"
                title={t(label)}
                aria-label={t(label)}
                onClick={onSelect}
                className="text-muted hover:text-fg hidden hover:bg-transparent md:inline-flex"
              >
                <Icon className="size-5" />
              </Button>
            ))
          : null
      }
      // A phone gets the panel only once it has been asked for; a pointer
      // device gets it with the selection, since it costs the map nothing.
      panel={
        panelShown && panel
          ? {
              label: t('Move details'),
              content: (
                <>
                  {panel}
                  {opened}
                </>
              ),
              onClose: () => (phone ? setDetailsOpen(false) : setSelectedId(null)),
            }
          : null
      }
    >
      {/* The universe itself — no box, no border, edge to edge. */}
      {loaded && map && resolved && !empty && !revealed && (
        <CanvasOverlay>
          <div className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('Preparing the map…')}
          </div>
        </CanvasOverlay>
      )}
      {loaded && map && resolved && !empty && revealed && (
        <MapCanvas
          map={map}
          resolved={resolved}
          coverage={coverage}
          gaps={field.source ? gaps : undefined}
          shares={field.source ? shares : undefined}
          labels={labels}
          matches={matches}
          selectedId={selected}
          focus={focus}
          // Pressing the selected dot again lets it go. Selecting is what
          // opens the panel and lights the mainline, so it needs an undo
          // that is the same gesture — hunting for empty canvas to click
          // is not one, and on a dense map there may not be any.
          onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
        />
      )}

      {loadError && (
        <CanvasOverlay>
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

      {/* What a phone gets instead of an immediate Sheet: the selection
          named in the bottom bar, the map still whole above it. The bar
          is the app's own idiom for this — a leaf page claims the row
          the global tabs were using — so leaving is the back chevron,
          exactly as it is on the board and in a study. */}
      {phone && selected && selectedFacts && (
        <MobileActionBar>
          {/* The app's gutter, not a smaller one of its own: every other
              claimant of this row is a centred button strip, so this is
              the first whose text has a left edge to line up with. */}
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-6 pr-4">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setDetailsOpen(true)}
            >
              <span className="text-fg block truncate text-sm font-medium">
                {selectedFacts.parentId === null
                  ? t('Start position')
                  : `${moveNumberLabel(selectedFacts.ply)} ${selectedFacts.mapNode.san ?? ''}`}
              </span>
              <span className="text-subtle block truncate text-xs">
                {labels.get(selected) ?? t('Tap for details')}
              </span>
            </button>
            <Button size="sm" onClick={() => setDetailsOpen(true)}>
              {t('Details')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Clear selection')}
              aria-label={t('Clear selection')}
              onClick={() => setSelectedId(null)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </MobileActionBar>
      )}

      {/* Phones only. A thumb wants these at the bottom of the screen; a
          mouse wants them in the page's own corner, which is where the
          desktop copy of this list lives. One array feeds both, so they
          cannot drift apart.

          Not draggable. A disc that can be parked anywhere is a disc
          that is somewhere different every time you reach for it, and on
          this page it is also one more thing on the canvas that swallows
          a touch meant for the map. */}
      {loaded && map && (
        <Fab label={t('Map menu')} icon={Compass} className="md:hidden" actions={mapActions} />
      )}

      {optionsOpen && (
        <Sheet label={t('Check coverage against')} onClose={() => setOptionsOpen(false)}>
          <p className="text-muted text-xs leading-relaxed">
            {t('The field the map compares itself with: gap badges, dot sizes and the statistics table all read from it.')}
          </p>
          {/* The kinds of field, laid out: there are two or three of
              them, they never grow, and each is a different KIND of
              answer — nothing, my own games, the world's. Touching a row
              applies it, so there is nothing to confirm: the same shape
              the engine and puzzle settings lists use.

              What is folded away below is the two lists that have no
              ceiling. Ten rating bands and a shelf of databases laid out
              as rows made a window taller than the phone it opened on,
              where the question at the top had scrolled away by the time
              you reached the answers — and every row but one of each
              list is a choice you are not making today. A list whose
              length is the user's own is a dropdown; a fixed set of
              kinds is not. */}
          {[
            { label: null, options: [{ value: '', label: t('Nothing — hide gaps') }] },
            // Your own games: the field you have actually been facing.
            { label: null, options: [{ value: MY_GAMES_SOURCE, label: t('My games') }] },
            ...(isDemo()
              ? []
              : [
                  {
                    label: 'Online (via proxy)',
                    options: [{ value: ONLINE_SOURCE, label: 'Lichess database' }],
                  },
                ]),
          ].map((group, at) => (
            <div key={group.label ?? `group-${at}`} className="flex flex-col gap-1">
              {group.label && (
                <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                  {group.label}
                </p>
              )}
              {group.options.map((option) => (
                <PickRow
                  key={option.value || 'off'}
                  label={option.label}
                  picked={field.source === option.value}
                  onPick={() => pickField({ ...field, source: option.value })}
                />
              ))}
            </div>
          ))}

          {databases.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                {databases.length === 1 ? t('Reference database') : t('Reference databases')}
              </p>
              {/* A list of one is not a list. Most vaults mount a single
                  database, and behind a dropdown that made the one local
                  source the only field you cannot switch to in a tap:
                  open a popover, read one option, choose it. The rows
                  above are one tap each and this is the same kind of
                  answer, so it is the same kind of control. */}
              {databases.length === 1 ? (
                <PickRow
                  label={databases[0]!.label ?? bookLabel(databases[0]!.name)}
                  picked={field.source === databases[0]!.name}
                  onPick={() => pickField({ ...field, source: databases[0]!.name })}
                />
              ) : (
                <Select
                  // Empty unless one of them IS the field: a trigger
                  // naming a database while "my games" is ticked above
                  // would be showing a choice nobody has made.
                  value={pickedDatabase}
                  onChange={(name) => pickField({ ...field, source: name })}
                  ariaLabel={t('Reference database')}
                  className="w-full"
                  fill
                  groups={[
                    {
                      options: databases.map((b) => ({
                        value: b.name,
                        label: b.label ?? bookLabel(b.name),
                      })),
                    },
                  ]}
                />
              )}
            </div>
          )}

          {/* A rating band is the online database's own dimension. A
              reference database has none: its population was fixed when
              it was built, so the choice of database IS the field. */}
          {field.source === ONLINE_SOURCE && (
            <div className="flex flex-col gap-1">
              <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                {t('Opponent strength')}
              </p>
              <Select
                value={field.ratings}
                onChange={(ratings) => pickField({ ...field, ratings })}
                ariaLabel={t('Opponent strength')}
                className="w-full"
                fill
                groups={[
                  { options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) },
                ]}
              />
            </div>
          )}
        </Sheet>
      )}

      {!panelShown && opened}
    </CanvasShell>
  );
}

/**
 * The dashed row that adds one more of whatever the list above holds —
 * the empty slot at the end of a list, which IS the add button (see the
 * linked-studies field for why a ghost button was not).
 */
const ADD_ROW =
  'border-line text-muted hover:border-primary/40 hover:text-fg flex items-center gap-2 ' +
  'rounded-lg border border-dashed px-2 py-1.5 text-left text-xs transition-colors duration-100 ' +
  'disabled:pointer-events-none disabled:opacity-45';

/**
 * One column of the node panel's footer toolbar.
 *
 * Shared with the delete action, which is a ConfirmSheet rather than a
 * Button and takes this as its trigger's class list — so the five
 * columns keep one geometry instead of two that drift.
 *
 * `shrink flex-1` undoes Button's own `shrink-0`: every column is a
 * fifth of the panel, whatever its word is. `h-auto` undoes the `sm`
 * size's fixed height, since these are two lines tall — and it has to
 * be said twice, because that size sets a SECOND height for a coarse
 * pointer and a plain `h-auto` does not touch it. Left standing, the
 * 2.25rem it clamps a phone's buttons to is less than an icon over a
 * caption needs, and the column squashed the icon to fit: the clipped
 * glyphs on lanph3re's phone, on a row that measured perfectly under
 * every mouse.
 *
 * `[&_svg]:size-4` reaches ConfirmSheet's icon, which sets its own, and
 * `shrink-0` keeps any of them from being squeezed again.
 */
const PANEL_ACTION =
  'h-auto min-w-0 shrink flex-1 flex-col gap-1 rounded-lg px-1 py-1.5 text-[0.6875rem] ' +
  'pointer-coarse:h-auto pointer-coarse:px-1 [&_svg]:size-4 [&_svg]:shrink-0';

function PanelAction({
  icon: Icon,
  label,
  title,
  disabled,
  onSelect,
}: {
  icon: LucideIcon;
  /** The verb under the icon — one word, in a 4rem column. */
  label: string;
  /** What the column means, in full, on hover and to a screen reader. */
  title: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      title={t(title)}
      aria-label={t(title)}
      disabled={disabled}
      onClick={onSelect}
      className={PANEL_ACTION}
    >
      <Icon />
      <span className="min-w-0 max-w-full truncate">{t(label)}</span>
    </Button>
  );
}

/**
 * One choice in a laid-out list: every option visible, the picked one
 * marked. Applies on touch, so there is nothing to confirm — the shape
 * the engine and puzzle settings lists already use.
 */
function PickRow({
  label,
  picked,
  onPick,
}: {
  label: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-100',
        picked
          ? 'border-primary/40 bg-primary-soft text-primary font-medium'
          : 'border-line text-fg hover:bg-surface-2',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {picked && <Check className="size-4 shrink-0" />}
    </button>
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
  const [making, setMaking] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
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

  /**
   * A study for this line, made from the panel and linked on the spot.
   *
   * It carries the moves that lead here, so it opens where the map is
   * rather than at the start position — the same handoff the Analyse
   * button makes, written to the vault instead of to the board. Named
   * after whatever this node is already called: the name you gave it,
   * else the catalogue's name for the line, else the move itself.
   *
   * Not navigated to. The decision that made you press it was about the
   * map, and the link is right there when you want the study.
   */
  const newStudy = async (): Promise<void> => {
    if (!facts.fen) return;
    setMaking(true);
    setMakeError(null);
    try {
      let tree = createTree();
      let tip = tree.rootId;
      for (const san of facts.path) {
        const added = addSan(tree, tip, san);
        if (!added) break;
        tree = added.tree;
        tip = added.nodeId;
      }
      const pgn = treeToPgn(tree, { Event: t('Opening map') });
      /**
       * The name is one this vault can hold, not one the catalogue
       * happens to use. "C60 Ruy Lopez: Morphy Defence" has a colon in
       * it, which a filename may not, and the route answered with the
       * rule rather than the study — a button that fails on most of the
       * openings there are. `sanitizeSegment` is the same pass every
       * imported Lichess title goes through.
       *
       * And a name already taken gets a number rather than an error: a
       * whole family of nodes shares one catalogue name, so the second
       * study from the Sicilian is the common case, not the odd one.
       */
      const wanted = sanitizeSegment(node.name ?? lineName ?? title, t('Untitled study'));
      let id: string | null = null;
      for (let n = 1; n <= 20 && id === null; n += 1) {
        try {
          const made = await api<{ id: string }>('/api/studies', {
            method: 'POST',
            json: { name: n === 1 ? wanted : `${wanted} ${n}`, pgn },
          });
          id = made.id;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) throw error;
        }
      }
      if (id === null) throw new ApiError(409, t('a study with that name exists'));
      apply((d) => addTag(d, map.id, node.id, { kind: 'study', id }));
    } catch (error) {
      setMakeError(apiErrorMessage(error));
    } finally {
      setMaking(false);
    }
  };

  // Continuations the studies prepare that the map does not chart yet:
  // promoting one onto the map is the primary flow, so it is one tap.
  const chartable = useMemo(() => {
    if (!coverage) return [];
    const charted = new Set(node.children.map((c) => c.san));
    return coverage.preparedMoves.filter((san) => !charted.has(san));
  }, [coverage, node.children]);

  const tags = node.tags ?? [];

  return (
    // The height of whatever is holding it — the panel on a pointer
    // device, the sheet on a phone, both of which now have one. The
    // action row below ends this panel, and a panel that ends two thirds
    // of the way down has not ended, it has stopped; filling the height
    // is what gives the row somewhere to be pushed TO (see its
    // `mt-auto`).
    //
    // Said twice, because the two holders stretch a child differently.
    // The panel's scroller is a block with a resolved height, so
    // `min-h-full` fills it. The sheet's card is a flex column whose
    // height comes from a min/max pair rather than a height — not
    // definite enough for a percentage to resolve against, which is why
    // the row sat 123px short of the bottom of an under-filled sheet —
    // so there the free space is taken by growing instead. Each is a
    // no-op in the other's box, and both are in the band where the
    // sheet is a centred card sized to its content.
    <div className="flex min-h-full grow flex-col gap-4">
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
            <ClearableInput
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
          {/* The row that is not there yet.
              A ghost button under the list read as a caption — a tag
              glyph and some quiet words, the same weight as the links
              above it, saying nothing about what pressing it would do.
              So it takes the shape of the thing it adds: a link row with
              a dashed border where a real one has a solid one, and a
              plus where a real one has its kind. The empty slot in a
              list IS the add button. */}
          <button
            type="button"
            onClick={() => setPicking(true)}
            className={ADD_ROW}
          >
            <Plus className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('Link a study or note')}</span>
          </button>
          {/* And the study that does not exist yet.
              Linking one meant leaving the map, making it in the shelf,
              coming back and finding it — for the commonest case of all,
              which is having just decided that THIS line needs writing
              down. It is made with the moves that lead here already in
              it, so it opens where the map is, and it arrives linked. */}
          <button
            type="button"
            disabled={making}
            onClick={() => void newStudy()}
            className={ADD_ROW}
          >
            <NotebookPen className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {making ? t('Making the study…') : t('New study from this line')}
            </span>
          </button>
          {makeError && <p className="text-bad px-1 text-xs">{makeError}</p>}
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
                      navigate('board');
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

      {/* What you can DO here, at the foot of whatever is holding the
          panel — the docked column on a pointer device, the sheet on a
          phone.

          Two rules, because the content is sometimes taller than the box
          and sometimes shorter. `sticky` handles the first: a board,
          four fields and a statistics table outrun any screen, and
          scrolled to the bottom these buttons used to come to rest
          sliced in half by the window's own edge — an answer to "and
          now what" cut through the middle reads as broken rather than as
          a list that continues. `mt-auto` handles the second: sticky
          only pins what would otherwise scroll away, so on a tall window
          the row simply sat wherever the content ended.

          Bled out over the scroller's padding so it spans the panel, and
          opaque, because the rows pass underneath it. The bleed is the
          holder's own padding three times over: 0.75rem plus the safe
          area in a bottom sheet, 0.75 in the centred card between the
          breakpoints, 1 in the panel. The phone keeps that safe area as
          its own bottom padding rather than bleeding across it — the
          strip over the home indicator is the one place a row of buttons
          must not put itself.

          Five columns, icon over caption, rather than five buttons in a
          row: five labelled buttons cannot fit across 22rem and never
          could, so they wrapped — four and then one, which reads as a
          row that ran out of room rather than as a set of five things
          you can do. The shape is the app's own; the phone's tab bar is
          exactly this. The captions are the verb alone, with the full
          sentence on the tooltip, because a column is 4rem wide and
          "Add a move" under a plus says nothing the plus did not. */}
      <div
        className={cn(
          'border-line bg-surface sticky z-10 mt-auto flex items-stretch gap-1 border-t',
          '-mx-3 px-3 pt-2',
          // Gone while the keyboard is up, the same as the phone's own
          // bottom bar. Pinned to the foot of a sheet that has just given
          // way to the keyboard, this row rides up and sits over the
          // fields — five verbs between the thing being typed and the
          // keys typing it. The name and note fields are why: they are
          // in the sheet this row belongs to.
          'keyboard:hidden',
          'max-sm:bottom-[calc(-1.25rem-var(--safe-b))] max-sm:-mb-[calc(1.25rem+var(--safe-b))]',
          'max-sm:pb-[calc(0.5rem+var(--safe-b))]',
          'sm:bottom-[-0.75rem] sm:-mb-3 sm:pb-2',
          'md:bottom-[-1rem] md:-mx-4 md:-mb-4 md:px-2 md:pb-2',
        )}
      >
        <PanelAction
          icon={Plus}
          label="Add"
          title="Add a move"
          disabled={facts.fen === null}
          onSelect={onAddMove}
        />
        <PanelAction
          icon={Sparkles}
          label="Grow"
          title="Chart what your games already play from here"
          disabled={facts.fen === null}
          onSelect={onGrow}
        />
        <PanelAction
          icon={Swords}
          label="Drill"
          title={
            coverage?.covered
              ? 'Drill from here'
              : 'Link a study first — a drill needs prepared moves'
          }
          disabled={!coverage?.covered}
          onSelect={() => {
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
        />
        <PanelAction
          icon={Grid3x3}
          label="Analyse"
          title="Analyse"
          disabled={facts.treeId === null}
          onSelect={() => {
            /**
             * The moves that lead HERE, and nothing else.
             *
             * This used to hand over the map's whole resolved tree with the
             * cursor parked on the node, so analysing one line arrived on
             * the board carrying every other line in the map — every
             * sibling, and everything charted below the node as variations
             * of a position you had asked a question about. On a map of any
             * size the move list was the map rather than the line.
             *
             * The same line newStudy writes to a study, built the same way:
             * replay this node's path into a fresh tree. Facing the map's
             * colour, opening at the tip.
             */
            let tree = createTree();
            let tip = tree.rootId;
            for (const san of facts.path) {
              const added = addSan(tree, tip, san);
              if (!added) break;
              tree = added.tree;
              tip = added.nodeId;
            }
            useAnalysis.setState({
              tree,
              cursorId: tip,
              orientation: map.color,
              gameHeaders: null,
              handoff: true,
            });
            navigate('board');
          }}
        />
        {!isRoot && (
          <ConfirmSheet
            icon={Trash2}
            label="Delete"
            triggerTitle={t('Delete this move')}
            // A column like the other four, in the destructive colour —
            // not `danger`, whose tinted card was right for a row of
            // bordered buttons and would be a red block in a toolbar of
            // bare ones. See PanelAction for the shared geometry.
            triggerClassName={cn(PANEL_ACTION, 'text-bad hover:bg-bad/12 hover:text-bad')}
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
