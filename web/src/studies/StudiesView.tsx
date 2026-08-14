import {
  Bookmark,
  CloudDownload,
  FileText,
  FileUp,
  Folder as FolderIcon,
  FolderInput,
  Library,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { navigate } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { pgnToChapters, studyNameFromPgn } from '@shared/pgn';
import { useStudy, type StudyMeta } from '@/store/study';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input, TextArea } from '@/ui/Input';
import { Field } from '@/ui/Field';
import { Globe, Loader2 } from 'lucide-react';
import { Modal } from '@/ui/Modal';
import { PromptSheet } from '@/ui/PromptSheet';
import { ShelfCard, type ShelfLayout } from '@/ui/ShelfCard';
import { ShelfFolderHeader } from '@/ui/ShelfFolderHeader';
import { ShelfToolbar, sortDocs, useShelfView, type ShelfDir, type ShelfSort } from '@/ui/ShelfToolbar';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { CreateControl, FabSpacer } from '@/ui/Fab';
import { SkeletonCards, useSlowLoad } from '@/ui/Skeleton';
import { EmptyState } from '@/ui/EmptyState';
import { BookmarkArt, CollectionArt, NoMatchArt } from '@/ui/EmptyArt';
import { MoveToPopover } from '@/ui/MoveToPopover';
import { StudyView } from './StudyView';
import { autoFocusField } from '@/lib/media';
import { t } from '@/lib/i18n';

/** Router shell for the Studies section: list, or one open study. */
export function StudiesView({ params }: { params: string[] }) {
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} /> : <StudyList />;
}

function StudyList() {
  const studies = useStudy((s) => s.studies);
  const folders = useStudy((s) => s.folders);
  const listLoaded = useStudy((s) => s.listLoaded);
  const error = useStudy((s) => s.error);
  const refresh = useStudy((s) => s.refresh);
  const create = useStudy((s) => s.create);

  const [query, setQuery] = useState('');
  const pending = useSlowLoad(!listLoaded);
  const view = useShelfView('studies');
  // Bookmarks, kept in the vault exactly as the games shelf keeps its
  // own — a mark belongs to the shelf, not to a browser.
  const [markedIds, setMarked] = useState<Set<string>>(new Set());
  const [markedOnly, setMarkedOnly] = useState(false);
  useEffect(() => {
    void fetch('/api/studies/bookmarks')
      .then((r) => (r.ok ? (r.json() as Promise<{ ids: string[] }>) : null))
      .then((body) => setMarked(new Set(body?.ids ?? [])))
      .catch(() => {});
  }, []);
  const toggleMark = async (id: string): Promise<void> => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    await fetch('/api/studies/bookmarks/toggle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  };
  // Removal is immediate and undoable rather than confirmed — see
  // useUndoable. `hidden` is what the list pretends is already gone.
  const removeStudy = useStudy((s) => s.remove);
  const undoable = useUndoable();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const dropStudy = (id: string): void => {
    setHidden((prev) => new Set(prev).add(id));
    undoable.remove(
      id.split('/').at(-1)!,
      () => {
        void removeStudy(id).then(() => setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }));
      },
      () =>
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
    );
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = studies.filter(
    (s) =>
      (!markedOnly || markedIds.has(s.id)) && (!needle || s.id.toLowerCase().includes(needle)),
  );

  return (
    // Two columns of cards on a desktop, so the shelf shows twice as many
    // studies as the single file did — and a ceiling on the width, because a
    // card stretched across a 1400px monitor is a line of text with a title
    // at one end and a date at the other.
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <ShelfToolbar
        title={t('Studies')}
        query={query}
        onQuery={setQuery}
        placeholder={t('Search studies…')}
        markedOnly={markedOnly}
        onMarkedOnly={setMarkedOnly}
        sort={view.sort}
        onSort={view.setSort}
        dir={view.dir}
        onDir={view.setDir}
        layout={view.layout}
        onLayout={view.setLayout}
        create={<CreateMenu />}
      />

      {error && <p className="text-bad text-xs">{error}</p>}

      {!listLoaded ? (
        // The shape of the list that is coming, rather than a blank page
        // that fills in — but only once the wait is long enough to notice.
        pending ? <SkeletonCards cards={5} /> : null
      ) : studies.length === 0 && folders.length === 0 ? (
        <EmptyState
          art={<CollectionArt />}
          title="No studies yet"
          body="A study is a set of annotated chapters — lines, comments, arrows — kept as plain PGN. Start an empty one, or import a PGN you already have."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => void newUntitledStudy(studies, create)}
            >
              <Plus className="mr-1 size-3.5" />
              {t('New study')}
            </Button>
          }
        />
      ) : /* The shelf HAS studies; this search or the bookmark toggle just
            matches none of them. Without this the list was simply absent
            under its own toolbar, which reads as the shelf having been
            emptied rather than as a filter being on. Each ends on the
            press that undoes it. */
      visible.length === 0 ? (
        markedOnly && !needle ? (
          <EmptyState
            art={<BookmarkArt />}
            title="No bookmarked studies yet"
            body="Bookmark a study from the shelf and it is kept here, one press from wherever you are."
            action={
              <Button variant="primary" size="sm" onClick={() => setMarkedOnly(false)}>
                <Library className="mr-1 size-3.5" />
                {t('Browse all studies')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            art={<NoMatchArt />}
            title="Nothing matches that search"
            body={
              markedOnly
                ? 'No bookmarked study matches it. Clearing the search shows every bookmark again.'
                : 'No study matches it. Clearing the search shows the whole shelf again.'
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                <X className="mr-1 size-3.5" />
                {t('Clear search')}
              </Button>
            }
          />
        )
      ) : (
        <GroupedStudies
          studies={visible.filter((st) => !hidden.has(st.id))}
          allFolders={needle ? [] : folders}
          markedIds={markedIds}
          onToggleMark={(id) => void toggleMark(id)}
          sort={view.sort}
          dir={view.dir}
          layout={view.layout}
          onRemove={dropStudy}
        />
      )}

      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
        />
      )}

      <FabSpacer />
    </div>
  );
}

