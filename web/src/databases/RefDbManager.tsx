import { Database, FileText, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';
import { forgetRefDbs } from '@/openingmap/useGaps';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ClearableInput, SearchInput } from '@/components/text-fields';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Panel } from '@/components/panel';
import { Skeleton } from '@/components/skeletons';
import { Segmented } from '@/components/segmented';

/**
 * The reference databases and the PGN collections they are built from.
 *
 * One panel, two lists behind a segmented control — they are the same
 * shelf at two stages (an upload, and what was indexed out of it), and
 * showing both at once meant two columns that grew independently: at 18
 * databases beside 24 collections the page ran to 1202px with the Build
 * control 1074px down it, under whichever list happened to be longer.
 * One list at a time is as tall as one list.
 *
 * The two things that are not a list live in windows off the panel's
 * header: uploading, and naming a build. Both are momentary — a file
 * chooser and a text field — and both were permanent furniture below the
 * list they applied to, which is what pushed everything else down.
 *
 * This is the Databases PAGE's, and nowhere else's. The elite browser and
 * the explorer used to open it in a window of their own; both now send
 * you here, because managing is a place you go, not a layer over what you
 * were doing (lanph3re's call).
 */
export interface RefDb {
  name: string;
  games: number;
  sources: string;
  bytes: number;
  /** Whether the explorer's position index has been built into it. */
  indexed?: boolean;
  /** Games sit above the index's high-water mark (an append was
      interrupted between insert and index) — Optimize heals it. */
  stale?: boolean;
  positions?: number;
}

interface Source {
  name: string;
  bytes: number;
}

type Tab = 'databases' | 'sources';

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

