import {
  ChevronDown,
  CloudDownload,
  FileUp,
  Folder as FolderIcon,
  FolderInput,
  Library,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { formatAgo, formatWhen } from '@/lib/dates';
import { pgnToChapters } from '@shared/pgn';
import { useStudy, type StudyMeta } from '@/store/study';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input, SearchInput, TextArea } from '@/ui/Input';
import { Globe, Loader2 } from 'lucide-react';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { Modal } from '@/ui/Modal';
import { PromptSheet } from '@/ui/PromptSheet';
import { SkeletonCards, useSlowLoad } from '@/ui/Skeleton';
import { MoveToPopover } from '@/ui/MoveToPopover';
import { StudyView } from './StudyView';
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

  const [query, setQuery] = useState('');
  const pending = useSlowLoad(!listLoaded);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? studies.filter((s) => s.id.toLowerCase().includes(needle))
    : studies;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t('Studies')}</h1>
        <div className="flex items-center gap-2">
          <SearchInput
            type="text"
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search studies…')}
            className="w-48"
          />
          <CreateMenu />
        </div>
      </header>

      {error && <p className="text-bad text-xs">{error}</p>}

      {!listLoaded ? (
        // The shape of the list that is coming, rather than a blank page
        // that fills in — but only once the wait is long enough to notice.
        pending ? <SkeletonCards cards={5} /> : null
      ) : studies.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Library className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-sm text-sm leading-relaxed">
            No studies yet. A study is a set of annotated chapters — lines, comments, arrows —
            saved as plain PGN in <code className="font-mono text-xs">vault/studies/</code>.
          </p>
        </div>
      ) : (
        <GroupedStudies studies={visible} allFolders={needle ? [] : folders} />
      )}
    </div>
  );
}

/**
 * [Create ▾] → New study / New folder, then an inline form. Studies can be
 * filed into an existing folder from a dropdown rather than typed paths.
 */