/**
 * Make an "Untitled study" and open it. Returns an error to show, or null.
 *
 * Module-level because two places offer this: the Create menu, and the
 * empty shelf, whose whole job is to end on the press that fills it. A
 * second copy of the numbering would be a second place for it to go
 * wrong.
 */
async function newUntitledStudy(
  studies: StudyMeta[],
  create: (name: string) => Promise<string | null>,
): Promise<string | null> {
  const base = t('Untitled study');
  const taken = new Set(studies.map((st) => st.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base} ${n}`;
  const err = await create(id);
  if (err) return t(err);
  navigate('studies', encodeURIComponent(id));
  return null;
}

/**
 * [Create ▾] → New study / New folder, then an inline form. Studies can be
 * filed into an existing folder from a dropdown rather than typed paths.
 */
function CreateMenu() {
  const folders = useStudy((s) => s.folders);
  const studies = useStudy((s) => s.studies);
  const create = useStudy((s) => s.create);
  const createFolder = useStudy((s) => s.createFolder);

  const [mode, setMode] = useState<'study' | 'folder' | 'import' | 'lichess' | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [pgnText, setPgnText] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const filePick = useRef<HTMLInputElement>(null);

  // Import feedback: how many chapters the pasted/chosen PGN parses into.
  // Memoized — a Lichess export can be huge, and this component re-renders
  // on every keystroke of the NAME field.
  const chapterCount = useMemo(
    () => (mode === 'import' && pgnText.trim() ? pgnToChapters(pgnText).length : 0),
    [mode, pgnText],
  );

  /**
   * New study: made and opened, not asked about.
   *
   * A study is named by what ends up in it, which nobody knows at the
   * moment of creating one — so the shelf hands you the thing itself, with
   * a name you can change from its own header. "Untitled study 2" only
   * appears when the first is still called that.
   */
  const createStudy = async (): Promise<void> => {
    setFailure(await newUntitledStudy(studies, create));
  };

  // The name is passed in rather than read from state: the prompt sheet owns
  // its own draft and hands it over on submit, and reading `name` here would
  // see the value from before the last keystroke.
  const submit = async (raw: string): Promise<void> => {
    const trimmed = raw.trim();
    if (!trimmed || !mode) return;
    if (mode === 'folder') {
      const err = await createFolder(trimmed);
      setFailure(err && t(err));
      if (!err) {
        setMode(null);
        setName('');
      }
      return;
    }
    if (mode === 'import' && chapterCount === 0) {
      setFailure(t('that PGN parses into zero chapters'));
      return;
    }
    const id = folder ? `${folder}/${trimmed}` : trimmed;
    const err = await create(id, mode === 'import' ? pgnText : undefined);
    setFailure(err && t(err));
    if (!err) navigate('studies', encodeURIComponent(id));
  };

  /**
   * Take the PGN, and take its study's name with it.
   *
   * An export knows what it is called — every chapter is tagged with it
   * — so a paste fills the title in rather than asking for the name of
   * the thing that has just been pasted. Only over a title this filled
   * itself: once it has been typed in, it is an answer, and a later
   * paste must not overwrite it.
   */
  const autoNamed = useRef(false);
  const takePgn = (text: string): void => {
    setPgnText(text);
    const found = studyNameFromPgn(text);
    if (!found || (name.trim() && !autoNamed.current)) return;
    setName(found);
    autoNamed.current = true;
  };

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setPgnText(await file.text());
    // A chosen file keeps naming itself, and it wins over the PGN's own
    // idea: whoever saved it under that name meant it, whereas a Lichess
    // export arrives as `lichess_study_….pgn` only when nobody has. Still
    // marked as ours, so pasting a different study over it renames it.
    if (name.trim()) return;
    setName(file.name.replace(/\.pgn$/i, ''));
    autoNamed.current = true;
  };

  const pgnDrop = useFileDrop({
    accept: byExtension('.pgn'),
    onFiles: ([file]) => void pickFile(file),
  });

  // No outside-click handler here. There used to be one, closing over a
  // `menuHost` ref that stopped being attached to anything when the
  // dropdown became CreateControl — so `menuHost.current` was null, every
  // mousedown counted as outside, and pressing Create inside the prompt
  // unmounted the prompt before its own click could fire. Collections
  // could not be made at all. Both windows dismiss themselves: Sheet has
  // a scrim, ActionSheet has a scrim.

  return (
    <>
      <CreateControl
        actions={[
          { label: 'New study', icon: Library, onSelect: () => void createStudy() },
          { label: 'New collection', icon: FolderIcon, onSelect: () => setMode('folder') },
          { label: 'Import PGN', icon: FileUp, onSelect: () => setMode('import') },
          { label: 'From Lichess', icon: CloudDownload, onSelect: () => setMode('lichess') },
        ]}
      />

      {mode === 'lichess' && (
        // Same width as the PGN window: two ways in to the same shelf that
        // opened at two different sizes looked like two different features.
        <Modal title="Import from Lichess" onClose={() => setMode(null)} full className="sm:max-w-lg">
          <LichessImportForm folders={folders} onClose={() => setMode(null)} />
        </Modal>
      )}

      {/* A new study or collection asks for one name, so it gets the prompt
          sheet, not a window: a modal around a single field is a lot of
          chrome for a question a popover answers. Import needs a PGN, a file
          picker and a chapter count — that is a window. */}
      {mode === 'folder' && (
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

      {mode === 'import' && (
        // The width every import window is: full screen on a phone, and a
        // single readable column on a desktop rather than the 4xl sheet
        // `full` gives by default, which for three fields was mostly margin.
        <Modal
          title="Import PGN as study"
          onClose={() => setMode(null)}
          full
          className={cn(
            'sm:max-w-lg',
            pgnDrop.dragging && 'outline-primary outline-dashed outline-2 outline-offset-[-6px]',
          )}
        >
          {/*
            The whole window takes the drop, not just the button: a file
            dragged at a dialog is aimed at the dialog, and the browser's
            default is to navigate to it — which threw the app away and
            displayed the PGN.
            `contents` so this wrapper carries the handlers without adding
            a box to the window's layout; drag events bubble to it either
            way, and the highlight goes on the Modal itself.
          */}
          <div className="contents" {...pgnDrop.handlers}>
          {folders.length > 0 && (
            <Field label="Target collection">
              <Select
                value={folder}
                onChange={setFolder}
                ariaLabel={t('Target collection')}
                groups={[
                  {
                    options: [
                      { value: '', label: t('(no collection)') },
                      ...folders.map((f) => ({ value: f, label: f })),
                    ],
                  },
                ]}
              />
            </Field>
          )}
          <Field label="Study title">
            <Input
              autoFocus={autoFocusField()}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                autoNamed.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit(name);
                if (e.key === 'Escape') setMode(null);
              }}
              placeholder={t('Study name')}
            />
          </Field>
          {/* The chapter count belongs on the PGN's own label line, beside
              what it is counting — under the field it read as a message
              about the window. */}
          <Field
            label="PGN"
            hint={
              pgnText.trim() ? (
                <span className={cn('text-xs', chapterCount > 0 ? 'text-good' : 'text-bad')}>
                  {chapterCount > 0 ? t('{n} chapters', { n: chapterCount }) : t('not parseable')}
                </span>
              ) : null
            }
          >
            {/* The shared TextArea, not a hand-rolled one: it is where the
                autofill-off attributes live, and this is the field iOS was
                offering to complete with a contact. */}
            <TextArea
              value={pgnText}
              onChange={(e) => takePgn(e.target.value)}
              placeholder={t('Paste a PGN here — a Lichess study export imports with all its chapters, comments and arrows.')}
              spellCheck={false}
              className="h-28 w-full resize-none p-2 font-mono"
            />
            {/* Under the field it belongs to, left-aligned with it: it is
                the other way to fill that box, not an action of the window,
                and it sat in a row of its own arguing with Cancel/Import. */}
            <Button
              variant="secondary"
              size="sm"
              className="mt-1 self-start"
              onClick={() => filePick.current?.click()}
            >
              <FileUp className="mr-1 size-3.5" />
              {t('Choose file')}
            </Button>
          </Field>
          <input
            ref={filePick}
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          {failure && <p className="text-bad text-xs">{failure}</p>}
          {/* mt-1 on top of the window's own gap-3: the fields are a group,
              and what commits them should not look like another one. */}
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!name.trim() || chapterCount === 0}
              onClick={() => void submit(name)}
            >
              {t('Import')}
            </Button>
          </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** List a Lichess user's studies, tick the wanted ones, import server-side.
    The token (Settings) stays on the server; without one, public studies
    only. */
function LichessImportForm({ folders, onClose }: { folders: string[]; onClose: () => void }) {
  const refresh = useStudy((s) => s.refresh);
  const [user, setUser] = useState('');
  const [folder, setFolder] = useState('');
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Prefill the username from the profile once.
  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => (r.ok ? (r.json() as Promise<{ profile?: { lichess?: string } }>) : null))
      .then((s) => {
        if (s?.profile?.lichess) setUser((u) => u || s.profile!.lichess!);
      });
  }, []);

  const load = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    const res = await fetch(`/api/lichess/studies?user=${encodeURIComponent(user.trim())}`);
    const body = (await res.json().catch(() => null)) as
      | { studies?: { id: string; name: string }[]; note?: string | null; error?: string }
      | null;
    setBusy(false);
    if (!res.ok || !body?.studies) {
      setFailure(t(body?.error ?? 'could not reach Lichess'));
      return;
    }
    setList(body.studies);
    setNote(body.note ?? null);
    setChecked(new Set());
  };

  const importChecked = async (): Promise<void> => {
    if (!list) return;
    setBusy(true);
    setFailure(null);
    const studies = list.filter((s) => checked.has(s.id));
    const res = await fetch('/api/lichess/studies/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studies, ...(folder && { folder }) }),
    });
    const body = (await res.json().catch(() => null)) as
      | { imported?: string[]; failed?: { name: string; reason: string }[]; error?: string }
      | null;
    setBusy(false);
    if (!res.ok || !body?.imported) {
      setFailure(t(body?.error ?? 'import failed'));
      return;
    }
    await refresh();
    if (body.failed?.length) {
      setFailure(`imported ${body.imported.length}; failed: ${body.failed.map((f) => f.name).join(', ')}`);
      return;
    }
    onClose();
  };

  return (
    <>
      {/* No heading here: the window it opens in is already called this. */}
      <Field label="Lichess username">
        <div className="flex gap-2">
          <Input
            autoFocus={autoFocusField()}
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && user.trim()) void load();
              if (e.key === 'Escape') onClose();
            }}
            placeholder={t('Lichess username')}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="icon-sm"
            disabled={!user.trim() || busy}
            onClick={() => void load()}
            title={t('List this account’s studies')}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
          </Button>
        </div>
      </Field>
      {note && <p className="text-subtle text-xs">{note}</p>}
      {list && list.length === 0 && <p className="text-subtle text-xs">{t('No studies found.')}</p>}
      {list && list.length > 0 && (
        <>
          {/* The count is on the label line rather than in the list, so the
              window says how many are ticked without the list having to
              scroll to show it. */}
          <Field
            label="Studies to import"
            hint={
              <span className="text-subtle text-xs">
                {t('{n} of {total} selected', { n: checked.size, total: list.length })}
              </span>
            }
          >
            <div className="border-line max-h-60 overflow-y-auto rounded-md border">
              {list.map(({ id, name }) => (
                <label
                  key={id}
                  className="hover:bg-surface-2 flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(id)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(id);
                      else next.delete(id);
                      setChecked(next);
                    }}
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))}
            </div>
          </Field>
          {folders.length > 0 && (
            <Field label="Target collection">
              <Select
                value={folder}
                onChange={setFolder}
                ariaLabel={t('Target collection')}
                groups={[
                  {
                    options: [
                      { value: '', label: t('(no collection)') },
                      ...folders.map((f) => ({ value: f, label: f })),
                    ],
                  },
                ]}
              />
            </Field>
          )}
        </>
      )}
      {failure && <p className="text-bad text-xs">{failure}</p>}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
        {list && list.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            disabled={checked.size === 0 || busy}
            onClick={() => void importChecked()}
          >
            {busy ? t('Importing…') : `${t('Import')}${checked.size ? ` ${checked.size}` : ''}`}
          </Button>
        )}
      </div>
    </>
  );
}

/** Studies grouped by folder; folders are just subdirectories in the vault. */
function GroupedStudies({
  studies,
  allFolders,
  markedIds,
  onToggleMark,
  sort,
  dir,
  layout,
  onRemove,
}: {
  studies: StudyMeta[];
  allFolders: string[];
  markedIds: Set<string>;
  onToggleMark: (id: string) => void;
  sort: ShelfSort;
  dir: ShelfDir;
  layout: ShelfLayout;
  onRemove: (id: string) => void;
}) {
  const groups = new Map<string, StudyMeta[]>();
  for (const folder of allFolders) groups.set(folder, []);
  // One order, the chosen one. Bookmarks used to be pins and pins jumped
  // to the top; a mark is a filter now, so the list you are reading does
  // not rearrange itself the moment you mark something in it.
  for (const study of sortDocs(studies, sort, dir)) {
    const slash = study.id.lastIndexOf('/');
    const folder = slash === -1 ? '' : study.id.slice(0, slash);
    const list = groups.get(folder);
    if (list) list.push(study);
    else groups.set(folder, [study]);
  }
  const folders = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

  return (
    <div className="flex flex-col gap-4">
      {folders.map((folder) => (
        <section key={folder || '(root)'} className="flex flex-col gap-2">
          {folder && <FolderHeader folder={folder} empty={groups.get(folder)!.length === 0} />}
          {groups.get(folder)!.length === 0 ? (
            <p className="text-subtle px-1 text-xs">{t('Empty collection.')}</p>
          ) : (
            // Up to three abreast: two from sm, three from xl, one on a
            // phone. The cards are a fixed height and read left to right,
            // so more columns cost nothing and cut the scrolling; every
            // column is 1fr, so the row stretches with the container
            // rather than leaving a gutter down the right.
            <ul className={layout === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-1.5'}>
              {groups.get(folder)!.map((study) => (
                <StudyCard
                  key={study.id}
                  study={study}
                  allFolders={folders.filter(Boolean)}
                  marked={markedIds.has(study.id)}
                  onToggleMark={() => onToggleMark(study.id)}
                  layout={layout}
                  onRemove={() => onRemove(study.id)}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function FolderHeader({ folder, empty }: { folder: string; empty: boolean }) {
  const moveFolder = useStudy((s) => s.moveFolder);
  const removeFolder = useStudy((s) => s.removeFolder);
  return (
    <ShelfFolderHeader
      folder={folder}
      empty={empty}
      onRename={(next) => moveFolder(folder, next).then((e) => e && t(e))}
      onDelete={() => removeFolder(folder).then((e) => e && t(e))}
    />
  );
}

function StudyCard({
  study,
  allFolders,
  marked,
  onToggleMark,
  layout,
  onRemove,
}: {
  study: StudyMeta;
  allFolders: string[];
  marked: boolean;
  onToggleMark: () => void;
  layout: ShelfLayout;
  onRemove: () => void;
}) {
  const move = useStudy((s) => s.move);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const name = study.id.split('/').at(-1)!;
  const folder = study.id.includes('/') ? study.id.slice(0, study.id.lastIndexOf('/')) : '';

  const rename = async (value: string): Promise<void> => {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === name) return;
    setFailure(
      await move(study.id, folder ? `${folder}/${next}` : next).then((e) => e && t(e)),
    );
  };

  return (
    // The card's verbs live in one ⋯ rather than as three icons on every
    // row: each action gets a name and a whole row to be tapped in.
    <ShelfCard
      icon={Library}
      title={name}
      meta={
        <span title={formatWhen(study.updatedAt)}>
          {t('{n} chapters', { n: study.chapters })} ·{' '}
          {t('edited {when}', { when: formatAgo(study.updatedAt) })}
        </span>
      }
      // A study with no position worth showing still gets a board — an
      // empty one. The shelf reads as a shelf of boards either way, and
      // an empty diagram blends into the dark ground where the start
      // position was sixty-four competing squares of the same picture.
      fen={study.fen ?? '8/8/8/8/8/8/8/8'}
      // The first few chapter names, where a note would show its words —
      // each behind a small page mark, so the caption reads as a list of
      // chapters rather than as a sentence of the study's own.
      preview={study.chapterNames?.map((chapter, at) => (
        <span key={at} className="mr-2.5 inline-flex max-w-full items-center gap-1 align-top">
          <FileText className="size-3 shrink-0 opacity-60" strokeWidth={1.75} />
          <span className="truncate">{chapter}</span>
        </span>
      ))}
      marked={marked}
      onToggleMark={onToggleMark}
      layout={layout}
      error={failure}
      onOpen={() => navigate('studies', encodeURIComponent(study.id))}
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
      {/* Renaming and moving both ask one question, and both used to ask it
          inside the row — an input where the title was, a popover pinned to
          a button. They are sheets now, like every other one-question
          window. */}
      {renaming && (
        <PromptSheet
          label={t('Rename this study')}
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
            void move(study.id, target ? `${target}/${name}` : name).then(setFailure);
          }}
          onClose={() => setMoving(false)}
        />
      )}
    </ShelfCard>
  );
}
