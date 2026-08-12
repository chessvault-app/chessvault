import {
  Folder as FolderIcon,
  FolderInput,
  NotebookPen,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { navigate } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { ShelfCard } from '@/ui/ShelfCard';
import { ShelfFolderHeader } from '@/ui/ShelfFolderHeader';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { MoveToPopover } from '@/ui/MoveToPopover';
import { PromptSheet } from '@/ui/PromptSheet';
import { CreateControl } from '@/ui/Fab';
import { SearchInput } from '@/ui/Input';
import { SkeletonCards, useSlowLoad } from '@/ui/Skeleton';
import { t } from '@/lib/i18n';
// The note EDITOR is TipTap and ProseMirror — by a distance the heaviest
// thing in the app. The list needs none of it, so opening Notes no longer
// pays for it; it loads when a note is actually opened.
const NoteView = lazyRoute(() => import('./NoteView').then((m) => ({ default: m.NoteView })));

interface NoteMeta {
  id: string;
  bytes: number;
  updatedAt: string;
  /** The note's first line of prose, if the server could find one. */
  excerpt?: string | null;
}

const API = '/api/notes';

/**
 * POST json, and give back the message to show — or null if it worked.
 *
 * The same eight lines of "read the body, find .error, translate it, else
 * 'failed'" were written out at every call site, and one of them had lost
 * its indentation and half its meaning.
 */
async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  return t(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'failed');
}

/** Router shell for Notes: the list, or one open note. */
export function NotesView({ params }: { params: string[] }) {
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? (
    <Suspense fallback={<div className="h-full" />}>
      <NoteView id={id} />
    </Suspense>
  ) : (
    <NoteList />
  );
}

function NoteList() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useSlowLoad(!loaded);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(API);
      const body = (await res.json()) as { studies: NoteMeta[]; folders: string[] };
      setNotes(body.studies);
      setFolders(body.folders);
      setLoaded(true);
      setError(null);
    } catch {
      setLoaded(true);
      setError(t('vault server unreachable'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? notes.filter((n) => n.id.toLowerCase().includes(needle)) : notes;

  // Removal is immediate and undoable: the row goes, and the DELETE waits
  // until the undo has had its say (useUndoable).
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const unhide = (id: string): void =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  const dropNote = (id: string): void => {
    setHidden((prev) => new Set(prev).add(id));
    undoable.remove(
      id.split('/').at(-1)!,
      () => {
        void fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(async () => {
          unhide(id);
          await refresh();
        });
      },
      () => unhide(id),
    );
  };

  return (
    // The studies shelf's shell, exactly: the two shelves hold the same kind
    // of thing and had no business being different sizes.
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t('Notes')}</h1>
        <div className="flex items-center gap-2">
          <SearchInput
            type="text"
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search notes…')}
            className="w-48"
          />
          <CreateMenu notes={notes} onDone={refresh} />
        </div>
      </header>

      {error && <p className="text-bad text-xs">{error}</p>}

      {!loaded ? (
        pending ? <SkeletonCards cards={5} /> : null
      ) : notes.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <NotebookPen className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-sm text-sm leading-relaxed">
            {t('No notes yet. A note is plain markdown in')}{' '}
            <code className="font-mono text-xs">vault/notes/</code>{' '}
            {t('with interactive chess boards embedded anywhere in the text.')}
          </p>
        </div>
      ) : (
        <GroupedNotes
          notes={visible.filter((n) => !hidden.has(n.id))}
          allFolders={needle ? [] : folders}
          onChanged={refresh}
          onRemove={dropNote}
        />
      )}

      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
        />
      )}
    </div>
  );
}

