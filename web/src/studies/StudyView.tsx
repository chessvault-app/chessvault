import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { MoveActions } from '@/analysis/AnalysisView';
import { MoveTreePane } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useStudy } from '@/store/study';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { AnnotationPane } from './AnnotationPane';

type StudyPane = 'moves' | 'chapters' | 'explorer';

export function StudyView({ id, kind = 'study' }: { id: string; kind?: 'study' | 'game' }) {
  const openId = useStudy((s) => s.openId);
  const open = useStudy((s) => s.open);
  const close = useStudy((s) => s.close);
  const saveState = useStudy((s) => s.saveState);
  const error = useStudy((s) => s.error);
  const [failed, setFailed] = useState(false);
  // Small screens show one pane at a time under the board.
  const [pane, setPane] = useState<StudyPane>('moves');

  const base = kind === 'game' ? ('games/docs' as const) : ('studies' as const);
  const backSection = kind === 'game' ? ('games' as const) : ('studies' as const);

  useEffect(() => {
    let cancelled = false;
    void open(id, base).then((ok) => {
      if (!cancelled) setFailed(!ok);
    });
    return () => {
      cancelled = true;
      void close();
    };
  }, [id, base, open, close]);

  // Reviewing a game starts quiet: engine and explorer off, so the position
  // is judged by eye first. The explorer preference is restored on leave; the
  // engine always starts off anyway.
  useEffect(() => {
    if (kind !== 'game') return;
    const engine = useEngine.getState();
    if (engine.enabled) engine.setEnabled(false);
    const explorerWasOn = useExplorer.getState().enabled;
    if (explorerWasOn) useExplorer.setState({ enabled: false });
    return () => {
      if (explorerWasOn) useExplorer.setState({ enabled: true });
    };
  }, [kind, id]);

  // A study with unsaved edits must survive an accidental tab close.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent): void => {
      if (useStudy.getState().saveState !== 'saved') e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  if (failed) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted text-sm">{error ?? `Could not open “${id}”.`}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate(backSection)}>
            <ArrowLeft className="mr-1 size-3.5" />
            {kind === 'game' ? 'All games' : 'All studies'}
          </Button>
        </div>
      </div>
    );
  }

  if (openId !== id) {
    return (
      <div className="text-subtle grid h-full place-items-center text-sm">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  // Rendered twice — at the page top on stacked layouts, in the side column
  // on wide ones — because CSS cannot reparent. Only one is ever visible.
  const titleRow = (className: string) => (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        title={kind === 'game' ? 'All games (saves first)' : 'All studies (saves first)'}
        onClick={() => navigate(backSection)}
      >
        <ArrowLeft className="size-3.5" />
      </Button>
      <TitleEditor id={id} backSection={backSection} />
      <SaveIndicator state={saveState} error={error} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      {titleRow('wide:hidden')}
      <AnalysisBoard />

      {/* min-h-0 only where the column manages its own space (side-by-side
          layouts): stacked keeps the natural content minimum, so a squat
          viewport scrolls the page instead of crushing panels into their
          own overflow-hidden. */}
      <div className="flex flex-1 flex-col gap-3 stacked:gap-2 wide:min-h-0 wide:w-[min(27rem,38%)] wide:flex-none wide:overflow-y-auto">
        {titleRow('stacked:hidden')}

        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves' },
            ...(kind === 'study' ? [{ id: 'chapters' as const, label: 'Chapters' }] : []),
            { id: 'explorer', label: 'Explorer' },
          ]}
        />
        {kind === 'study' && (
          <div className={cn('contents', pane !== 'chapters' && 'max-lg:hidden')}>
            <ChaptersPanel />
          </div>
        )}
        {/* min-h-min, NOT min-h-auto: Panel's overflow-hidden disables the
            automatic content-based minimum, but the explicit min-content
            keyword still applies — the panel keeps its floors (header +
            tree min-h + annotation) and overflows the column into scroll
            instead of clipping. */}
        <Panel
          flush
          className={cn('min-h-min flex-1', pane !== 'moves' && 'max-lg:hidden')}
        >
          <EngineBlock />
          <PanelHeader title="Moves" actions={<MoveActions allowReset={false} />} />
          <MoveTreePane />
          <AnnotationPane
            rootPlaceholder={kind === 'game' ? 'Notes on this game…' : 'Chapter introduction…'}
          />
        </Panel>
        <ExplorerPane
          resizeKey="study-explorer"
          className={cn(
            'max-lg:min-h-[8rem] max-lg:flex-1 lg:min-h-min lg:max-h-[35%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
      </div>
    </div>
  );
}

/**
 * The document title, renameable in place (pencil, or double-click). Renames
 * keep the collection: only the last path segment is edited.
 */
function TitleEditor({
  id,
  backSection,
}: {
  id: string;
  backSection: 'studies' | 'games';
}) {
  const renameOpen = useStudy((s) => s.renameOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const name = id.split('/').at(-1)!;
  const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';

  const submit = async (): Promise<void> => {
    setEditing(false);
    if (!draft.trim() || draft.trim() === name) return;
    const result = await renameOpen(draft);
    setFailure(result.error ?? null);
    if (result.id && result.id !== id) navigate(backSection, encodeURIComponent(result.id));
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={cn(
          'bg-surface-inset border-line text-fg h-7 min-w-0 flex-1 rounded-md border px-2',
          'text-sm font-semibold outline-none focus:border-line-strong',
        )}
      />
    );
  }

  return (
    <>
      <h1
        onDoubleClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title={failure ?? id}
        className={cn('min-w-0 flex-1 truncate text-sm font-semibold', failure ? 'text-bad' : 'text-fg')}
      >
        {folder && <span className="text-subtle">{folder} / </span>}
        {name}
        {failure ? ` — ${failure}` : ''}
      </h1>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Rename"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" />
      </Button>
    </>
  );
}

function SaveIndicator({ state, error }: { state: string; error: string | null }) {
  const save = useStudy((s) => s.save);
  if (state === 'saved') {
    return (
      <span className="text-subtle flex items-center gap-1 text-xs">
        <Check className="size-3.5" /> Saved
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="text-subtle flex items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={() => void save()}
        title={error ?? 'Save failed — click to retry'}
        className="text-bad flex items-center gap-1 text-xs"
      >
        <CircleAlert className="size-3.5" /> Retry save
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void save()}
      title="Unsaved changes — click to save now"
      className="text-warn flex items-center gap-1 text-xs"
    >
      <span className="bg-warn size-1.5 rounded-full" /> Unsaved
    </button>
  );
}

function ChaptersPanel() {
  const chapters = useStudy((s) => s.chapters);
  const addChapter = useStudy((s) => s.addChapter);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const toggleFold = (group: string): void =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  // Sub-chapters: a chapter named "Group/Name" files under a group heading.
  // The grouping lives entirely in the ChapterName header — the PGN file
  // stays a flat list of games, readable by any tool.
  const groupOf = (name: string): string =>
    name.includes('/') ? name.slice(0, name.indexOf('/')) : '';
  const rows: ({ kind: 'group'; group: string; count: number } | { kind: 'chapter'; index: number })[] = [];
  const seenGroups = new Set<string>();
  chapters.forEach((chapter, index) => {
    const group = groupOf(chapter.name);
    if (group && !seenGroups.has(group)) {
      seenGroups.add(group);
      rows.push({
        kind: 'group',
        group,
        count: chapters.filter((c) => groupOf(c.name) === group).length,
      });
    }
    // Folded groups list only their heading.
    if (group && folded.has(group)) return;
    rows.push({ kind: 'chapter', index });
  });

  return (
    <Panel flush className="max-h-48 shrink-0" resizeKey="study-chapters">
      <PanelHeader
        title={`Chapters · ${chapters.length}`}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Add a sub-chapter — chapters named “Group/Name” nest under a group heading"
              onClick={() => {
                // Create it nested and drop straight into the rename input
                // with the full Group/Name path, so the naming scheme that
                // drives nesting explains itself.
                const group = 'New group';
                const n = chapters.filter((c) => c.name.startsWith(`${group}/`)).length + 1;
                addChapter(group);
                setDraft(`${group}/Chapter ${n}`);
                setRenaming(chapters.length);
              }}
            >
              <FolderPlus className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Add a chapter" onClick={() => addChapter()}>
              <Plus className="size-3.5" />
            </Button>
          </>
        }
      />
      <ul className="min-h-0 overflow-y-auto p-1">
        {rows.map((row) =>
          row.kind === 'group' ? (
            <li key={`group-${row.group}`} className="group/subch flex items-center gap-1 px-1 pb-0.5 pt-1.5">
              <button
                type="button"
                onClick={() => toggleFold(row.group)}
                title={folded.has(row.group) ? 'Unfold this group' : 'Fold this group'}
                className="text-subtle hover:text-fg flex h-5 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left transition-colors duration-100"
              >
                <ChevronDown
                  className={cn(
                    'size-3 shrink-0 transition-transform duration-100',
                    folded.has(row.group) && '-rotate-90',
                  )}
                />
                <span className="min-w-0 truncate text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
                  {row.group}
                </span>
                {folded.has(row.group) && (
                  <span className="shrink-0 font-mono text-[0.625rem]">{row.count}</span>
                )}
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5 opacity-0 transition-opacity group-hover/subch:opacity-100 pointer-coarse:opacity-100"
                title={`Add a chapter in “${row.group}”`}
                onClick={() => addChapter(row.group)}
              >
                <Plus className="size-3" />
              </Button>
            </li>
          ) : (
            <ChapterRow
              key={chapters[row.index]!.id}
              index={row.index}
              renaming={renaming}
              setRenaming={setRenaming}
              draft={draft}
              setDraft={setDraft}
            />
          ),
        )}
      </ul>
    </Panel>
  );
}

