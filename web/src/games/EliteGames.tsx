import {
  ChevronLeft,
  Database,
  Eye,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetCollection, loadCollection } from './collection';

import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';

import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/ui/Button';

import { Select } from '@/ui/Select';
import { Input, SearchInput } from '@/ui/Input';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { SideDot } from '@/ui/SideDot';
import { SkeletonGameRows, useSlowLoad } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';

import { Sheet } from '@/ui/Sheet';
import { t } from '@/lib/i18n';
import { GamePreview, OpeningTag, ResultScore, isCoarsePointer, type Preview } from './shared';

interface RefGame {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  opening: string | null;
}

interface RefDb {
  name: string;
  games: number;
  sources: string;
  bytes: number;
}

/**
 * Manage the reference databases: upload PGN collections, build a named
 * database from a selection of them, delete one — the book manager's
 * shapes over the same vault/sources uploads, because they are the same
 * job. Every part of it works from a phone against a remote server:
 * uploads stream, and the build is a server child process that keeps
 * going if the page is left.
 *
 * Rendered two ways: inline as the browser's empty state (where building
 * the first database IS the page's purpose), and inside a sheet from the
 * ready browser. Databases are plural like books, so replacing one is not
 * a mode — build a new name beside it and delete the old.
 */
function RefDbManager({ databases, onChanged }: { databases: RefDb[]; onChanged: () => void }) {
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
    const res = await fetch(`/api/refgames/${encodeURIComponent(dbName)}`, { method: 'DELETE' });
    if (res.ok) onChanged();
    else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(t(body?.error ?? 'could not delete the database'));
    }
  };

  const running = status?.running === true;
  const failed = !running && status?.exitCode != null && status.exitCode !== 0;

  const pgnDrop = useFileDrop({
    accept: byExtension('.pgn'),
    onFiles: (files) => void upload(files),
    onReject: () => setError(t('Only .pgn files can be uploaded here')),
    disabled: uploading !== null,
  });

  return (
    <div className="flex flex-col gap-3 text-xs">
      {databases.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-muted font-medium">{t('Databases')}</p>
          <ul className="divide-line border-line divide-y rounded-md border">
            {databases.map((d) => (
              <li key={d.name} className="flex items-center gap-2 py-1 pl-2.5 pr-1">
                <span className="text-fg min-w-0 flex-1 truncate font-medium" title={d.sources}>
                  {d.name}
                </span>
                <span className="text-subtle shrink-0">
                  {t('{n} games', { n: d.games.toLocaleString() })} · {(d.bytes / 1e6).toFixed(1)} MB
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Delete this database — deleting is final')}
                  onClick={() => void del(d.name)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-muted font-medium">{t('PGN collections')}</p>
        {sources !== null && sources.length === 0 && (
          <p className="text-subtle leading-relaxed">
            {t(
              'Nothing uploaded yet. A collection is any .pgn of games — a Lichess Elite month, a Lumbra export — and the same uploads build opening books.',
            )}
          </p>
        )}
        {sources !== null && sources.length > 0 && (
          <ul className="flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.name}>
                <label className="flex cursor-pointer items-center gap-2">
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
              </li>
            ))}
          </ul>
        )}
        <label
          {...pgnDrop.handlers}
          className={cn(
            'text-muted flex h-8 cursor-pointer items-center',
            'justify-center gap-1.5 rounded-md border border-dashed transition-colors duration-100',
            pgnDrop.dragging
              ? 'border-primary bg-primary-soft'
              : 'border-line hover:border-primary/40',
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
              <Loader2 className="size-3.5 animate-spin" />
              {t('Uploading {name}…', { name: uploading })}
            </>
          ) : (
            <>
              <Upload className="size-3.5" />
              {t('Upload PGN collections')}
            </>
          )}
        </label>
      </div>

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
    </div>
  );
}

/**
 * Browse the reference database (data/refgames.sqlite — Lichess Elite or
 * whatever PGN collections were indexed). Click a game to open it on the
 * analysis board.
 *
 * Three shapes, one component, because it is one thing:
 *
 * `column` — the second half of the column that finds games, behind the
 * tab beside Online archives. Where it belongs on a desktop: the archive
 * and the reference database answer the same question, so they take turns
 * in one panel rather than each taking a box.
 *
 * `window` — below lg, where there is no column. A bottom sheet on a
 * phone, like the archive. It used to navigate to a page of its own,
 * which loses the collection you were about to add to.
 *
 * `page` — its own route, still reachable and still where a 2M-row
 * browser has the most room. The only shape that draws its own frame, its
 * own title and a way back.
 */
export function EliteGames({ variant = 'window' }: { variant?: 'page' | 'window' | 'column' }) {
  const page = variant === 'page';
  // `databases` present = the server's directory mount, where databases
  // are named, picked, built and deleted. Absent = a single-database
  // mount (the static demo), which has none of that.
  const [meta, setMeta] = useState<{
    ready: boolean;
    games?: number;
    sources?: string;
    databases?: RefDb[];
  } | null>(null);
  const [curDb, setCurDb] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RefGame[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Nothing for the first moment — a search that answers in 40 ms should
  // not flash a skeleton on the way past.
  const searching = useSlowLoad(loading && rows.length === 0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A slow answer for "naj" must not overwrite the rows for "najdorf"
  // typed after it; whoever holds the latest number owns the state. Also
  // the reason for the finally: a thrown fetch used to strand `loading`.
  const searchSeq = useRef(0);
  const search = useCallback(async (q: string, offset: number, db: string | null) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const data = await api<{ total: number | null; rows: RefGame[] }>(
        `/api/refgames/search?q=${encodeURIComponent(q)}&offset=${offset}` +
          (db ? `&db=${encodeURIComponent(db)}` : ''),
      );
      if (seq !== searchSeq.current) return;
      // Only the first page of a search carries a total — counting matches
      // means scanning, and every later page would count the same thing.
      if (data.total !== null) setTotal(data.total);
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
    } catch {
      /* the rows keep their last answer; the spinner below stops */
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(() => {
    void fetch('/api/refgames')
      .then((r) => r.json())
      .then((d: { ready: boolean; games?: number; sources?: string; databases?: RefDb[] }) => {
        setMeta(d);
      });
  }, []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Reconcile the picked database against the list (a delete may have
  // taken it), then run its first search. Two passes when the pick moves:
  // the state change re-enters with the settled name.
  useEffect(() => {
    if (!meta?.ready) return;
    const dbs = meta.databases ?? null;
    const next = dbs ? (dbs.some((d) => d.name === curDb) ? curDb : (dbs[0]?.name ?? null)) : null;
    if (next !== curDb) {
      setCurDb(next);
      return;
    }
    setRows([]);
    setQuery('');
    void search('', 0, next);
  }, [meta, curDb, search]);

  const onQuery = (q: string): void => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q, 0, curDb), 250);
  };

  // Infinite scroll: a sentinel row near the list's end pulls the next
  // page as it approaches the viewport.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || rows.length === 0 || rows.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void search(query, rows.length, curDb);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading, query, search, curDb]);

  // Which database a game row means — every per-game fetch carries it,
  // and every per-game cache key does too: row ids restart at 1 in each
  // database, so a bare id would collide across them.
  const pgnUrl = (id: number): string =>
    `/api/refgames/${id}/pgn${curDb ? `?db=${encodeURIComponent(curDb)}` : ''}`;
  // Named apart from the module-level gameKey(summary) — the shadow made
  // any future edit in this component grab the wrong one silently.
  const refGameKey = (id: number): string => `${curDb ?? ''}:${id}`;

  const openGame = async (game: RefGame): Promise<void> => {
    const res = await fetch(pgnUrl(game.id));
    if (!res.ok) return;
    const { pgn } = (await res.json()) as { pgn: string };
    if (useAnalysis.getState().loadPgn(pgn)) {
      useAnalysis.setState({ handoff: true });
      navigate('analysis');
    }
  };

  // Keeping an elite game: its PGN becomes a collection document like any
  // promoted chess.com game — annotatable, searchable, yours. The
  // collection keys make already-kept games read 'Added' across reloads,
  // and the server refuses duplicates besides.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [collectionKeys, setCollectionKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    void loadCollection()
      .then((games) => setCollectionKeys(new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))))
      .catch(() => {});
  }, []);
  const inCollection = (g: RefGame): boolean =>
    added.has(refGameKey(g.id)) || collectionKeys.has(`${g.white}|${g.black}|${g.date ?? ''}`);
  const collect = async (game: RefGame): Promise<void> => {
    const res = await fetch(pgnUrl(game.id));
    if (!res.ok) return;
    const { pgn } = (await res.json()) as { pgn: string };
    const posted = await fetch('/api/games/collect-pgn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn }),
    });
    // 409 = already there; either way this game is now in the collection.
    if (posted.ok) forgetCollection();
    if (posted.ok || posted.status === 409) setAdded((prev) => new Set(prev).add(refGameKey(game.id)));
  };

  // Preview eye, matching the collection rows: the DB stores movetext,
  // not positions, so the final fen is derived lazily from the game's
  // PGN (cached per id). Coarse pointers tap it open, fine ones hover.
  const [preview, setPreview] = useState<Preview | null>(null);
  const fenCache = useRef<Map<string, string>>(new Map());
  const previewSeq = useRef(0);
  const previewFor = useRef<number | null>(null);
  const showPreview = async (game: RefGame, anchor: Element, viaTap = false): Promise<void> => {
    const seq = ++previewSeq.current;
    let fen = fenCache.current.get(refGameKey(game.id));
    if (!fen) {
      const res = await fetch(pgnUrl(game.id));
      if (!res.ok) return;
      const { pgn } = (await res.json()) as { pgn: string };
      try {
        const first = pgnToChapters(pgn)[0];
        if (!first) return;
        const lastId = mainlineFrom(first.tree, first.tree.rootId).at(-1) ?? first.tree.rootId;
        fen = getNode(first.tree, lastId).fen;
      } catch {
        return;
      }
      fenCache.current.set(refGameKey(game.id), fen);
    }
    if (seq !== previewSeq.current) return;
    const rect = anchor.getBoundingClientRect();
    setPreview({
      fen,
      orientation: 'white',
      top: Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200),
      left: Math.max(rect.left - 192, 8),
      // Touch opens the centred overlay (its scrim dismisses it), exactly
      // like the collection rows — a beside-row popover on a phone is
      // pointer-events-none AND covers the row it describes.
      ...(viaTap ? { pinned: true } : {}),
    });
  };
  const hidePreview = (): void => {
    previewSeq.current += 1;
    previewFor.current = null;
    setPreview(null);
  };
  const coarse = isCoarsePointer;

  if (meta && !meta.ready) {
    // The empty state IS the manager: building the first database is this
    // page's whole purpose until one exists. A single-database mount (the
    // demo) has no manager to offer, so it just says what is missing.
    return (
      <div className={cn('grid place-items-center p-6', page && 'h-full overflow-y-auto')}>
        <div className="w-full max-w-md">
          <p className="text-fg mb-1 text-center text-sm font-semibold">
            {t('No reference games yet')}
          </p>
          {meta.databases ? (
            <>
              <p className="text-muted mb-3 text-center text-xs leading-relaxed">
                {t('Upload PGN collections and index them into searchable databases of whole games.')}
              </p>
              <RefDbManager databases={meta.databases} onChanged={loadMeta} />
            </>
          ) : (
            <p className="text-muted text-center text-xs leading-relaxed">
              {t('This server has no reference games database.')}
            </p>
          )}
        </div>
      </div>
    );
  }

  const count =
    loading && rows.length === 0
      ? t('Searching…')
      : t('{n} games', { n: total.toLocaleString() });

  // The database picker (only when there is a choice) and the manager,
  // shown wherever the count is — absent entirely on a single-database
  // mount, which has neither names nor a manager.
  const dbs = meta?.databases;
  const dbControls = dbs && (
    <>
      {dbs.length > 1 && (
        <Select
          value={curDb ?? ''}
          onChange={setCurDb}
          ariaLabel={t('Reference database')}
          size="sm"
          align="end"
          className="max-w-[9rem]"
          groups={[{ options: dbs.map((d) => ({ value: d.name, label: d.name })) }]}
        />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Manage reference databases')}
        onClick={() => setManage(true)}
      >
        <Database className="size-3.5" />
      </Button>
    </>
  );
  const manageSheet = manage && dbs && (
    <Sheet label={t('Reference databases')} onClose={() => setManage(false)}>
      <div className="overflow-y-auto">
        <RefDbManager databases={dbs} onChanged={loadMeta} />
      </div>
    </Sheet>
  );

  const list = (
    <>
      {searching && <SkeletonGameRows rows={8} />}
      {/* The same stripe the collection list has: at three lines a row is
          tall enough that a hairline between rows disappears. */}
      <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto [&>li:nth-child(even)]:bg-fg/[0.022]">
          {rows.map((g) => (
            <li key={g.id} className="group hover:bg-surface-2 flex items-center gap-1 pr-2 transition-colors duration-100">
              {/* Mirrors the collection's GameRow — same bold names, same
                  ECO badge, same result tag — so the two lists read as one
                  family rather than as two takes on a game list. */}
              <button
                type="button"
                onClick={() => void openGame(g)}
                title={t('Open on the analysis board')}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.white}</span>{' '}
                    <span className="text-subtle text-xs">{g.white_elo}</span>
                  </span>
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.black}</span>{' '}
                    <span className="text-subtle text-xs">{g.black_elo}</span>
                  </span>
                  <span className="text-subtle block truncate text-xs">
                    {g.eco ? <OpeningTag eco={g.eco} name={g.opening} /> : g.opening}
                    {(g.eco || g.opening) && g.date ? ' · ' : ''}
                    {g.date ?? ''}
                  </span>
                </span>
                <ResultScore result={g.result} userSide={null} />
              </button>

              {/* The eye lives outside the row's own button — a button
                  inside a button is not markup a browser will keep — and
                  in the same hover tray the collection rows use. Add stays
                  put: it is the point of this page, not a quick action. */}
              <span
                className={cn(
                  'flex shrink-0 items-center rounded-lg p-0.5 transition-opacity duration-100',
                  'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  'group-hover:bg-surface-3/70 pointer-coarse:opacity-100',
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Preview the final position')}
                  onMouseEnter={(e) => {
                    if (!coarse()) void showPreview(g, e.currentTarget);
                  }}
                  onMouseLeave={() => {
                    if (!coarse()) hidePreview();
                  }}
                  onClick={(e) => {
                    if (!coarse()) return;
                    e.stopPropagation();
                    if (previewFor.current === g.id) {
                      hidePreview();
                    } else {
                      previewFor.current = g.id;
                      void showPreview(g, e.currentTarget, true);
                    }
                  }}
                >
                  <Eye className="size-3.5" />
                </Button>
              </span>

              {/* w-16 and a bare word when it is done, exactly like the
                  archive's rows: the two lists now take turns in one 210px
                  column, and 20 characters of player name is worth more
                  than a tick beside a word that is already past tense. */}
              <Button
                variant={inCollection(g) ? 'ghost' : 'secondary'}
                size="sm"
                className="w-16 shrink-0"
                disabled={inCollection(g)}
                onClick={() => void collect(g)}
              >
                {inCollection(g) ? (
                  t('Added')
                ) : (
                  <>
                    <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                    {t('Add')}
                  </>
                )}
              </Button>
            </li>
          ))}
          {rows.length < total && (
            <li ref={sentinel} className="flex items-center justify-center p-3">
              <Loader2 className="text-subtle size-4 animate-spin" />
            </li>
          )}
      </ul>
    </>
  );

  // In the column the panel and the tab that named it are already drawn:
  // this is only the field and the list, laid out like the archive's own
  // body so the two read as one panel that changed its mind.
  if (variant === 'column') {
    return (
      <>
        <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('Search players, openings, or ECO')}
            spellCheck={false}
            className="w-full"
          />
        </div>
        <div className="border-line shrink-0 border-t px-3 py-1 pr-1.5">
          <div className="flex min-h-6 items-center gap-1">
            <span className="text-subtle min-w-0 flex-1 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
              {count}
            </span>
            {dbControls}
          </div>
        </div>
        {list}
        <GamePreview preview={preview} onClose={hidePreview} />
        {manageSheet}
      </>
    );
  }

  const body = (
    <>
      <SearchInput
        inputSize="lg"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('Search players, openings, or ECO (e.g. Najdorf, B90)…')}
        spellCheck={false}
        className="w-full shrink-0"
      />

      {/* A page gives this the height it has left and the list scrolls
          inside it. A window has no height to give — it is as tall as what
          is in it, up to a cap — so the panel takes its natural size below
          sm and the window scrolls instead. Exactly what the archive
          browser does in the same window. */}
      <Panel flush className={page ? 'mt-1 min-h-0 flex-1' : 'shrink-0 sm:min-h-0 sm:flex-1'}>
        <PanelHeader title={count} actions={dbControls} />
        {list}
      </Panel>
      <GamePreview preview={preview} onClose={hidePreview} />
      {manageSheet}
    </>
  );

  // In a window the frame and the title belong to the window; only a page
  // has to draw its own, and a page is also the only one of the three that
  // needs a way back to where it came from.
  if (!page) return body;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('Back to games')} onClick={() => navigate('games')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          {(() => {
            // Dir mounts count across every database; a single mount says
            // its own meta. Either way the title is the whole shelf, while
            // the panel's count below is the database being searched.
            const all = dbs ? dbs.reduce((sum, d) => sum + d.games, 0) : (meta?.games ?? 0);
            return all
              ? `${t('Elite games')} (${t('{n} games', { n: all.toLocaleString() })})`
              : t('Elite games');
          })()}
        </h1>
      </div>
      {body}
    </div>
  );
}