function CreateMenu({ notes, onDone }: { notes: NoteMeta[]; onDone: () => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Either popover (the menu or the name form) dismisses on outside click.
  const menuHost = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'note' | 'folder' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * A new note is made and opened. Naming it first asked for the one thing
   * you cannot know before writing any of it; the note's own header renames
   * it whenever the subject becomes clear.
   */
  const createNote = async (): Promise<void> => {
    const base = t('Untitled note');
    const taken = new Set(notes.map((n: NoteMeta) => n.id));
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base} ${n}`;
    const err = await post(API, { name: id });
    if (err) setFailure(err);
    else navigate('notes', encodeURIComponent(id));
  };

  // The name comes from the prompt sheet, which owns its own draft.
  const submit = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed || !mode) return;
    if (mode === 'folder') {
      const err = await post(`${API}/folders`, { name: trimmed });
      setFailure(err);
      if (!err) {
        setMode(null);
        await onDone();
      }
      return;
    }
    const err = await post(API, { name: trimmed });
    if (err) setFailure(err);
    else navigate('notes', encodeURIComponent(trimmed));
  };

  useEffect(() => {
    if (!menuOpen && !mode) return;
    const onDown = (e: MouseEvent): void => {
      if (!menuHost.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setMode(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, mode]);

  return (
    <>
      <CreateControl
        actions={[
          { label: 'New note', icon: NotebookPen, onSelect: () => void createNote() },
          { label: 'New collection', icon: FolderIcon, onSelect: () => setMode('folder') },
        ]}
      />

      {/* The same one-line prompt the studies list uses — a note and a
          collection each ask for one name, and two different popovers for
          the same question was two things to learn. */}
      {mode && (
        <PromptSheet
          label={t('New collection')}
          initial=""
          submitLabel={t('Create')}
          closeOnSubmit={false}
          error={failure}
          onSubmit={(value) => void submit(value)}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}

function GroupedNotes({
  notes,
  allFolders,
  onChanged,
  onRemove,
}: {
  notes: NoteMeta[];
  allFolders: string[];
  onChanged: () => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const groups = new Map<string, NoteMeta[]>();
  for (const folder of allFolders) groups.set(folder, []);
  // The server lists by last-modified, which reshuffles the shelf every time
  // a note is touched. A shelf should be STABLE — sort by name instead.
  const stable = [...notes].sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
  for (const note of stable) {
    const slash = note.id.lastIndexOf('/');
    const folder = slash === -1 ? '' : note.id.slice(0, slash);
    const list = groups.get(folder);
    if (list) list.push(note);
    else groups.set(folder, [note]);
  }
  const folders = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  return (
    <div className="flex flex-col gap-4">
      {folders.map((folder) => (
        <section key={folder || '(root)'} className="flex flex-col gap-2">
          {folder && (
            // Not a bare heading any more: a notes collection could be made
            // but never renamed or removed, which left the only way to do
            // either outside the app.
            <ShelfFolderHeader
              folder={folder}
              empty={groups.get(folder)!.length === 0}
              onRename={async (next) => {
                // folders/move, not move: the document route appends the
                // extension, so renaming a collection through it looked for
                // a file called "Scratch.md" and reported no such note.
                const err = await post(`${API}/folders/move`, { from: folder, to: next });
                await onChanged();
                return err;
              }}
              onDelete={async () => {
                const res = await fetch(`${API}/folders/${encodeURIComponent(folder)}`, {
                  method: 'DELETE',
                });
                const err = res.ok
                  ? null
                  : t(
                      ((await res.json().catch(() => null)) as { error?: string } | null)?.error ??
                        'failed',
                    );
                await onChanged();
                return err;
              }}
            />
          )}
          {groups.get(folder)!.length === 0 ? (
            <p className="text-subtle px-1 text-xs">{t('Empty collection.')}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {groups.get(folder)!.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  allFolders={allFolders}
                  onChanged={onChanged}
                  onRemove={() => onRemove(note.id)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function NoteCard({
  note,
  allFolders,
  onChanged,
  onRemove,
}: {
  note: NoteMeta;
  allFolders: string[];
  onChanged: () => Promise<void>;
  onRemove: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const name = note.id.split('/').at(-1)!;
  const folder = note.id.includes('/') ? note.id.slice(0, note.id.lastIndexOf('/')) : '';

  const rename = async (value: string): Promise<void> => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === name) return;
    setFailure(await post(`${API}/move`, { from: note.id, to: folder ? `${folder}/${next}` : next }));
    await onChanged();
  };

  const move = async (to: string): Promise<void> => {
    setFailure(await post(`${API}/move`, { from: note.id, to }));
    await onChanged();
  };

  return (
    <ShelfCard
      icon={NotebookPen}
      title={name}
      meta={
        <span title={formatWhen(note.updatedAt)}>
          {t('{n} KB', { n: (note.bytes / 1024).toFixed(1) })} ·{' '}
          {t('edited {when}', { when: formatAgo(note.updatedAt) })}
        </span>
      }
      // What the note is actually about. A shelf of markdown files whose
      // names are all "Opening prep checklist 3" tells you nothing; its
      // first sentence does.
      preview={note.excerpt}
      error={failure}
      onOpen={() => navigate('notes', encodeURIComponent(note.id))}
      onSwipeAway={onRemove}
      actions={[
        { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
        { label: 'Move to a collection', icon: FolderInput, onSelect: () => setMoving(true) },
        { label: 'Remove', icon: Trash2, danger: true, onSelect: onRemove },
      ]}
    >
      {renaming && (
        <PromptSheet
          label={t('Rename this note')}
          initial={name}
          onSubmit={(value) => void rename(value)}
          onClose={() => setRenaming(false)}
        />
      )}

      {moving && (
        <MoveToPopover
          currentFolder={folder}
          folders={allFolders}
          onPick={(target) => {
            setMoving(false);
            void move(target ? `${target}/${name}` : name);
          }}
          onClose={() => setMoving(false)}
        />
      )}
    </ShelfCard>
  );
}
