import {
  Bookmark,
  SearchX,
  Folder as FolderIcon,
  FolderInput,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { lazyRoute } from '@/lib/lazyRoute';
import { navigate } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { ShelfCard, type ShelfLayout } from '@/components/shelf-card';
import { ShelfFolderHeader } from '@/components/shelf-folder-header';
import { ShelfToolbar, sortDocs, useShelfView, type ShelfDir, type ShelfSort } from '@/components/shelf-toolbar';
import { PageShell } from '@/components/page-shell';
import { useUndoable } from '@/hooks/use-undoable';
import { MoveToDialog } from '@/components/move-to-dialog';
import { PromptDialog } from '@/components/prompt-dialog';
import { CreateControl, FabSpacer } from '@/components/fab';
import { SkeletonCards, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { t } from '@/lib/i18n';
import { api, apiErrorMessage } from '@/lib/api';
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
  /** Where the note's first embedded board starts. */
  fen?: string | null;
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
  try {
    await api(url, { method: 'POST', json: body });
    return null;
  } catch (error) {
    return t(apiErrorMessage(error));
  }
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

/**
 * Make an "Untitled note" and open it. Returns an error to show, or null.
 *
 * Module-level because two places offer this now: the Create menu, and
 * the empty shelf, whose whole job is to end on the press that fills it.
 */
async function newUntitledNote(
  notes: NoteMeta[],
  onDone: () => Promise<void>,
): Promise<string | null> {
  const base = t('Untitled note');
  const taken = new Set(notes.map((n) => n.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base} ${n}`;
  const err = await post(API, { name: id });
  if (err) return err;
  await onDone();
  navigate('notes', encodeURIComponent(id));
  return null;
}

function NoteList() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [markedIds, setMarked] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useSlowLoad(!loaded);
  const view = useShelfView('notes');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [body, marks] = await Promise.all([
        api<{ studies: NoteMeta[]; folders: string[] }>(API),
        // Missing bookmarks are an empty set, not a broken shelf.
        api<{ ids: string[] }>(`${API}/bookmarks`).catch(() => null),
      ]);
      setNotes(body.studies);
      setFolders(body.folders);
      setMarked(new Set(marks?.ids ?? []));
      setLoaded(true);
      setError(null);
    } catch (error) {
      setLoaded(true);
      setError(t(apiErrorMessage(error)));
    }
  }, []);

  /**
   * Bookmarked notes, kept in the vault rather than the browser — the same
   * place the games shelf keeps its own. The state is optimistic: a mark
   * that waits for a round trip before it shows reads as broken.
   */
  const toggleMark = async (id: string): Promise<void> => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    try {
      await api(`${API}/bookmarks/toggle`, { method: 'POST', json: { id } });
    } catch {
      // The vault disagreed (or was unreachable): put its truth back.
      await refresh();
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = notes.filter(
    (n) =>
      (!markedOnly || markedIds.has(n.id)) && (!needle || n.id.toLowerCase().includes(needle)),
  );
  /** Whether anything is narrowing the shelf — the two filters `visible`
      is built from, and the only reason an empty list can be blamed on
      something the reader can undo. */
  const filtering = markedOnly || needle !== '';

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
        void api(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
          .then(async () => {
            unhide(id);
            await refresh();
          })
          .catch((error: unknown) => {
            // The DELETE never landed, so the note still exists; hiding it
            // any longer would be the shelf lying about the vault.
            unhide(id);
            setError(t(apiErrorMessage(error)));
          });
      },
      () => unhide(id),
    );
  };

  return (
    // The studies shelf's tier, exactly: the two shelves hold the same kind
    // of thing and had no business being different sizes.
    <PageShell width="wide">
      <ShelfToolbar
        title={t('Notes')}
        query={query}
        onQuery={setQuery}
        placeholder={t('Search notes…')}
        markedOnly={markedOnly}
        onMarkedOnly={setMarkedOnly}
        sort={view.sort}
        onSort={view.setSort}
        dir={view.dir}
        onDir={view.setDir}
        layout={view.layout}
        onLayout={view.setLayout}
        create={<CreateMenu notes={notes} onDone={refresh} />}
      />

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loaded ? (
        pending ? (
          <SkeletonCards
            cards={5}
            layout={view.layout}
            gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          />
        ) : null
      ) : /* Nothing in the vault at all — no note at any depth (the listing
             walks the tree) and not one collection either. A shelf holding
             only empty collections is NOT this: it has something to show,
             and GroupedNotes below shows it. */
      notes.length === 0 && folders.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No notes yet"
          body="A note is plain markdown with interactive boards embedded anywhere in the text — an idea, a plan, a game to come back to."
          action={
            <Button variant="default" size="sm" onClick={() => void newUntitledNote(notes, refresh)}>
              <Plus className="size-3.5" data-icon="inline-start" />
              {t('New note')}
            </Button>
          }
        />
      ) : /* A filter is on and matches nothing. Without this the list was
            simply absent under its own toolbar, which reads as the shelf
            having been emptied rather than as a filter being on.

            `filtering &&` is what keeps it honest: an unfiltered shelf with
            no notes in it has nothing to blame a filter for, and used to be
            told nothing matched a search nobody had typed — under a Clear
            search button with nothing to clear. That shelf falls through to
            the list, which draws its collections. */
      filtering && visible.length === 0 ? (
        markedOnly && !needle ? (
          <EmptyState
            icon={Bookmark}
            title="No bookmarked notes yet"
            body="Bookmark a note from the shelf and it is kept here, one press from wherever you are."
            action={
              <Button variant="default" size="sm" onClick={() => setMarkedOnly(false)}>
                <NotebookPen className="size-3.5" data-icon="inline-start" />
                {t('Browse all notes')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="Nothing matches that search"
            body={
              markedOnly
                ? 'No bookmarked note matches it. Clearing the search shows every bookmark again.'
                : 'No note matches it. Clearing the search shows the whole shelf again.'
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                <X className="size-3.5" data-icon="inline-start" />
                {t('Clear search')}
              </Button>
            }
          />
        )
      ) : (
        <GroupedNotes
          notes={visible.filter((n) => !hidden.has(n.id))}
          allFolders={needle ? [] : folders}
          markedIds={markedIds}
          onToggleMark={(id) => void toggleMark(id)}
          sort={view.sort}
          dir={view.dir}
          layout={view.layout}
          onChanged={refresh}
          onRemove={dropNote}
        />
      )}


      <FabSpacer />
    </PageShell>
  );
}

function CreateMenu({ notes, onDone }: { notes: NoteMeta[]; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'note' | 'folder' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * A new note is made and opened. Naming it first asked for the one thing
   * you cannot know before writing any of it; the note's own header renames
   * it whenever the subject becomes clear.
   */
  const createNote = async (): Promise<void> => {
    setFailure(await newUntitledNote(notes, onDone));
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

  // No outside-click handler here — see the note in StudiesView. The one
  // that used to be here closed the prompt before its own Create button
  // could fire, so a collection could not be made.

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
        <PromptDialog
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
  markedIds,
  onToggleMark,
  sort,
  dir,
  layout,
  onChanged,
  onRemove,
}: {
  notes: NoteMeta[];
  allFolders: string[];
  markedIds: Set<string>;
  onToggleMark: (id: string) => void;
  sort: ShelfSort;
  dir: ShelfDir;
  layout: ShelfLayout;
  onChanged: () => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const groups = new Map<string, NoteMeta[]>();
  for (const folder of allFolders) groups.set(folder, []);
  // One order, the chosen one — see GroupedStudies. A mark is a filter,
  // not a place in the list.
  for (const note of sortDocs(notes, sort, dir)) {
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
                let err: string | null = null;
                try {
                  await api(`${API}/folders/${encodeURIComponent(folder)}`, { method: 'DELETE' });
                } catch (error) {
                  err = t(apiErrorMessage(error));
                }
                await onChanged();
                return err;
              }}
            />
          )}
          {groups.get(folder)!.length === 0 ? (
            <p className="text-muted-foreground px-1 text-sm">{t('Empty collection.')}</p>
          ) : (
            <ul className={layout === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-1.5'}>
              {groups.get(folder)!.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  allFolders={allFolders}
                  marked={markedIds.has(note.id)}
                  onToggleMark={() => onToggleMark(note.id)}
                  layout={layout}
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
  marked,
  onToggleMark,
  layout,
  onChanged,
  onRemove,
}: {
  note: NoteMeta;
  allFolders: string[];
  marked: boolean;
  onToggleMark: () => void;
  layout: ShelfLayout;
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
      // first sentence, its tags and the board it opens with do.
      preview={note.excerpt}
      fen={note.fen}
      marked={marked}
      onToggleMark={onToggleMark}
      layout={layout}
      error={failure}
      onOpen={() => navigate('notes', encodeURIComponent(note.id))}
      onSwipeAway={onRemove}
      actions={[
        {
          // Touch only: a desktop has the bookmark in the card's own
          // corner, two centimetres from the ⋯ that opened this.
          label: marked ? 'Remove bookmark' : 'Bookmark',
          icon: Bookmark,
          className: 'pointer-fine:hidden',
          onSelect: onToggleMark,
        },
        { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
        { label: 'Move to a collection', icon: FolderInput, onSelect: () => setMoving(true) },
        { label: 'Remove', icon: Trash2, danger: true, onSelect: onRemove },
      ]}
    >
      {renaming && (
        <PromptDialog
          label={t('Rename this note')}
          initial={name}
          onSubmit={(value) => void rename(value)}
          onClose={() => setRenaming(false)}
        />
      )}

      {moving && (
        <MoveToDialog
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
