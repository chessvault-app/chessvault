import {
  ChevronLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Compass,
  Cpu,
  Files,
  ListOrdered,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { MoveActions } from '@/analysis/AnalysisView';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { MoveTreePane } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { useStudy } from '@/store/study';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Panel, PanelHeader } from '@/ui/Panel';
import { PaneTabs } from '@/ui/PaneTabs';
import { AnnotationPane } from './AnnotationPane';

type StudyPane = 'moves' | 'engine' | 'chapters' | 'explorer';

export function StudyView({ id, kind = 'study' }: { id: string; kind?: 'study' | 'game' }) {
  const openId = useStudy((s) => s.openId);
  const open = useStudy((s) => s.open);
  const close = useStudy((s) => s.close);
  const saveState = useStudy((s) => s.saveState);
  const error = useStudy((s) => s.error);
  const [failed, setFailed] = useState(false);
  // Small screens show one pane at a time under the board.
  const [pane, setPane] = useState<StudyPane>('moves');
  // Reading vs annotating: reading hides the NAG toolbar and comment boxes.
  const [editing, setEditing] = useState(false);

  const base = kind === 'game' ? ('games/docs' as const) : ('studies' as const);
  const backSection = kind === 'game' ? ('games' as const) : ('studies' as const);

  useEffect(() => {
    let cancelled = false;
    useReview.getState().clear();
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
            <ChevronLeft className="mr-1 size-3.5" />
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
    <div className={cn('flex shrink-0 items-center gap-2 wide:h-9', className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        title={kind === 'game' ? 'All games (saves first)' : 'All studies (saves first)'}
        onClick={() => navigate(backSection)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <TitleEditor id={id} backSection={backSection} />
      <SaveIndicator state={saveState} error={error} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-hidden wide:flex-row wide:gap-4 wide:p-4">
      {titleRow('wide:hidden')}
      <AnalysisBoard />

      {/* Desktop scrolls the column; phones show one pane that fills the
          height under the board and scrolls internally (see AnalysisView). */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden max-lg:overflow-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        {titleRow('stacked:hidden')}

        <PaneTabs
          className="lg:hidden"
          value={pane}
          onChange={setPane}
          tabs={[
            { id: 'moves', label: 'Moves', icon: ListOrdered },
            { id: 'engine', label: 'Engine', icon: Cpu },
            ...(kind === 'study' ? [{ id: 'chapters' as const, label: 'Chapters', icon: Files }] : []),
            { id: 'explorer', label: 'Explorer', icon: Compass },
          ]}
        />
        {kind === 'study' && (
          <div className={cn('contents', pane !== 'chapters' && 'max-lg:hidden')}>
            <ChaptersPanel />
          </div>
        )}
        {/* Desktop keeps a floor and scrolls the column; phones drop it so
            the panel fills the slot and the move table scrolls inside. */}
        <Panel
          flush
          className={cn('flex-1 max-lg:min-h-0 lg:min-h-[22rem]', pane !== 'moves' && 'max-lg:hidden')}
        >
          {/* Docked on desktop; its own tab on phones (below). */}
          <EngineBlock className="max-lg:hidden" />
          <PanelHeader
            title="Moves"
            actions={
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  active={editing}
                  title={editing ? 'Done editing' : 'Annotate (NAGs & comments)'}
                  onClick={() => setEditing((v) => !v)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <ReviewButton />
                {editing && <LoadPositionButton />}
                {editing && <MoveActions allowReset={false} />}
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
          <BoardControls className="border-line border-t max-md:hidden" keyboard={false} />
          <AnnotationPane
            editing={editing}
            rootPlaceholder={kind === 'game' ? 'Notes on this game…' : 'Chapter introduction…'}
          />
        </Panel>
        <Panel flush className={cn('flex-1 min-h-0 lg:hidden', pane !== 'engine' && 'max-lg:hidden')}>
          <EngineBlock />
        </Panel>
        <ExplorerPane
          resizeKey="study-explorer"
          className={cn(
            'max-lg:min-h-0 max-lg:flex-1 lg:min-h-min lg:max-h-[35%]',
            pane !== 'explorer' && 'max-lg:hidden',
          )}
        />
      </div>

      {/* Phones: move navigation in the bottom bar (see AnalysisView). */}
      <MobileActionBar>
        <BoardControls keyboard={false} className="py-1.5" />
      </MobileActionBar>
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
      <Input
        autoFocus
        inputSize="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="flex-1 text-sm font-semibold"
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

  const toggleFold = (parent: string): void =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });

  // Sub-chapters nest under a NORMAL chapter (lanph3re's call — no separate
  // group headings). Storage stays a flat PGN: a sub-chapter's ChapterName
  // is "Parent/Name", written by the UI, never typed by the user. A sub
  // whose parent is gone renders top-level under its full name.
  const parentOf = (name: string): string =>
    name.includes('/') ? name.slice(0, name.indexOf('/')) : '';
  const topNames = new Set(chapters.filter((c) => !c.name.includes('/')).map((c) => c.name));
  const subsOf = new Map<string, number[]>();
  const tops: number[] = [];
  chapters.forEach((chapter, index) => {
    const parent = parentOf(chapter.name);
    if (parent && topNames.has(parent)) {
      subsOf.set(parent, [...(subsOf.get(parent) ?? []), index]);
    } else {
      tops.push(index);
    }
  });
  const rows: { index: number; sub: boolean; childCount: number; isFolded: boolean }[] = [];
  for (const index of tops) {
    const name = chapters[index]!.name;
    const children = subsOf.get(name) ?? [];
    const isFolded = folded.has(name);
    rows.push({ index, sub: false, childCount: children.length, isFolded });
    if (!isFolded) for (const child of children) rows.push({ index: child, sub: true, childCount: 0, isFolded: false });
  }

  /** Create a sub-chapter under `parentIndex` and open its rename input. */
  const addSub = (parentName: string): void => {
    const n = chapters.filter((c) => c.name.startsWith(`${parentName}/`)).length + 1;
    addChapter(parentName);
    setFolded((prev) => {
      const next = new Set(prev);
      next.delete(parentName);
      return next;
    });
    setDraft(`Chapter ${n}`);
    setRenaming(chapters.length);
  };

  return (
    // Desktop: a compact, resizable 12rem list. Phones: the Chapters tab
    // owns the column, so fill it and scroll rather than leaving dead space.
    <Panel
      flush
      className="lg:max-h-48 lg:shrink-0 max-lg:flex-1 max-lg:min-h-0"
      resizeKey="study-chapters"
    >
      <PanelHeader
        title={`Chapters · ${chapters.length}`}
        actions={
          <Button variant="ghost" size="icon-sm" title="Add a chapter" onClick={() => addChapter()}>
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <ul className="min-h-0 overflow-y-auto p-1">
        {rows.map((row) => (
          <ChapterRow
            key={chapters[row.index]!.id}
            index={row.index}
            sub={row.sub}
            childCount={row.childCount}
            isFolded={row.isFolded}
            onToggleFold={() => toggleFold(chapters[row.index]!.name)}
            onAddSub={() => addSub(chapters[row.index]!.name)}
            renaming={renaming}
            setRenaming={setRenaming}
            draft={draft}
            setDraft={setDraft}
          />
        ))}
      </ul>
    </Panel>
  );
}

// A top-level component, NOT nested inside ChaptersPanel: a nested component
// gets a fresh identity on every parent render, so React would remount the
// row — and the rename input inside it — on every keystroke.
function ChapterRow({
  index,
  sub,
  childCount,
  isFolded,
  onToggleFold,
  onAddSub,
  renaming,
  setRenaming,
  draft,
  setDraft,
}: {
  index: number;
  sub: boolean;
  childCount: number;
  isFolded: boolean;
  onToggleFold: () => void;
  onAddSub: () => void;
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
  const slash = chapter.name.indexOf('/');
  // Rows show and edit only their OWN name; the parent prefix is plumbing
  // the UI maintains (and slashes are stripped so it stays that way).
  const ownName = sub && slash >= 0 ? chapter.name.slice(slash + 1) : chapter.name;
  const prefix = sub && slash >= 0 ? chapter.name.slice(0, slash + 1) : '';

  const startRename = (): void => {
    setDraft(ownName);
    setRenaming(index);
  };
  const commitRename = (): void => {
    const segment = draft.replace(/\//g, '-').trim();
    if (segment) renameChapter(index, `${prefix}${segment}`);
    setRenaming(null);
  };

  return (
    <li className={cn('group flex items-center', sub && 'pl-5')}>
      {renaming === index ? (
        <Input
          autoFocus
          inputSize="sm"
          onFocus={(e) => e.target.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
          className="m-0.5 flex-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => selectChapter(index)}
          onDoubleClick={startRename}
          title="Double-click to rename"
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs',
            'transition-colors duration-100',
            index === chapterIndex
              ? 'bg-primary-soft text-primary font-semibold'
              : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {childCount > 0 ? (
            <span
              role="button"
              tabIndex={-1}
              title={isFolded ? `Unfold ${childCount} sub-chapters` : 'Fold sub-chapters'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFold();
              }}
              // Touch gets a ~32px hit area; the negative margin cancels
              // the padding so the visual layout doesn't move.
              className="hover:text-fg -m-1 shrink-0 p-1 pointer-coarse:-m-2.5 pointer-coarse:p-2.5"
            >
              <ChevronDown
                className={cn('size-3 transition-transform duration-100', isFolded && '-rotate-90')}
              />
            </span>
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <span className="text-subtle w-4 shrink-0 text-right font-mono text-[0.625rem]">
            {index + 1}
          </span>
          <span className="truncate">{ownName}</span>
          {isFolded && childCount > 0 && (
            <span className="text-subtle shrink-0 font-mono text-[0.625rem]">+{childCount}</span>
          )}
        </button>
      )}
      {renaming !== index && (
        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
          {!sub && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Add a sub-chapter"
              onClick={onAddSub}
            >
              <ListTree className="size-3" />
            </Button>
          )}
          {/* Touch has no double-click, so rename gets a real button. */}
          <Button variant="ghost" size="icon-sm" title="Rename this chapter" onClick={startRename}>
            <Pencil className="size-3" />
          </Button>
          {chapters.length > 1 && (
            <ConfirmPopover
              icon={Trash2}
              triggerTitle={
                childCount > 0
                  ? 'Delete this chapter (its sub-chapters move to the top level)'
                  : 'Delete this chapter'
              }
              question="Delete this chapter?"
              confirmLabel="Delete"
              onConfirm={() => deleteChapter(index)}
            />
          )}
        </div>
      )}
    </li>
  );
}
