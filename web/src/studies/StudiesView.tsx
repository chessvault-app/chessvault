import { Folder as FolderIcon, Library, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useStudy, type StudyMeta } from '@/store/study';
import { Button } from '@/ui/Button';
import { StudyView } from './StudyView';

/** Router shell for the Studies section: list, or one open study. */
export function StudiesView({ params }: { params: string[] }) {
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} /> : <StudyList />;
}

function StudyList() {
  const studies = useStudy((s) => s.studies);
  const listLoaded = useStudy((s) => s.listLoaded);
  const error = useStudy((s) => s.error);
  const refresh = useStudy((s) => s.refresh);
  const create = useStudy((s) => s.create);

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const failure = await create(trimmed);
    setCreateError(failure);
    if (!failure) {
      setName('');
      navigate('studies', encodeURIComponent(trimmed));
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Studies</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder="New study, or Folder/Name"
            className={cn(
              'bg-surface border-line text-fg h-8 w-48 rounded-md border px-2.5 text-sm',
              'outline-none focus:border-line-strong',
            )}
          />
          <Button variant="primary" size="sm" disabled={!name.trim()} onClick={() => void submit()}>
            <Plus className="mr-1 size-3.5" />
            Create
          </Button>
        </div>
      </header>

      {(error ?? createError) && <p className="text-bad text-xs">{error ?? createError}</p>}

      {listLoaded && studies.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Library className="text-subtle size-6" strokeWidth={1.5} />
          <p className="text-muted max-w-sm text-sm leading-relaxed">
            No studies yet. A study is a set of annotated chapters — lines, comments, arrows —
            saved as plain PGN in <code className="font-mono text-xs">vault/studies/</code>.
            Name one “Folder/Study” to file it in a collection.
          </p>
        </div>
      ) : (
        <GroupedStudies studies={studies} />
      )}
    </div>
  );
}

/** Studies grouped by folder; folders are just subdirectories in the vault. */
function GroupedStudies({ studies }: { studies: StudyMeta[] }) {
  const groups = new Map<string, StudyMeta[]>();
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
          {folder && (
            <h2 className="text-subtle flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em]">
              <FolderIcon className="size-3.5" />
              {folder}
            </h2>
          )}
          <ul className="flex flex-col gap-2">
            {groups.get(folder)!.map((study) => (
              <StudyCard key={study.id} study={study} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StudyCard({ study }: { study: StudyMeta }) {
  const remove = useStudy((s) => s.remove);
  const [confirming, setConfirming] = useState(false);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate('studies', encodeURIComponent(study.id))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') navigate('studies', encodeURIComponent(study.id));
        }}
        className={cn(
          'bg-surface border-line hover:border-line-strong group flex cursor-pointer items-center',
          'gap-3 rounded-xl border px-4 py-3 shadow-[var(--shadow-panel)] transition-colors',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-fg truncate text-sm font-semibold">
            {study.id.split('/').at(-1)}
          </p>
          <p className="text-subtle text-xs">
            {study.chapters} chapter{study.chapters === 1 ? '' : 's'} ·{' '}
            {new Date(study.updatedAt).toLocaleString()}
          </p>
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
            Delete “{study.id.split('/').at(-1)}”?
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100"
            title="Delete this study"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
              setTimeout(() => setConfirming(false), 3000);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
