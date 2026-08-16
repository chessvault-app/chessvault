import { Loader2, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { t } from '@/lib/i18n';

import { Button } from '@/ui/Button';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { Input } from '@/ui/Input';

/**
 * The reference databases and the PGN collections they are built from.
 *
 * Lived inside games/EliteGames.tsx, because the elite browser was the
 * only thing that showed it. It has three consumers now — the Databases
 * page, the browser's own window, and the explorer's — and a static
 * import of the browser was pulling its 30 kB into whatever asked. Moving
 * the manager out is the whole of that fix: nothing here changed.
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

/**
 * Manage the reference databases: upload PGN collections and build a named
 * database from a selection of them. Every part of it works from a phone
 * against a remote server: uploads stream, and the build is a server child
 * process that keeps going if the page is left.
 *
 * Rendered two ways: inline as the browser's empty state (where building
 * the first database IS the page's purpose), and inside a window from the
 * ready browser. Databases are plural like books, so replacing one is not
 * a mode — build a new name beside it and delete the old.
 *
 * DELETING is the Databases page's alone (`grid`), for either kind. The
 * window over the browser is opened to pick or add something, generally
 * mid-search, and putting the one irreversible control in the app on that
 * surface makes every visit to it a chance to lose an upload. Deleting is
 * a trip to the page that is about the data, and the window says where
 * that is.
 *
 * Where it is offered, it asks first through ConfirmSheet — a centred
 * window on a desktop, a bottom sheet on a phone. Nothing here keeps a
 * copy, so the question is the only thing in the way.
 */
export function RefDbManager({
  databases,
  onChanged,
  layout = 'stack',
}: {
  databases: RefDb[];
  onChanged: () => void;
  /** `stack` fits the browser's window; `grid` composes the Databases
      page — what exists beside how more is made, not one tall pile. */
  layout?: 'stack' | 'grid';
}) {
  // `grid` is the Databases page and nothing else, and deleting lives
  // there. Kept as one named thing so both lists read from one decision.
  const canDelete = layout === 'grid';
  const [sources, setSources] = useState<{ name: string; bytes: number }[] | null>(null);
  // null until the first listing arrives, so "tick everything" happens
  // once and a user's unticking is never overwritten by a refresh.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    running: boolean;
    exitCode?: number | null;
    log?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const refreshSources = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/sources');
      const body = (await res.json()) as { sources: { name: string; bytes: number }[] };
      setSources(body.sources);
      setPicked((p) => p ?? new Set(body.sources.map((s) => s.name)));
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  // Poll the build while one runs; refresh the browser when it finishes.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      try {
        const s = (await (await fetch('/api/refgames/build/status')).json()) as {
          running: boolean;
          exitCode?: number | null;
          log?: string[];
        };
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

  // One at a time as a raw body, which streams — these files run to
  // hundreds of megabytes, and FormData would buffer the whole thing in
  // the page before a byte left. Same route the book manager uses.
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
        const res = await fetch(`/api/sources?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(`${file.name}: ${t(body?.error ?? res.statusText)}`);
        } else {
          setPicked((p) => new Set(p ?? []).add(file.name));
        }
      } catch {
        setError(t('{name}: upload failed', { name: file.name }));
      }
    }
    setUploading(null);
    await refreshSources();
  };

  const build = async (): Promise<void> => {
    setError(null);
    const res = await fetch('/api/refgames/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || undefined, sources: [...(picked ?? [])] }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(t(body?.error ?? 'could not start the build'));
      return;
    }
    setName('');
    setStatus({ running: true, log: [] });
    wasRunning.current = true;
  };

  const del = async (dbName: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/refgames/${encodeURIComponent(dbName)}`, { method: 'DELETE' });
      if (res.ok) onChanged();
      else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(t(body?.error ?? 'could not delete the database'));
      }
    } catch {
      setError(t('could not delete the database'));
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
      const res = await fetch(`/api/sources/${encodeURIComponent(sourceName)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPicked((p) => {
          if (!p?.has(sourceName)) return p;
          const next = new Set(p);
          next.delete(sourceName);
          return next;
        });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(`${sourceName}: ${t(body?.error ?? 'could not delete the PGN collection')}`);
      }
    } catch {
      setError(`${sourceName}: ${t('could not delete the PGN collection')}`);
    }
    // Either way the server's listing is the one to believe: a row leaves
    // because the file did, not because it was pressed.
    await refreshSources();
  };

  const running = status?.running === true;
  const failed = !running && status?.exitCode != null && status.exitCode !== 0;

  const pgnDrop = useFileDrop({
    accept: byExtension('.pgn'),
    onFiles: (files) => void upload(files),
    onReject: () => setError(t('Only .pgn files can be uploaded here')),
    disabled: uploading !== null,
  });

  const dbListBlock = (
    <div className="flex flex-col gap-1">
      <p className="text-muted font-medium">{t('Databases')}</p>
      {databases.length === 0 ? (
        <p className="text-subtle leading-relaxed">
          {t('No databases yet — build one from an uploaded collection.')}
        </p>
      ) : (
        <RefDbList databases={databases} onDelete={canDelete ? (n) => void del(n) : undefined} />
      )}
    </div>
  );

  const collectionsBlock = (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted font-medium">{t('PGN collections')}</p>
      {sources !== null && sources.length === 0 && (
        <p className="text-subtle leading-relaxed">
          {t(
            'Nothing uploaded yet. A collection is any .pgn of games — a Lichess Elite month, a Lumbra export.',
          )}
        </p>
      )}
      {sources !== null && sources.length > 0 && (
        <ul className="flex flex-col gap-1">
          {sources.map((s) => (
            <li key={s.name} className="flex items-center gap-1">
              {/* The label covers the tick, the name and the size, and
                  nothing else: a button inside it would toggle the tick on
                  its way to being pressed. */}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={picked?.has(s.name) ?? false}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = new Set(p ?? []);
                      if (e.target.checked) next.add(s.name);
                      else next.delete(s.name);
                      return next;
                    })
                  }
                />
                <span className="text-fg min-w-0 flex-1 truncate">{s.name}</span>
                <span className="text-subtle shrink-0">{(s.bytes / 1e6).toFixed(1)} MB</span>
              </label>
              {/* Uploading is how a phone gets a file onto the server, so
                  deleting one has to be possible there too — the app was
                  the only way in and the shell was the only way out. On
                  the Databases page only, and disabled while a build runs:
                  it is reading these files, and the server refuses it for
                  the same reason. */}
              {canDelete && (
                <ConfirmSheet
                  icon={Trash2}
                  triggerClassName="shrink-0"
                  disabled={running}
                  triggerTitle={
                    running ? 'Wait for the build to finish' : 'Delete this PGN collection'
                  }
                  question={t(
                    'Delete “{name}”? Databases already built from it are not affected.',
                    { name: s.name },
                  )}
                  confirmLabel="Delete"
                  onConfirm={() => void delSource(s.name)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
        {/* A drop target has to look like somewhere a file can land. This
            was a 32px strip — the height of a button, which is what it
            read as, and a target that small is a poor one to let go of a
            300 MB file over. It is a box now, on both surfaces, with the
            drop said out loud under the press it also is. */}
        <label
          {...pgnDrop.handlers}
          className={cn(
            'text-muted flex min-h-24 cursor-pointer flex-col items-center justify-center',
            'gap-1.5 rounded-lg border border-dashed px-3 py-5 text-center',
            'transition-colors duration-100',
            pgnDrop.dragging
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
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
          {uploading ? (
            <>
              <Loader2 className="size-5 animate-spin" />
              <span className="min-w-0 max-w-full truncate">
                {t('Uploading {name}…', { name: uploading })}
              </span>
            </>
          ) : (
            <>
              <Upload className="size-5" />
              <span className="text-fg font-medium">{t('Upload PGN collections')}</span>
              <span className="text-subtle leading-relaxed">
                {t('Or drop .pgn files anywhere in this box')}
              </span>
            </>
          )}
        </label>
    </div>
  );

  const buildBlock = (
    <>
      {running ? (
        <p className="text-subtle flex items-center gap-2 font-mono text-[0.6875rem]">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="min-w-0 truncate">{status?.log?.at(-1) ?? '…'}</span>
        </p>
      ) : (
        (sources?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <Input
              inputSize="sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Name — the file’s name if blank')}
              className="min-w-0 flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={(picked?.size ?? 0) === 0}
              onClick={() => void build()}
            >
              {t('Build')}
            </Button>
          </div>
        )
      )}
      {failed && (
        <p className="text-bad font-mono text-[0.6875rem]">
          {status?.log?.at(-1) ?? t('The build failed.')}
        </p>
      )}
      {error && <p className="text-bad">{error}</p>}
      <p className="text-subtle leading-relaxed">
        {t('Building keeps going if you leave the page. A build under an existing name replaces that database.')}
      </p>
    </>
  );

  if (layout === 'grid') {
    return (
      <div className="grid items-start gap-x-8 gap-y-3 text-xs md:grid-cols-2">
        {dbListBlock}
        <div className="flex flex-col gap-3">
          {collectionsBlock}
          {buildBlock}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      {databases.length > 0 && dbListBlock}
      {collectionsBlock}
      {buildBlock}
      {/* Deleting is not here, so this window has to say where it is —
          an action with no way to reach it is the bug the rule is about.
          Only once anything exists to delete. */}
      {(databases.length > 0 || (sources?.length ?? 0) > 0) && (
        <button
          type="button"
          className="text-subtle hover:text-fg self-start underline underline-offset-2 transition-colors duration-100"
          // `books` is the section id the Databases page has always had.
          onClick={() => navigate('books')}
        >
          {t('Delete databases and collections on the Databases page')}
        </button>
      )}
    </div>
  );
}

/** The built databases, one row each — name, size, and whether the
    position index is in place. */
function RefDbList({
  databases,
  onDelete,
}: {
  databases: RefDb[];
  /** Omitted where deleting is not on offer — see RefDbManager: it is the
      Databases page's, not the window the browser opens. */
  onDelete?: (name: string) => void;
}) {
  return (
    <ul className="divide-line border-line divide-y rounded-md border">
      {databases.map((d) => (
        // pr-1 leaves room for the trash's own padding. Without the
        // trash the row keeps the inset it has on every other side, and
        // the height the button was holding open.
        <li
          key={d.name}
          className={cn('flex items-center gap-2 pl-2.5', onDelete ? 'py-1 pr-1' : 'py-1.5 pr-2.5')}
        >
          <span className="text-fg min-w-0 flex-1 truncate font-medium" title={d.sources}>
            {d.name}
          </span>
          <span className="text-subtle shrink-0">
            {t('{n} games', { n: d.games.toLocaleString() })} · {(d.bytes / 1e6).toFixed(1)} MB
          </span>
          {/* Built before the position index existed: the explorer
              offers to add it when this database is its source. */}
          {d.indexed === false && <span className="text-warn shrink-0">{t('no position index')}</span>}
          {/* Asked in a window rather than warned about in a tooltip: a
              title nobody reads was all that stood between a press and
              however many minutes of indexing. */}
          {onDelete && (
            <ConfirmSheet
              icon={Trash2}
              triggerTitle="Delete this database"
              question={t('Delete “{name}”? The collections it was built from are kept.', {
                name: d.name,
              })}
              confirmLabel="Delete"
              onConfirm={() => onDelete(d.name)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
