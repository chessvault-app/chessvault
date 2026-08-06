import { ArrowLeft, Check, CircleAlert, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { EnginePane } from '@/engine/EnginePane';
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
import { AnnotationPane } from './AnnotationPane';

export function StudyView({ id, kind = 'study' }: { id: string; kind?: 'study' | 'game' }) {
  const openId = useStudy((s) => s.openId);
  const open = useStudy((s) => s.open);
  const close = useStudy((s) => s.close);
  const saveState = useStudy((s) => s.saveState);
  const error = useStudy((s) => s.error);
  const [failed, setFailed] = useState(false);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row lg:gap-4 lg:p-4">
      <AnalysisBoard />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:max-w-[27rem] lg:overflow-visible">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={kind === 'game' ? 'All games (saves first)' : 'All studies (saves first)'}
            onClick={() => navigate(backSection)}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">{id}</h1>
          <SaveIndicator state={saveState} error={error} />
        </div>

        <EnginePane className="shrink-0" />
        {kind === 'study' && <ChaptersPanel />}
        <Panel flush className="min-h-[10rem] flex-1">
          <PanelHeader title="Moves" actions={<MoveActions allowReset={false} />} />
          <MoveTreePane />
          <AnnotationPane
            rootPlaceholder={kind === 'game' ? 'Notes on this game…' : 'Chapter introduction…'}
          />
        </Panel>
        <ExplorerPane className="max-h-72 shrink-0 lg:max-h-[35%]" />
      </div>
    </div>
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
  const chapterIndex = useStudy((s) => s.chapterIndex);
  const selectChapter = useStudy((s) => s.selectChapter);
  const addChapter = useStudy((s) => s.addChapter);
  const renameChapter = useStudy((s) => s.renameChapter);
  const deleteChapter = useStudy((s) => s.deleteChapter);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <Panel flush className="max-h-48 shrink-0">
      <PanelHeader
        title={`Chapters · ${chapters.length}`}
        actions={
          <Button variant="ghost" size="icon-sm" title="Add a chapter" onClick={addChapter}>
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <ul className="min-h-0 overflow-y-auto p-1">
        {chapters.map((chapter, index) => (
          <li key={chapter.id} className="group flex items-center">
            {renaming === index ? (
              <input
                autoFocus
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
                title="Double-click to rename"
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
                <span className="truncate">{chapter.name}</span>
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
        ))}
      </ul>
    </Panel>
  );
}