function CreateMenu() {
  const folders = useStudy((s) => s.folders);
  const create = useStudy((s) => s.create);
  const createFolder = useStudy((s) => s.createFolder);

  const [menuOpen, setMenuOpen] = useState(false);
  // Either popover (the menu or the name form) dismisses on outside click.
  const menuHost = useRef<HTMLDivElement>(null);
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

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setPgnText(await file.text());
    if (!name.trim()) setName(file.name.replace(/\.pgn$/i, ''));
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
    <div ref={menuHost} className="relative">
      <Button variant="primary" size="sm" onClick={() => setMenuOpen((v) => !v)}>
        <Plus className="mr-1 size-3.5" />
        {t('Create')}
        <ChevronDown className="ml-1 size-3" />
      </Button>

      {menuOpen && (
        <div
          className={cn(
            'border-line bg-surface absolute right-0 top-9 z-40 w-40 rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          {(
            [
              ['study', t('New study'), Library],
              ['folder', t('New collection'), FolderIcon],
              ['import', t('Import PGN'), FileUp],
              ['lichess', t('From Lichess'), CloudDownload],
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
              className={cn(
                'hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5',
                'text-left text-sm transition-colors duration-100',
              )}
            >
              <Icon className="text-subtle size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === 'lichess' && (
        <Modal title="Import from Lichess" onClose={() => setMode(null)}>
          <LichessImportForm folders={folders} onClose={() => setMode(null)} />
        </Modal>
      )}

      {/* A new study or collection asks for one name, so it gets the prompt
          sheet, not a window: a modal around a single field is a lot of
          chrome for a question a popover answers. Import needs a PGN, a file
          picker and a chapter count — that is a window. */}
      {(mode === 'study' || mode === 'folder') && (
        <PromptSheet
          label={mode === 'folder' ? t('New collection') : t('New study')}
          initial=""
          submitLabel={t('Create')}
          closeOnSubmit={false}
          error={failure}
          extra={
            mode === 'study' && folders.length > 0 ? (
              <Select
                value={folder}
                onChange={setFolder}
                ariaLabel={t('Collection')}
                groups={[
                  {
                    options: [
                      { value: '', label: t('(no collection)') },
                      ...folders.map((f) => ({ value: f, label: f })),
                    ],
                  },
                ]}
              />
            ) : undefined
          }
          onSubmit={(value) => void submit(value)}
          onClose={() => setMode(null)}
        />
      )}

      {mode === 'import' && (
        <Modal title="Import PGN as study" onClose={() => setMode(null)}>
          {folders.length > 0 && (
            <Select
              value={folder}
              onChange={setFolder}
              ariaLabel={t('Collection')}
              groups={[
                {
                  options: [
                    { value: '', label: t('(no collection)') },
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
              if (e.key === 'Enter') void submit(name);
              if (e.key === 'Escape') setMode(null);
            }}
            placeholder={t('Study name')}
          />
          {/* The shared TextArea, not a hand-rolled one: it is where the
              autofill-off attributes live, and this is the field iOS was
              offering to complete with a contact. */}
          <TextArea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder={t('Paste a PGN here — a Lichess study export imports with all its chapters, comments and arrows.')}
            spellCheck={false}
            className="h-28 w-full resize-none p-2 font-mono"
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={() => filePick.current?.click()}>
              <FileUp className="mr-1 size-3.5" />
              {t('Choose file')}
            </Button>
            {pgnText.trim() && (
              <span className={cn('text-xs', chapterCount > 0 ? 'text-good' : 'text-bad')}>
                {chapterCount > 0 ? t('{n} chapters', { n: chapterCount }) : t('not parseable')}
              </span>
            )}
          </div>
          <input
            ref={filePick}
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          {failure && <p className="text-bad text-xs">{failure}</p>}
          <div className="flex justify-end gap-2">
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
        </Modal>
      )}
    </div>
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
      <div className="flex gap-2">
        <Input
          autoFocus
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
      {note && <p className="text-subtle text-xs">{note}</p>}
      {list && list.length === 0 && <p className="text-subtle text-xs">{t('No studies found.')}</p>}
      {list && list.length > 0 && (
        <>
          <div className="border-line max-h-52 overflow-y-auto rounded-md border">
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
          {folders.length > 0 && (
            <Select
              value={folder}
              onChange={setFolder}
              ariaLabel={t('Collection')}
              groups={[
                {
                  options: [
                    { value: '', label: t('(no collection)') },
                    ...folders.map((f) => ({ value: f, label: f })),
                  ],
                },
              ]}
            />
          )}
        </>
      )}
      {failure && <p className="text-bad text-xs">{failure}</p>}
      <div className="flex justify-end gap-2">
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
            {busy ? 'Importing…' : `Import ${checked.size || ''}`}
          </Button>
        )}
      </div>
    </>
  );
}

/** Studies grouped by folder; folders are just subdirectories in the vault. */
function GroupedStudies({ studies, allFolders }: { studies: StudyMeta[]; allFolders: string[] }) {
  const groups = new Map<string, StudyMeta[]>();
  for (const folder of allFolders) groups.set(folder, []);
  for (const study of studies) {
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
            <ul className="flex flex-col gap-2">
              {groups.get(folder)!.map((study) => (
                <StudyCard key={study.id} study={study} allFolders={folders.filter(Boolean)} />
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
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(folder);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="group/folder flex h-6 items-center gap-1.5">
      <FolderIcon className="text-subtle size-3.5 shrink-0" />
      {renaming ? (
        <Input
          autoFocus
          inputSize="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={async () => {
            setRenaming(false);
            if (draft.trim() && draft.trim() !== folder) {
              setFailure(await moveFolder(folder, draft.trim()).then((e) => e && t(e)));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="w-48"
        />
      ) : (
        <button
          type="button"
          onDoubleClick={() => {
            setDraft(folder);
            setRenaming(true);
          }}
          title={t('Double-click to rename')}
          className="text-subtle text-xs font-semibold uppercase tracking-[0.08em]"
        >
          {folder}
        </button>
      )}
      {!renaming && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 pointer-coarse:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Rename this collection')}
            onClick={() => {
              setDraft(folder);
              setRenaming(true);
            }}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t(empty ? 'Delete this empty collection' : 'Only empty collections can be deleted')}
            onClick={async () => {
              const err = await removeFolder(folder);
              // Translated HERE: the server answers in English, and this is
              // the boundary where a server string becomes something a
              // person reads.
              setFailure(err && t(err));
              // A refusal is worth reading once, not forever: it sits under
              // a row that is still there, so left alone it reads as the
              // row's permanent state rather than as an answer to a click.
              if (err) setTimeout(() => setFailure(null), 5000);
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      )}
      {failure && <span className="text-bad text-xs">{failure}</span>}
    </div>
  );
}

function StudyCard({ study, allFolders }: { study: StudyMeta; allFolders: string[] }) {
  const remove = useStudy((s) => s.remove);
  const move = useStudy((s) => s.move);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const moveTrigger = useRef<HTMLButtonElement>(null);

  const name = study.id.split('/').at(-1)!;
  const folder = study.id.includes('/') ? study.id.slice(0, study.id.lastIndexOf('/')) : '';

  const rename = async (): Promise<void> => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === name) return;
    setFailure(
      await move(study.id, folder ? `${folder}/${next}` : next).then((e) => e && t(e)),
    );
  };

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!renaming) navigate('studies', encodeURIComponent(study.id));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !renaming) navigate('studies', encodeURIComponent(study.id));
        }}
        className={cn(
          'bg-surface border-line hover:border-line-strong group relative flex cursor-pointer',
          'items-center gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-panel)] transition-colors',
        )}
      >
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              inputSize="sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full max-w-sm text-sm"
            />
          ) : (
            <p className="text-fg truncate text-sm font-semibold">{name}</p>
          )}
          <p className="text-subtle text-xs" title={formatWhen(study.updatedAt)}>
            {t('{n} chapters', { n: study.chapters })} · {t('edited {when}', { when: formatAgo(study.updatedAt) })}
          </p>
          {failure && <p className="text-bad text-xs">{failure}</p>}
        </div>

        {(
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Rename this study')}
              onClick={(e) => {
                e.stopPropagation();
                setDraft(name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              ref={moveTrigger}
              variant="ghost"
              size="icon-sm"
              title={t('Move to a collection')}
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
              triggerTitle="Delete this study"
              question={t('Delete “{name}”?', { name })}
              confirmLabel="Delete"
              onConfirm={() => void remove(study.id)}
            />
          </div>
        )}

        {moving && (
          <MoveToPopover
            currentFolder={folder}
            folders={allFolders}
            triggerRef={moveTrigger}
            onPick={(target) => {
              setMoving(false);
              void move(study.id, target ? `${target}/${name}` : name).then(setFailure);
            }}
            onClose={() => setMoving(false)}
          />
        )}
      </div>
    </li>
  );
}
