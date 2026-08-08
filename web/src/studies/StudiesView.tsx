import {
  ChevronDown,
  Folder as FolderIcon,
  FolderInput,
  Library,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { formatWhen } from '@/lib/dates';
import { useStudy, type StudyMeta } from '@/store/study';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Input } from '@/ui/Input';
import { StudyView } from './StudyView';

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
        <h1 className="text-lg font-semibold tracking-tight">Studies</h1>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search studies…"
            className="w-48"
          />
          <CreateMenu />
        </div>
      </header>

      {error && <p className="text-bad text-xs">{error}</p>}

      {listLoaded && studies.length === 0 && folders.length === 0 ? (
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
  const [mode, setMode] = useState<'study' | 'folder' | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !mode) return;
    if (mode === 'folder') {
      const err = await createFolder(trimmed);
      setFailure(err);
      if (!err) {
        setMode(null);
        setName('');
      }
      return;
    }
    const id = folder ? `${folder}/${trimmed}` : trimmed;
    const err = await create(id);
    setFailure(err);
    if (!err) navigate('studies', encodeURIComponent(id));
  };

  return (
    <div className="relative">
      <Button variant="primary" size="sm" onClick={() => setMenuOpen((v) => !v)}>
        <Plus className="mr-1 size-3.5" />
        Create
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
              ['study', 'New study', Library],
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

      {mode && (
        <div
          className={cn(
            'border-line bg-surface absolute right-0 top-9 z-40 flex w-72 flex-col gap-2 rounded-lg',
            'border p-3 shadow-[var(--shadow-pop)]',
          )}
        >
          <p className="text-subtle text-xs font-semibold uppercase tracking-[0.08em]">
            {mode === 'study' ? 'New study' : 'New collection'}
          </p>
          {mode === 'study' && folders.length > 0 && (
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
            placeholder={mode === 'study' ? 'Study name' : 'Collection name'}
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
            <p className="text-subtle px-1 text-xs">Empty collection.</p>
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
              setFailure(await moveFolder(folder, draft.trim()));
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
          title="Double-click to rename"
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
            title="Rename this collection"
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
            title={empty ? 'Delete this empty collection' : 'Only empty collections can be deleted'}
            onClick={async () => setFailure(await removeFolder(folder))}
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
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const name = study.id.split('/').at(-1)!;
  const folder = study.id.includes('/') ? study.id.slice(0, study.id.lastIndexOf('/')) : '';

  const rename = async (): Promise<void> => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === name) return;
    setFailure(await move(study.id, folder ? `${folder}/${next}` : next));
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
          <p className="text-subtle text-xs">
            {study.chapters} chapter{study.chapters === 1 ? '' : 's'} ·{' '}
            {formatWhen(study.updatedAt)}
          </p>
          {failure && <p className="text-bad text-xs">{failure}</p>}
        </div>

        {confirming ? (
          <Button
            variant="danger"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              void remove(study.id);
            }}
          >
            Delete “{name}”?
          </Button>
        ) : (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Rename this study"
              onClick={(e) => {
                e.stopPropagation();
                setDraft(name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
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
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete this study"
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
                setTimeout(() => setConfirming(false), 3000);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}

        {moving && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'border-line bg-surface absolute right-3 top-full z-40 mt-1 w-56 rounded-lg border p-1',
              'shadow-[var(--shadow-pop)]',
            )}
          >
            <p className="text-subtle px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
              Move to
            </p>
            {['', ...allFolders.filter((f) => f !== folder)].map((target) =>
              target === folder ? null : (
                <button
                  key={target || '(root)'}
                  type="button"
                  onClick={async () => {
                    setMoving(false);
                    setFailure(await move(study.id, target ? `${target}/${name}` : name));
                  }}
                  className={cn(
                    'hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5',
                    'text-left text-xs transition-colors duration-100',
                  )}
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
