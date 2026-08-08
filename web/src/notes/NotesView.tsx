import {
  ChevronDown,
  Folder as FolderIcon,
  FolderInput,
  NotebookPen,
  Plus,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { formatWhen } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { Select } from '@/ui/Select';
import { Input } from '@/ui/Input';
import { NoteView } from './NoteView';

interface NoteMeta {
  id: string;
  bytes: number;
  updatedAt: string;
}

const API = '/api/notes';

/** Router shell for Notes: the list, or one open note. */
export function NotesView({ params }: { params: string[] }) {
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <NoteView id={id} /> : <NoteList />;
}

function NoteList() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      setError('vault server unreachable');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = needle ? notes.filter((n) => n.id.toLowerCase().includes(needle)) : notes;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Notes</h1>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-48"
          />
          <CreateMenu folders={folders} onDone={refresh} />
        </div>
      </header>

      {error && <p className="text-bad text-xs">{error}</p>}

      {loaded && notes.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <NotebookPen className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-sm text-sm leading-relaxed">
            No notes yet. A note is plain markdown in{' '}
            <code className="font-mono text-xs">vault/notes/</code> with interactive chess boards
            embedded anywhere in the text.
          </p>
        </div>
      ) : (
        <GroupedNotes notes={visible} allFolders={needle ? [] : folders} onChanged={refresh} />
      )}
    </div>
  );
}

function CreateMenu({ folders, onDone }: { folders: string[]; onDone: () => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'note' | 'folder' | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !mode) return;
    if (mode === 'folder') {
      const res = await fetch(`${API}/folders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setFailure(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'failed');
        return;
      }
      setMode(null);
      setName('');
      await onDone();
      return;
    }
    const id = folder ? `${folder}/${trimmed}` : trimmed;
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: id }),
    });
    if (!res.ok) {
      setFailure(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'failed');
      return;
    }
    navigate('notes', encodeURIComponent(id));
  };

  return (
    <div className="relative">
      <Button variant="primary" size="sm" onClick={() => setMenuOpen((v) => !v)}>
        <Plus className="mr-1 size-3.5" />
        Create
        <ChevronDown className="ml-1 size-3" />
      </Button>

      {menuOpen && (
        <div className="border-line bg-surface absolute right-0 top-9 z-40 w-44 rounded-lg border p-1 shadow-[var(--shadow-pop)]">
          {(
            [
              ['note', 'New note', NotebookPen],
              ['folder', 'New collection', FolderIcon],
            ] as const
          ).map(([kind, label, Icon]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setMode(kind);
                setMenuOpen(false);
                setName('');
                setFailure(null);
              }}
              className="hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-100"
            >
              <Icon className="text-subtle size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {mode && (
        <div className="border-line bg-surface absolute right-0 top-9 z-40 flex w-72 flex-col gap-2 rounded-lg border p-3 shadow-[var(--shadow-pop)]">
          <p className="text-subtle text-xs font-semibold uppercase tracking-[0.08em]">
            {mode === 'note' ? 'New note' : 'New collection'}
          </p>
          {mode === 'note' && folders.length > 0 && (
            <Select
              value={folder}
              onChange={setFolder}
              ariaLabel="Collection"
              groups={[
                {
                  options: [
                    { value: '', label: '(no collection)' },
                    ...folders.map((f) => ({ value: f, label: f })),
                  ],
                },
              ]}
            />
          )}
          <Input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') setMode(null);
            }}
            placeholder={mode === 'note' ? 'Note name' : 'Collection name'}
          />
          {failure && <p className="text-bad text-xs">{failure}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!name.trim()} onClick={() => void submit()}>
              Create
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedNotes({
  notes,
  allFolders,
  onChanged,
}: {
  notes: NoteMeta[];
  allFolders: string[];
  onChanged: () => Promise<void>;
}) {
  const groups = new Map<string, NoteMeta[]>();
  for (const folder of allFolders) groups.set(folder, []);
  for (const note of notes) {
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
            <h2 className="text-subtle flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
              <FolderIcon className="size-3.5" />
              {folder}
            </h2>
          )}
          {groups.get(folder)!.length === 0 ? (
            <p className="text-subtle px-1 text-xs">Empty collection.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {groups.get(folder)!.map((note) => (
                <NoteCard key={note.id} note={note} allFolders={allFolders} onChanged={onChanged} />
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
}: {
  note: NoteMeta;
  allFolders: string[];
  onChanged: () => Promise<void>;
}) {
  const [moving, setMoving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const name = note.id.split('/').at(-1)!;
  const folder = note.id.includes('/') ? note.id.slice(0, note.id.lastIndexOf('/')) : '';

  const move = async (to: string): Promise<void> => {
    const res = await fetch(`${API}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: note.id, to }),
    });
    if (!res.ok) {
      setFailure(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'failed');
    }
    await onChanged();
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('notes', encodeURIComponent(note.id))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate('notes', encodeURIComponent(note.id));
        }}
        className={cn(
          'bg-surface border-line hover:border-line-strong group relative flex cursor-pointer',
          'items-center gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-panel)] transition-colors',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-fg truncate text-sm font-semibold">{name}</p>
          <p className="text-subtle text-xs">
            {(note.bytes / 1024).toFixed(1)} KB · {formatWhen(note.updatedAt)}
          </p>
          {failure && <p className="text-bad text-xs">{failure}</p>}
        </div>

        {(
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Move to a collection"
              active={moving}
              onClick={(e) => {
                e.stopPropagation();
                setMoving((v) => !v);
              }}
            >
              <FolderInput className="size-3.5" />
            </Button>
            <ConfirmPopover
              icon={Trash2}
              triggerTitle="Delete this note"
              question={`Delete “${name}”?`}
              confirmLabel="Delete"
              onConfirm={() => {
                void fetch(`${API}/${encodeURIComponent(note.id)}`, { method: 'DELETE' }).then(
                  () => void onChanged(),
                );
              }}
            />
          </div>
        )}

        {moving && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="border-line bg-surface absolute right-3 top-full z-40 mt-1 w-56 rounded-lg border p-1 shadow-[var(--shadow-pop)]"
          >
            <p className="text-subtle px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
              Move to
            </p>
            {['', ...allFolders.filter((f) => f !== folder)].map((target) =>
              target === folder ? null : (
                <button
                  key={target || '(root)'}
                  type="button"
                  onClick={() => {
                    setMoving(false);
                    void move(target ? `${target}/${name}` : name);
                  }}
                  className="hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100"
                >
                  <FolderIcon className="text-subtle size-3" />
                  {target || '(no collection)'}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </li>
  );
}
