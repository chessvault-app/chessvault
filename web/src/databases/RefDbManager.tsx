import { Database, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';

import { Button } from '@/ui/Button';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { ClearableInput, SearchInput } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Skeleton } from '@/ui/Skeleton';
import { Segmented } from '@/ui/Segmented';

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
      } catch (error) {
        setError(`${file.name}: ${t(apiErrorMessage(error))}`);
      }
    }
    setUploading(null);
    await refreshSources();
    // Land on what was just uploaded rather than on whatever tab the
    // window was opened from: the file is the thing that changed.
    setTab('sources');
  };

  const build = async (name: string): Promise<void> => {
    setError(null);
    try {
      await api('/api/refgames/build', {
        method: 'POST',
        json: { name: name.trim() || undefined, sources: [...(picked ?? [])] },
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
      setPicked((p) => {
        if (!p?.has(sourceName)) return p;
        const next = new Set(p);
        next.delete(sourceName);
        return next;
      });
    } catch (error) {
      setError(`${sourceName}: ${t(apiErrorMessage(error))}`);
    }
    // Either way the server's listing is the one to believe: a row leaves
    // because the file did, not because it was pressed.
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
      <DbList databases={shownDbs} onDelete={(n) => void del(n)} />
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
      <Panel flush className="min-h-0">
        {/* The switch gets the header to itself. Sharing it with the
            search meant the two segments were squeezed to whatever the
            field left over, and Segmented gives its segments equal
            widths — so the longer label wore its padding while the
            shorter one sat in slack.
            `w-fit` because PanelHeader's title slot is flex-1: left to
            the slot the control spanned the whole panel, which is the
            same complaint the other way up. fit-content over flex-1
            children resolves to twice the wider label, which is exactly
            a segmented control's natural size.
            `md` rather than `sm` for the padding: sm's px-1.5 left the
            Databases pill hugging its own text.
            `[&>button]:flex-none` because that alone did not settle it.
            Segmented's segments are flex-1, so both take the same width
            and the WIDER label fills its half exactly while the shorter
            is centred in slack — measured at 6px of breathing room
            against 14px, from one rule rather than a mistake. Released
            from flex-1 each segment wraps its own label and both wear
            the same px-2.5. Done here rather than in Segmented: equal
            widths are right for the archive's two providers and the
            shelf's grid/list switch, whose labels are the same length.
            `p-0.5` halves the track's own padding, which is what stood
            above and below the pills — but on a MOUSE only. A coarse
            pointer gets its 36px box back (`pointer-coarse:p-1`), because
            that size is a target, not a look, and the phone was right as
            it was. */}
        <PanelHeader
          className="h-auto py-2"
          title={
            <Segmented
              value={tab}
              onChange={setTab}
              ariaLabel="What to manage"
              className="w-fit p-0.5 pointer-coarse:p-1 [&>button]:flex-none"
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
          }
        />

        {/* Its own row, under the switch: the field wants the width, and
            on a phone there was never room for both on one line. */}
        <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-2">
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
          <p className="border-line text-subtle flex shrink-0 items-center gap-2 border-b px-3 py-2 font-mono text-[0.6875rem]">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 truncate">{status?.log?.at(-1) ?? '…'}</span>
          </p>
        )}
        {failed && (
          <p className="border-line text-bad shrink-0 border-b px-3 py-2 font-mono text-[0.6875rem]">
            {status?.log?.at(-1) ?? t('The build failed.')}
          </p>
        )}
        {error && <p className="border-line text-bad shrink-0 border-b px-3 py-2 text-xs">{error}</p>}

        {/* The list scrolls, the panel does not grow: one list at a time,
            capped, is what keeps the Build bar below in view. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shownCount === 0 ? (
            empty && <p className="text-subtle px-3 py-6 text-center text-xs leading-relaxed">{empty}</p>
          ) : (
            list
          )}
        </div>

        {/* Appears with the first tick and names its own count, so the
            press that starts minutes of indexing says what it is about
            to index. */}
        {tab === 'sources' && pickedCount > 0 && (
          <div className="border-line flex shrink-0 items-center gap-2 border-t px-3 py-2">
            <span className="text-subtle min-w-0 flex-1 truncate text-xs">
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
              variant="primary"
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
          onBuild={(name) => void build(name)}
          onClose={() => setShowBuild(false)}
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
    <Panel flush className="min-h-0">
      {/* Announced once, like every other skeleton here; ui/Skeleton's own
          wrapper is private to it. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        role="status"
        aria-label={t('Loading')}
        aria-live="polite"
      >
        {/* The switch: one box the size the segmented control settles at. */}
        <div className="border-line flex shrink-0 items-center border-b px-3 py-2">
          <Skeleton className="h-[1.9rem] w-52 rounded-xl" />
        </div>
        {/* The search row, and the upload icon beside it. */}
        <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Skeleton className="h-7 min-w-0 flex-1" />
          <Skeleton className="size-7 shrink-0" />
        </div>
        <ul className="divide-line min-h-0 flex-1 divide-y overflow-hidden">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5 pl-[17px] pr-1.5">
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
}: {
  databases: RefDb[];
  onDelete: (name: string) => void;
}) {
  return (
    <ul className="divide-line divide-y">
      {databases.map((d) => (
        // 17px: five past the search field's left border, which pl-3 sat
        // exactly on. An off-scale literal because it is answering the
        // eye rather than a measurement — nothing in the row above is at
        // 17 (the magnifier starts at 21, its placeholder at 41). The
        // scale's neighbours are 16 and 20, and lanph3re asked for this
        // one, so it is written as itself rather than rounded to look
        // principled.
        <li key={d.name} className="flex items-center gap-2 py-1.5 pl-[17px] pr-1.5 text-xs">
          <span className="text-fg min-w-0 flex-1 truncate font-medium" title={d.sources}>
            {d.name}
          </span>
          <span className="text-subtle shrink-0">
            {t('{n} games', { n: d.games.toLocaleString() })} · {mb(d.bytes)}
          </span>
          {/* Built before the position index existed: the explorer
              offers to add it when this database is its source. */}
          {d.indexed === false && <span className="text-warn shrink-0">{t('no position index')}</span>}
          {/* Asked in a window rather than warned about in a tooltip: a
              title nobody reads was all that stood between a press and
              however many minutes of indexing. */}
          <ConfirmSheet
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
    <ul className="divide-line divide-y">
      {sources.map((s) => (
        <li key={s.name} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5 text-xs">
          {/* The label covers the tick, the name and the size, and
              nothing else: a button inside it would toggle the tick on
              its way to being pressed. */}
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary shrink-0"
              checked={picked?.has(s.name) ?? false}
              onChange={(e) => onToggle(s.name, e.target.checked)}
            />
            <span className="text-fg min-w-0 flex-1 truncate">{s.name}</span>
            <span className="text-subtle shrink-0">{mb(s.bytes)}</span>
          </label>
          {/* Uploading is how a phone gets a file onto the server, so
              deleting one has to be possible there too — the app was the
              only way in and the shell was the only way out. Disabled
              while a build runs: it is reading these files, and the
              server refuses it for the same reason. */}
          <ConfirmSheet
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
    <Modal title="Upload PGN collections" icon={Upload} onClose={onClose}>
      <label
        {...drop.handlers}
        className={cn(
          'text-muted flex min-h-40 cursor-pointer flex-col items-center justify-center',
          'gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-xs',
          'transition-colors duration-100',
          drop.dragging
            ? 'border-primary bg-primary-soft text-primary'
            : 'border-line hover:border-primary/40 hover:bg-surface-2',
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
            <Loader2 className="size-6 animate-spin" />
            <span className="min-w-0 max-w-full truncate">
              {t('Uploading {name}…', { name: uploading })}
            </span>
          </>
        ) : (
          <>
            <Upload className="size-6" />
            <span className="text-fg text-sm font-medium">{t('Choose .pgn files')}</span>
            <span className="text-subtle leading-relaxed">
              {t('Or drop them anywhere in this box')}
            </span>
          </>
        )}
      </label>
      <p className="text-subtle text-xs leading-relaxed">
        {t(
          'A collection is any .pgn of games — a Lichess Elite month, a Lumbra export. Uploads stream, so a large one keeps going while you watch it.',
        )}
      </p>
    </Modal>
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
  onBuild,
  onClose,
}: {
  count: number;
  /** The single picked file, whose name the build takes when left blank. */
  only?: string;
  onBuild: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const derived = only?.replace(/\.pgn$/i, '') ?? 'refgames';

  return (
    <Modal title="Build a database" icon={Database} onClose={onClose}>
      <p className="text-muted text-xs leading-relaxed">
        {t('Indexing {n} collections into one searchable database of whole games.', { n: count })}
      </p>
      <ClearableInput
        inputSize="sm"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onBuild(name)}
        placeholder={t('Name — “{name}” if blank', { name: derived })}
      />
      <p className="text-subtle text-xs leading-relaxed">
        {t(
          'Building keeps going if you leave the page. A build under an existing name replaces that database.',
        )}
      </p>
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onBuild(name)}>
          <Database className="size-3.5" />
          {t('Build')}
        </Button>
      </div>
    </Modal>
  );
}