export function RefDbManager({
  databases,
  onChanged,
}: {
  databases: RefDb[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('databases');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<Source[] | null>(null);
  // null until the first listing arrives, so "tick everything" happens
  // once and a user's unticking is never overwritten by a refresh.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  /** A database row's own "Add games": the window carries its OWN
      source picker, so growing a database is one press and some ticks —
      not a trip to the other tab and back (lanph3re's report, twice). */
  const [addTo, setAddTo] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    running: boolean;
    exitCode?: number | null;
    log?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const refreshSources = useCallback(async (): Promise<void> => {
    try {
      const body = await api<{ sources: Source[] }>('/api/sources');
      setSources(body.sources);
      setPicked((p) => p ?? new Set(body.sources.map((s) => s.name)));
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  // Poll the build while one runs; refresh the lists when it finishes.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        const s = await api<{
          running: boolean;
          exitCode?: number | null;
          log?: string[];
        }>('/api/refgames/build/status');
        setStatus(s);
        if (s.running) {
          wasRunning.current = true;
        } else if (wasRunning.current) {
          wasRunning.current = false;
          // A finished job may have grown or compacted a database the
          // explorer and the map have session answers for.
          forgetRefDbs();
          onChanged();
        }
      } catch {
        // offline hiccup — the next tick asks again
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1500);
    return () => clearInterval(interval);
  }, [onChanged]);

  const running = status?.running === true;
  const failed = !running && status?.exitCode != null && status.exitCode !== 0;

  // One at a time as a raw body, which streams — these files run to
  // hundreds of megabytes, and FormData would buffer the whole thing in
  // the page before a byte left.
  const upload = async (files: FileList | File[] | null): Promise<void> => {
    if (!files?.length) return;
    setError(null);
    let uploaded = 0;
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pgn')) {
        setError(t('{name} is not a .pgn', { name: file.name }));
        continue;
      }
      setUploading(file.name);
      try {
        await api(`/api/sources?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
        });
        setPicked((p) => new Set(p ?? []).add(file.name));
        uploaded += 1;
      } catch (error) {
        setError(`${file.name}: ${t(apiErrorMessage(error))}`);
      }
    }
    setUploading(null);
    // The chooser's job is done, so it goes — before the re-listing's
    // round trip, not after: a window left standing after the upload it
    // existed for made the finish look like a stall (lanph3re's report).
    // Land on what was just uploaded rather than on whatever tab the
    // window was opened from — the file is the thing that changed. A
    // rejected or failed upload keeps the window, and the panel's error
    // line under it says why there is another try.
    if (uploaded > 0) {
      setShowUpload(false);
      setTab('sources');
    }
    await refreshSources();
  };

  const build = async (
    name: string,
    mode: 'replace' | 'append',
    sourceIds?: string[],
  ): Promise<void> => {
    setError(null);
    try {
      await api('/api/refgames/build', {
        method: 'POST',
        json: { name: name.trim() || undefined, sources: sourceIds ?? [...(picked ?? [])], mode },
      });
    } catch (error) {
      setError(t(apiErrorMessage(error)));
      return;
    }
    setStatus({ running: true, log: [] });
    wasRunning.current = true;
    setShowBuild(false);
    // The build makes a database, so show the shelf it will appear on —
    // and unfiltered, or a search left over from picking the collections
    // hides the very thing that was just built.
    setQuery('');
    setTab('databases');
  };

  const del = async (dbName: string): Promise<void> => {
    setError(null);
    try {
      await api(`/api/refgames/${encodeURIComponent(dbName)}`, { method: 'DELETE' });
      onChanged();
    } catch (error) {
      setError(t(apiErrorMessage(error)));
    }
  };

  /** Housekeeping as a job in the build slot: duplicates out, derived
      tables re-derived, space returned. */
  const optimize = async (dbName: string): Promise<void> => {
    setError(null);
    try {
      await api('/api/refgames/optimize', { method: 'POST', json: { db: dbName } });
      setStatus({ running: true, log: [] });
      wasRunning.current = true;
    } catch (error) {
      setError(t(apiErrorMessage(error)));
    }
  };

  /**
   * Delete an uploaded collection. The file is the only copy — nothing
   * here keeps one — which is why the trigger asks first.
   *
   * The tick goes with it, so the next build cannot name a file that is
   * not there; a refused delete keeps both, and says why.
   */
  const delSource = async (sourceName: string): Promise<void> => {
    setError(null);
    try {
      await api(`/api/sources/${encodeURIComponent(sourceName)}`, { method: 'DELETE' });
      // The server has said the file is gone, so the row goes NOW. It
      // used to wait for the re-listing below as well — two round trips
      // in a row between the press and the row leaving, which over a slow
      // link read as the delete lagging. The rule stands: the row leaves
      // because the file did, not because it was pressed — the DELETE's
      // own answer is the server saying so.
      setSources((prev) => prev && prev.filter((s) => s.name !== sourceName));
      setPicked((p) => {
        if (!p?.has(sourceName)) return p;
        const next = new Set(p);
        next.delete(sourceName);
        return next;
      });
    } catch (error) {
      setError(`${sourceName}: ${t(apiErrorMessage(error))}`);
    }
    // Either way the listing reconciles with the server's — behind the
    // row's departure on success, and to bring back the truth on refusal.
    await refreshSources();
  };

  // The search narrows the list that is showing. Substring, case-folded:
  // these are file names, and the useful query is "elite" or "2026".
  const needle = query.trim().toLowerCase();
  const shownDbs = useMemo(
    () => (needle ? databases.filter((d) => d.name.toLowerCase().includes(needle)) : databases),
    [databases, needle],
  );
  const shownSources = useMemo(
    () =>
      needle ? (sources ?? []).filter((s) => s.name.toLowerCase().includes(needle)) : (sources ?? []),
    [sources, needle],
  );

  // Counted over EVERY collection, not the filtered view: a search that
  // hides three of five ticked files must not make the Build button say
  // two, or build two.
  const pickedCount = picked?.size ?? 0;

  const list =
    tab === 'databases' ? (
      <DbList
        databases={shownDbs}
        onDelete={(n) => void del(n)}
        onOptimize={(n) => void optimize(n)}
        onAddTo={(n) => setAddTo(n)}
        optimizeDisabled={running}
      />
    ) : (
      <SourceList
        sources={shownSources}
        picked={picked}
        onToggle={(name, on) =>
          setPicked((p) => {
            const next = new Set(p ?? []);
            if (on) next.add(name);
            else next.delete(name);
            return next;
          })
        }
        onDelete={(n) => void delSource(n)}
        deleteDisabled={running}
      />
    );

  const empty =
    tab === 'databases'
      ? databases.length === 0
        ? t('No databases yet — upload a PGN collection and build one.')
        : t('No database matches that.')
      : sources === null
        ? null
        : sources.length === 0
          ? t(
              'Nothing uploaded yet. A collection is any .pgn of games — a Lichess Elite month, a Lumbra export.',
            )
          : t('No collection matches that.');

  const shownCount = tab === 'databases' ? shownDbs.length : shownSources.length;

  return (
    <>
      <Panel className="min-h-0">
        {/* The switch gets its row to itself. Sharing it with the search
            meant the two segments were squeezed to whatever the field
            left over.

            A band, not a PanelHeader. The header's title slot is an h2
            with the card's own 16px gutter, and both halves were wrong
            for a tab strip: a tablist is not a name, and the gutter sat
            the strip 4px right of the search field's border (px-3, like
            every band below), while the header's missing rule left a
            16px gap of open air over the search row — even to the pixel
            with every other band boundary here, but reading as slack,
            and turning everything under the first rule into what looked
            like a footer band (lanph3re's report). Same shape as the
            skeleton, which drew the rule all along. */}
        <div className="border-border flex shrink-0 items-center border-b px-3 py-2">
            <Segmented
              value={tab}
              onChange={setTab}
              ariaLabel="What to manage"
              kind="tabs"
              segments={[
                {
                  value: 'databases',
                  label: (
                    <>
                      <Database className="size-3.5 shrink-0" />
                      {t('Databases')}
                    </>
                  ),
                },
                {
                  value: 'sources',
                  label: (
                    <>
                      <FileText className="size-3.5 shrink-0" />
                      {t('PGN collections')}
                    </>
                  ),
                },
              ]}
            />
        </div>

        {/* Its own row, under the switch: the field wants the width, and
            on a phone there was never room for both on one line. */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search')}
            spellCheck={false}
            className="min-w-0 flex-1"
          />
          {/* Uploading is a moment, not furniture. It was a permanent
              96px box under a list that can run to 24 rows; behind an
              icon it costs nothing until it is wanted. */}
          <Button
            variant="secondary"
            size="icon-sm"
            className="shrink-0"
            title={t('Upload PGN collections')}
            aria-haspopup="dialog"
            onClick={() => setShowUpload(true)}
          >
            <Upload className="size-3.5" />
          </Button>
        </div>

        {/* The build's own line, where the list would be — it is the one
            thing here that takes minutes, so it says so from the top
            rather than from under whichever tab started it. */}
        {running && (
          <p className="border-border text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-2 font-mono text-xs">
            <Spinner className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{status?.log?.at(-1) ?? '…'}</span>
          </p>
        )}
        {failed && (
          <p className="border-border text-destructive shrink-0 border-b px-3 py-2 font-mono text-xs">
            {status?.log?.at(-1) ?? t('The build failed.')}
          </p>
        )}
        {error && <p className="border-border text-destructive shrink-0 border-b px-3 py-2 text-sm">{error}</p>}

        {/* The list scrolls, the panel does not grow: one list at a time,
            capped, is what keeps the Build bar below in view. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shownCount === 0 ? (
            empty && <p className="text-muted-foreground px-3 py-6 text-center text-sm leading-relaxed">{empty}</p>
          ) : (
            list
          )}
        </div>

        {/* Appears with the first tick and names its own count, so the
            press that starts minutes of indexing says what it is about
            to index. */}
        {tab === 'sources' && pickedCount > 0 && (
          <div className="border-border flex shrink-0 items-center gap-2 border-t px-3 py-2">
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
              {t('{n} selected', { n: pickedCount })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setPicked(new Set())}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="shrink-0"
              disabled={running}
              aria-haspopup="dialog"
              onClick={() => setShowBuild(true)}
            >
              {t('Build')}
            </Button>
          </div>
        )}
      </Panel>

      {showUpload && (
        <UploadWindow
          uploading={uploading}
          onFiles={(files) => void upload(files)}
          onReject={() => setError(t('Only .pgn files can be uploaded here'))}
          onClose={() => setShowUpload(false)}
        />
      )}

      {showBuild && (
        <BuildWindow
          count={pickedCount}
          only={pickedCount === 1 ? [...(picked ?? [])][0] : undefined}
          existing={databases.map((d) => d.name)}
          onBuild={(name, mode) => void build(name, mode)}
          onClose={() => setShowBuild(false)}
        />
      )}
      {addTo !== null && (
        <AddToWindow
          db={addTo}
          sources={sources}
          onAdd={(sourceIds) => {
            setAddTo(null);
            void build(addTo, 'append', sourceIds);
          }}
          onUploadInstead={() => {
            setAddTo(null);
            setShowUpload(true);
          }}
          onClose={() => setAddTo(null)}
        />
      )}
    </>
  );
}

/**
 * The panel's own shape, for the moment before /api/refgames answers.
 *
 * The page drew nothing until it did, so the whole panel popped in. Same
 * three bands in the same order and at the same heights — switch, search
 * row, divided list — so nothing moves when the real one lands. Governed
 * by useSlowLoad at the call site: on a local server this never appears,
 * which is the point.
 */
export function RefDbManagerSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Panel className="min-h-0">
      {/* Announced once, like every other skeleton here; components/skeletons' own
          wrapper is private to it. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        role="status"
        aria-label={t('Loading')}
        aria-live="polite"
      >
        {/* The switch: one box the size the segmented control settles at. */}
        <div className="border-border flex shrink-0 items-center border-b px-3 py-2">
          <Skeleton className="h-8 w-52 rounded-xl" />
        </div>
        {/* The search row, and the upload icon beside it. */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Skeleton className="h-7 min-w-0 flex-1" />
          <Skeleton className="size-7 shrink-0" />
        </div>
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-hidden">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5 pl-[17px] pr-3">
              <Skeleton className={cn('h-3', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
              <Skeleton className="ml-auto h-2.5 w-24 shrink-0" />
              <Skeleton className="size-7 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** Ragged widths, so the placeholder list does not read as a barcode. */
const NAME_WIDTHS = ['w-40', 'w-32', 'w-44', 'w-36', 'w-28', 'w-40'];

/** The built databases, one row each — name, size, and whether the
    position index is in place. */
function DbList({
  databases,
  onDelete,
  onOptimize,
  onAddTo,
  optimizeDisabled,
}: {
  databases: RefDb[];
  onDelete: (name: string) => void;
  onOptimize: (name: string) => void;
  onAddTo: (name: string) => void;
  optimizeDisabled: boolean;
}) {
  return (
    <ul className="divide-border divide-y">
      {databases.map((d) => (
        // 17px: five past the search field's left border, which pl-3 sat
        // exactly on. An off-scale literal because it is answering the
        // eye rather than a measurement — nothing in the row above is at
        // 17 (the magnifier starts at 21, its placeholder at 41). The
        // scale's neighbours are 16 and 20, and lanph3re asked for this
        // one, so it is written as itself rather than rounded to look
        // principled.
        // pr-3, the search row's own: the delete button and the upload
        // button above are the same 28px box, and at pr-1.5 the trash
        // column stood 6px right of the upload icon.
        <li key={d.name} className="flex items-center gap-2 py-1.5 pl-[17px] pr-3 text-sm">
          <span className="text-foreground min-w-0 flex-1 truncate font-medium" title={d.sources}>
            {d.name}
          </span>
          <span className="text-muted-foreground shrink-0">
            {t('{n} games', { n: d.games.toLocaleString() })} · {mb(d.bytes)}
          </span>
          {/* Built before the position index existed: the explorer
              offers to add it when this database is its source. */}
          {d.indexed === false && <span className="text-warn shrink-0">{t('no position index')}</span>}
          {/* Games above the index's high-water mark — an interrupted
              append. Optimize brings the index up to them. */}
          {d.stale === true && <span className="text-warn shrink-0">{t('index behind')}</span>}
          {/* Growing THIS database, from its own row — burying append
              behind typing a matching name into the build form was not
              a flow anyone would find (lanph3re said so). */}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={optimizeDisabled}
            title={
              optimizeDisabled
                ? t('Wait for the running job to finish')
                : t('Add games to this database')
            }
            className="shrink-0"
            onClick={() => onAddTo(d.name)}
          >
            <Plus className="size-3.5" />
          </Button>
          {/* Housekeeping in the build slot: duplicates out, derived
              tables re-derived, space returned. Asked first — it can run
              for minutes on a big database. */}
          <ConfirmDialog
            icon={Sparkles}
            triggerClassName="shrink-0"
            disabled={optimizeDisabled}
            // Heavy, not destructive: the question is about the minutes,
            // and a red dialog said this deletes your database.
            tone="default"
            triggerTitle={
              optimizeDisabled ? 'Wait for the running job to finish' : 'Optimize this database'
            }
            question={t(
              'Optimize “{name}”? Removes exact duplicate games, refreshes the derived tables and compacts the file. This can take a while.',
              { name: d.name },
            )}
            confirmLabel="Optimize"
            onConfirm={() => onOptimize(d.name)}
          />
          {/* Asked in a window rather than warned about in a tooltip: a
              title nobody reads was all that stood between a press and
              however many minutes of indexing. */}
          <ConfirmDialog
            icon={Trash2}
            triggerClassName="shrink-0"
            triggerTitle="Delete this database"
            question={t('Delete “{name}”? The collections it was built from are kept.', {
              name: d.name,
            })}
            confirmLabel="Delete"
            onConfirm={() => onDelete(d.name)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The uploads, each with the tick that puts it in the next build. */
function SourceList({
  sources,
  picked,
  onToggle,
  onDelete,
  deleteDisabled,
}: {
  sources: Source[];
  picked: Set<string> | null;
  onToggle: (name: string, on: boolean) => void;
  onDelete: (name: string) => void;
  deleteDisabled: boolean;
}) {
  return (
    <ul className="divide-border divide-y">
      {sources.map((s) => (
        <li key={s.name} className="flex items-center gap-2 py-1.5 pl-3 pr-3 text-sm">
          {/* The label covers the tick, the name and the size, and
              nothing else: a button inside it would toggle the tick on
              its way to being pressed. */}
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <Checkbox
              checked={picked?.has(s.name) ?? false}
              onCheckedChange={(on) => onToggle(s.name, on === true)}
            />
            <span className="text-foreground min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground shrink-0">{mb(s.bytes)}</span>
          </label>
          {/* Uploading is how a phone gets a file onto the server, so
              deleting one has to be possible there too — the app was the
              only way in and the shell was the only way out. Disabled
              while a build runs: it is reading these files, and the
              server refuses it for the same reason. */}
          <ConfirmDialog
            icon={Trash2}
            triggerClassName="shrink-0"
            disabled={deleteDisabled}
            triggerTitle={
              deleteDisabled ? 'Wait for the build to finish' : 'Delete this PGN collection'
            }
            question={t('Delete “{name}”? Databases already built from it are not affected.', {
              name: s.name,
            })}
            confirmLabel="Delete"
            onConfirm={() => onDelete(s.name)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Growing one database, whole flow in one window: press + on its row,
 * tick the uploads to feed it, press Add games. The picker is the
 * window's own — the first version reused the build tab's ticks, which
 * sent the user to the other tab and back before the press meant
 * anything (lanph3re's report). Only the games the database does not
 * already hold are indexed, so re-feeding a file is safe.
 */
function AddToWindow({
  db,
  sources,
  onAdd,
  onUploadInstead,
  onClose,
}: {
  db: string;
  sources: Source[] | null;
  onAdd: (sourceIds: string[]) => void;
  onUploadInstead: () => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const list = sources ?? [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title={t('Add games to “{name}”', { name: db })} icon={Plus}>
        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('No PGN collections uploaded yet — upload the games to add first.')}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('Only the games it does not already hold are indexed.')}
            </p>
            <ul className="divide-border max-h-64 divide-y overflow-y-auto rounded-md border">
              {list.map((s) => (
                <li key={s.name} className="flex items-center px-3 py-1.5 text-sm">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={ticked.has(s.name)}
                      onCheckedChange={(on) =>
                        setTicked((prev) => {
                          const next = new Set(prev);
                          if (on === true) next.add(s.name);
                          else next.delete(s.name);
                          return next;
                        })
                      }
                    />
                    <span className="text-foreground min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-muted-foreground shrink-0">{mb(s.bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" className="mr-auto" onClick={onUploadInstead}>
            <Upload className="size-3.5" data-icon="inline-start" />
            {t('Upload')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={ticked.size === 0}
            onClick={() => onAdd([...ticked])}
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            {t('Add games')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The drop target, in a window of its own.
 *
 * It is the whole window rather than a box inside one: a target you have
 * to aim at inside a layer you have already opened is a target twice, and
 * a 300 MB file deserves the biggest one the screen can give it.
 */
function UploadWindow({
  uploading,
  onFiles,
  onReject,
  onClose,
}: {
  uploading: string | null;
  onFiles: (files: FileList | File[]) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const drop = useFileDrop({
    accept: byExtension('.pgn'),
    onFiles,
    onReject,
    disabled: uploading !== null,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Upload PGN collections" icon={Upload}>
        <label
          {...drop.handlers}
          className={cn(
            'text-muted-foreground flex min-h-40 cursor-pointer flex-col items-center justify-center',
            'gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm',
            'transition-colors duration-100',
            drop.dragging
              ? 'border-primary bg-muted text-primary'
              : 'border-border hover:border-primary/40 hover:bg-accent',
          )}
        >
          <input
            type="file"
            accept=".pgn"
            multiple
            className="hidden"
            disabled={uploading !== null}
            onChange={(e) => {
              onFiles(e.target.files ?? []);
              e.target.value = '';
            }}
          />
          {uploading ? (
            <>
              <Spinner className="size-6" />
              <span className="min-w-0 max-w-full truncate">
                {t('Uploading {name}…', { name: uploading })}
              </span>
            </>
          ) : (
            <>
              <Upload className="size-6" />
              <span className="text-foreground text-base font-medium">{t('Choose .pgn files')}</span>
              <span className="text-muted-foreground leading-relaxed">
                {t('Or drop them anywhere in this box')}
              </span>
            </>
          )}
        </label>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(
            'A collection is any .pgn of games — a Lichess Elite month, a Lumbra export. Uploads stream, so a large one keeps going while you watch it.',
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Naming the build, in a window of its own.
 *
 * The name field was a permanent row under the collections list, which
 * made it look like a filter on the list above it. Asked at the moment of
 * building, it reads as what it is — and there is room to say what
 * happens if the name is one that already exists.
 */
function BuildWindow({
  count,
  only,
  existing,
  onBuild,
  onClose,
}: {
  count: number;
  /** The single picked file, whose name the build takes when left blank. */
  only?: string;
  /** Databases already on the shelf, for the taken-name choice below. */
  existing: string[];
  onBuild: (name: string, mode: 'replace' | 'append') => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');
  const derived = only?.replace(/\.pgn$/i, '') ?? 'refgames';
  // The question is asked only when it exists — the same shape as the
  // book importer's update-or-rebuild choice.
  const taken = existing.includes(name.trim() || derived);
  const go = (): void => {
    if (count > 0) onBuild(name, taken ? mode : 'replace');
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Build a database" icon={Database}>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {count > 0
            ? t('Indexing {n} collections into one searchable database of whole games.', {
                n: count,
              })
            : t('No PGN collections are ticked — pick them on the PGN collections tab first.')}
        </p>
        <ClearableInput
          inputSize="sm"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder={t('Name — “{name}” if blank', { name: derived })}
        />
        {taken ? (
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'replace' | 'append')}>
            <Field orientation="horizontal">
              <RadioGroupItem value="replace" id="build-replace" />
              <FieldLabel htmlFor="build-replace" className="font-normal">
                {t('Replace — build this database again from the picked collections.')}
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="append" id="build-append" />
              <FieldLabel htmlFor="build-append" className="font-normal">
                {t('Add to it — index only the games it does not already hold.')}
              </FieldLabel>
            </Field>
          </RadioGroup>
        ) : (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('Building keeps going if you leave the page.')}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="default" size="sm" disabled={count === 0} onClick={go}>
            <Database className="size-3.5" data-icon="inline-start" />
            {taken && mode === 'append' ? t('Add games') : t('Build')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