// A top-level component, NOT nested inside ChaptersPanel: a nested component
// gets a fresh identity on every parent render, so React would remount the
// row — and the rename input inside it — on every keystroke.
function ChapterRow({
  index,
  renaming,
  setRenaming,
  draft,
  setDraft,
}: {
  index: number;
  renaming: number | null;
  setRenaming: (v: number | null) => void;
  draft: string;
  setDraft: (v: string) => void;
}) {
  const chapters = useStudy((s) => s.chapters);
  const chapterIndex = useStudy((s) => s.chapterIndex);
  const selectChapter = useStudy((s) => s.selectChapter);
  const renameChapter = useStudy((s) => s.renameChapter);
  const deleteChapter = useStudy((s) => s.deleteChapter);

  const chapter = chapters[index];
  if (!chapter) return null;
  const nested = chapter.name.includes('/');
  // Nested chapters show only their own name; the group heading carries
  // the prefix. Renaming always edits the full "Group/Name" path.
  const label = nested ? chapter.name.slice(chapter.name.indexOf('/') + 1) : chapter.name;
  return (
    <li className={cn('group flex items-center', nested && 'pl-3')}>
      {renaming === index ? (
        <input
          autoFocus
          onFocus={(e) => e.target.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            renameChapter(index, draft);
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
          className={cn(
            'bg-surface-inset border-line text-fg m-0.5 h-7 min-w-0 flex-1 rounded-md',
            'border px-2 text-xs outline-none focus:border-line-strong',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => selectChapter(index)}
          onDoubleClick={() => {
            setDraft(chapter.name);
            setRenaming(index);
          }}
          title="Double-click to rename (use “Group/Name” to nest)"
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs',
            'transition-colors duration-100',
            index === chapterIndex
              ? 'bg-primary-soft text-primary font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          <span className="text-subtle w-4 shrink-0 text-right font-mono text-[0.625rem]">
            {index + 1}
          </span>
          <span className="truncate">{label}</span>
        </button>
      )}
      {renaming !== index && (
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
          {/* Touch has no double-click, so rename gets a real button. */}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Rename this chapter"
            onClick={() => {
              setDraft(chapter.name);
              setRenaming(index);
            }}
          >
            <Pencil className="size-3" />
          </Button>
          {chapters.length > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete this chapter"
              onClick={() => deleteChapter(index)}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
