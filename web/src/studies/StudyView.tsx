import {
  ChevronLeft,
  ChevronDown,
  Cpu,
  Files,
  ListOrdered,
  ListTree,
  Pencil,
  Plus,
  Table2,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useOpeningName } from '@/lib/opening';
import { AnalysisBoard, BoardControls, ColumnControls, PaneControls } from '@/board/AnalysisBoard';
import { EngineBlock } from '@/engine/EnginePane';
import { ReviewButton, ReviewStrip } from '@/engine/ReviewStrip';
import { ExplorerPane } from '@/explorer/ExplorerPane';
import { MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/utils';
import { isCoarsePointer, useTabbedPanes } from '@/lib/media';
import { navigate, navigateNow } from '@/lib/router';
import { registerLeaveGuard } from '@/lib/leaveGuard';
import { SkeletonBoard, useSlowLoad } from '@/components/skeletons';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { useEngine } from '@/store/engine';
import { useExplorer } from '@/store/explorer';
import { useReview } from '@/store/review';
import { usePrefs } from '@/store/prefs';
import { useStudy } from '@/store/study';
import { fenKey } from '@/lib/fen';
import { consumeJumpTarget } from './jumpTarget';
import { Button } from '@/components/ui/button';
import { ClearableInput } from '@/components/text-fields';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { Panel, PanelHeader } from '@/components/panel';
import { LinkedMentions } from '@/notes/LinkedMentions';
import { AliasEditor } from '@/notes/AliasEditor';
import { splitAliasList } from '@shared/frontMatter';
import { PaneTabs } from '@/components/pane-tabs';
import { PromptDialog } from '@/components/prompt-dialog';
import { RecoveryDialog } from '@/components/recovery-dialog';
import { SaveControl } from '@/components/save-control';
import { DocumentHistory } from '@/components/history-panel';
import { usePaneSwipe } from '@/hooks/use-pane-swipe';
import { AnnotationPane } from './AnnotationPane';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';

type StudyPane = 'moves' | 'engine' | 'chapters' | 'explorer';

/**
 * Whether this document drew player bars last time — see `reservedPlayers`.
 * A study's chapters can carry White and Black headers (one made from an
 * imported game does), and the bars are drawn for the headers, not for
 * the kind. Per document, like a puzzle book's shape.
 */
const playersKey = (base: string, id: string): string => `vault:doc-players:${base}:${id}`;

export function StudyView({
  id,
  kind = 'study',
  chapter,
}: {
  id: string;
  kind?: 'study' | 'game';
  /**
   * Which chapter to open at, from the address. Applied once, on the way
   * in — it says where to START, not which chapter is showing, so changing
   * chapters afterwards does not rewrite the URL and coming back to this
   * one does not fight the reader for the selection.
   */
  chapter?: number;
}) {
  const openId = useStudy((s) => s.openId);
  const pending = useSlowLoad(openId !== id);
  const open = useStudy((s) => s.open);
  const close = useStudy((s) => s.close);
  const save = useStudy((s) => s.save);
  const saveState = useStudy((s) => s.saveState);
  // What the moves panel is called. A study's moves belong to a chapter,
  // and its name is the useful thing to see while reading — the study's own
  // title is already in the header above. A game has one chapter named
  // after the document, so it takes the opening instead, like the Board.
  const chapterName = useStudy((s) => s.chapters[s.chapterIndex]?.name ?? '');
  // The document's own aliases live in the first chapter's header — see
  // the store. The SELECTOR takes the raw string and the split happens
  // after: a selector returning a fresh array is a new value on every
  // render, which is an infinite loop rather than a wasted comparison.
  const aliasHeader = useStudy((s) => s.chapters[0]?.headers['Aliases'] ?? '');
  const aliases = useMemo(() => splitAliasList(aliasHeader), [aliasHeader]);
  const setAliases = useStudy((s) => s.setAliases);
  const analysisTree = useAnalysis((s) => s.tree);
  const analysisCursor = useAnalysis((s) => s.cursorId);
  const openingName = useOpeningName(
    useMemo(
      () => pathTo(analysisTree, analysisCursor).map((nodeId) => getNode(analysisTree, nodeId).fen),
      [analysisTree, analysisCursor],
    ),
  );
  const movesTitle =
    kind === 'game' ? (openingName ?? t('Starting position')) : chapterName || t('Moves');
  const error = useStudy((s) => s.error);
  const [failed, setFailed] = useState(false);
  // Small screens show one pane at a time under the board.
  const [pane, setPane] = useState<StudyPane>('moves');
  // Whether the side column shows every pane at once — see the board below.
  // Reading vs annotating: reading hides the NAG toolbar and comment boxes
  // — and, in the store, keeps the autosave from writing what a reader
  // merely walked through. See the subscriber in store/study.ts.
  const [loadOpen, setLoadOpen] = useState(false);
  const editing = useStudy((s) => s.editing);
  const setEditing = useStudy((s) => s.setEditing);
  const recovery = useStudy((s) => s.recovery);
  // Subscribed, not read: turning autosave on in Settings has to reach the
  // header of a study that is already open.
  const autosave = usePrefs((p) => p.autosave);

  const base = kind === 'game' ? ('games/docs' as const) : ('studies' as const);
  const backSection = kind === 'game' ? ('games' as const) : ('studies' as const);

  // What the placeholder reserves for the player bars while the document
  // is in flight. On a wide screen the top slot is held whatever it will
  // carry, but a stacked layout draws the bars only when there are
  // players, and `kind === 'game'` was the guess: measured on the demo at
  // 390px, a study made from a game put its board 34px lower and the
  // column under it 64px lower than the placeholder had them. Stored per
  // document on the way out, read on the way in; a document never opened
  // here falls back to the guess. Keyed on the document, not the mount:
  // this view is not remounted between one study and the next.
  const hasPlayers = useAnalysis((s) => s.gameHeaders !== null);
  const reservedPlayers = useMemo<boolean | null>(() => {
    const stored = localStorage.getItem(playersKey(base, id));
    return stored === null ? null : stored === '1';
  }, [base, id]);
  useEffect(() => {
    if (openId !== id) return;
    localStorage.setItem(playersKey(base, id), hasPlayers ? '1' : '0');
  }, [openId, id, base, hasPlayers]);

  useEffect(() => {
    let cancelled = false;
    useReview.getState().clear();
    void open(id, base).then((ok) => {
      if (!cancelled) setFailed(!ok);
      // The address may name a chapter — a backlink into the one that
      // mentions this document. Out of range is ignored rather than
      // clamped: a chapter that is not there is a link from before it was
      // deleted, and chapter one is not a better answer than the one the
      // reader already has.
      if (ok && !cancelled && chapter !== undefined) {
        const { chapters, selectChapter } = useStudy.getState();
        if (chapter > 0 && chapter < chapters.length) selectChapter(chapter);
      }
      // The opening map (or any other sender) may have asked to land on a
      // position. Consumed exactly once; a plain open sees nothing, and a
      // target the study does not contain falls through silently.
      const target = ok && !cancelled ? consumeJumpTarget() : null;
      if (target) {
        const { chapters, selectChapter } = useStudy.getState();
        const scoped = (name: string): boolean =>
          !target.chapter || name === target.chapter || name.startsWith(`${target.chapter}/`);
        outer: for (let ci = 0; ci < chapters.length; ci += 1) {
          if (!scoped(chapters[ci]!.name)) continue;
          for (const node of Object.values(chapters[ci]!.tree.nodes)) {
            if (fenKey(node.fen) === target.fenKey) {
              selectChapter(ci);
              useAnalysis.setState({ cursorId: node.id });
              break outer;
            }
          }
        }
      }
    });
    return () => {
      cancelled = true;
      void close();
    };
  }, [id, base, chapter, open, close]);

  // A game review left running would walk the whole game on background
  // threads with no visible sign anywhere else in the app — abort it on
  // leave, exactly as AnalysisView does. Keyed on the chapter, because
  // switching chapters swaps the tree out from under a run in flight; the
  // run loop bails after the in-flight ply and frees its worker.
  const chapterIndex = useStudy((s) => s.chapterIndex);
  useEffect(() => () => {
    if (useReview.getState().status === 'running') useReview.getState().clear();
  }, [chapterIndex]);

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

  // A study with unsaved edits must survive being navigated away from —
  // including the browser's own Back, and the tab being closed. The whole
  // question lives in leaveGuard; this only says what is at stake.
  useEffect(() =>
    registerLeaveGuard({
      name: id.split('/').at(-1)!,
      isDirty: () => useStudy.getState().saveState !== 'saved',
      save: async () => {
        await useStudy.getState().save();
        return useStudy.getState().saveState !== 'error';
      },
      discard: () => useStudy.getState().discard(),
      autoSaves: () => usePrefs.getState().autosave,
    }),
  [id]);

  // One list for the strip and for the swipe that turns it — see
  // AnalysisView, the same column and the same reason.
  const panes = [
    { id: 'moves' as const, label: 'Moves', icon: ListOrdered },
    { id: 'engine' as const, label: 'Engine', icon: Cpu },
    ...(kind === 'study' ? [{ id: 'chapters' as const, label: 'Chapters', icon: Files }] : []),
    { id: 'explorer' as const, label: 'Explorer', icon: Table2 },
  ];
  const paneSwipe = usePaneSwipe({
    panes,
    value: pane,
    onChange: setPane,
    enabled: useTabbedPanes(),
  });

  if (failed) {
    return (
      <div className="optical-center h-full p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground text-base">{error ?? `Could not open “${id}”.`}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate(backSection)}>
            <ChevronLeft className="size-3.5" data-icon="inline-start" />
            {t(kind === 'game' ? 'All games' : 'All studies')}
          </Button>
        </div>
      </div>
    );
  }

  if (openId !== id) {
    // A study is a board beside its moves, so the wait is that shape —
    // the columns settle before the position arrives instead of snapping
    // into place when it does.
    return (
      <div className="h-full">
        {pending && (
          <SkeletonBoard
            players={reservedPlayers ?? kind === 'game'}
            chapters={kind === 'study'}
            explorer
          />
        )}
      </div>
    );
  }

  // Rendered twice — at the page top on stacked layouts, in the side column
  // on wide ones — because CSS cannot reparent. Only one is ever visible.
  // `inColumn` marks the copy that stands in the pane column as furniture
  // the swipe measures against rather than a pane it can turn
  // (hooks/use-pane-swipe). It has to say so because `wide` starts at 44rem
  // in landscape while the panes stay tabbed to 64rem — a phone held
  // sideways shows this row AND the tab strip, and a column with two boxes
  // down it is not a row the gesture will touch. Only that copy: the marker
  // on the page-top one would be inert, but it is also the only handle the
  // column has for finding its own furniture.
  const titleRow = (className: string, inColumn = false) => (
    <div
      className={cn('flex shrink-0 items-center gap-2 wide:h-9', className)}
      data-pane-strip={inColumn ? '' : undefined}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        title={t(kind === 'game' ? 'All games' : 'All studies')}
        onClick={() => navigate(backSection)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <TitleEditor id={id} backSection={backSection} />
      {/* What links here, then History, then Edit, then Save: what points
          at this document, what it has been, what it is becoming, what it
          becomes. */}
      <AliasEditor
        title={t(kind === 'game' ? 'Other names for this game' : 'Other names for this study')}
        names={aliases}
        onSave={(names) => void setAliases(names)}
      />
      <LinkedMentions section={kind === 'game' ? 'games' : 'studies'} id={id} />
      <DocumentHistory
        kind={kind === 'game' ? 'games' : 'studies'}
        id={id}
        name={id.split('/').at(-1)!}
        // Re-open rather than patch the store: a restore replaced the file
        // on disk, and the document in the tab is now a stale copy of
        // something that no longer exists.
        onRestored={() => void open(id, base)}
      />
      {/* One edit button for the whole document, in the header — the shape
          Notes uses. There is no separate pencil for the title (double-click
          it, as in a note) and none inside the moves panel: editing a
          document is one mode, not two. */}
      <Button
        variant={editing ? 'default' : 'secondary'}
        size="sm"
        className="shrink-0"
        title={editing ? t('Hide the editing tools') : t('Show NAGs, comments and move tools')}
        onClick={() => setEditing(!editing)}
      >
        <Pencil className="size-3.5 md:mr-1" />
        <span className="max-md:hidden">{editing ? t('Done') : t('Edit')}</span>
      </Button>
      <SaveControl
        state={saveState}
        error={error}
        autoSaves={autosave}
        onSave={() => void save()}
      />
    </div>
  );

  return (
    <div className={BOARD_HELD_SHELL}>
      {titleRow('wide:hidden')}
      {/* The pieces move in both modes. A study opens as a document to step
          through, but trying a move in a position you are reading is a
          normal thing to want and it costs nothing now — the change is
          pending until you save it, and the badge above says so. What the
          pencil still switches is the TOOLS: drawn arrows, NAGs, comments,
          move surgery. */}
      {/* Same as the board page: the row goes where the moves panel's own
          copy is on screen to carry it. */}
      <AnalysisBoard drawShapes={editing} />

      {/* Desktop scrolls the column; phones show one pane that fills the
          height under the board and scrolls internally (see AnalysisView). */}
      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden max-lg:overflow-y-auto max-lg:scrollbar-hidden stacked:min-h-40 stacked:gap-2 ${BOARD_WIDE_SIDE}`}
        {...paneSwipe.column}
      >
        {titleRow('stacked:hidden', true)}

        <PaneTabs className="lg:hidden" value={pane} onChange={setPane} tabs={panes} />
        {/* The hiding goes on the panel itself. A `contents` wrapper around
            it did the same job, but a box that generates no box of its own
            cannot be moved — and the swipe that turns these panes moves
            the column's children (hooks/use-pane-swipe), so Chapters was
            the one pane in the app that swapped without sliding. */}
        {kind === 'study' && (
          <ChaptersPanel className={cn(!paneSwipe.shows('chapters') && 'max-lg:hidden')} />
        )}
        {/* Desktop keeps a floor and scrolls the column; phones drop it so
            the panel fills the slot and the move table scrolls inside. */}
        {/* max-lg:min-h-0 lets the move table shrink so the annotation
            editor below it is never squeezed out of the panel; the column
            scrolls (above) if even that is not enough. */}
        <Panel
          className={cn(
            // The floor is a share of the column as well as a size — see
            // AnalysisView, same panel, same reason: on a short window a
            // rem-only floor is bigger than the column can spend, and what
            // it costs comes out of the panels below, which are clipped
            // rather than shrunk.
            'flex-1 max-lg:min-h-0 lg:min-h-[min(22rem,45%)]',
            // Every child of this panel except the move table is shrink-0 —
            // engine block, header, review strip, board controls, editor —
            // so once they add up to more than the panel is tall, Panel's
            // own overflow-hidden clips the LAST of them away: the
            // annotation editor. Scrolling here is inert while things fit
            // and is the only thing that saves the editor when they do not.
            // It has to apply at every width: a short landscape viewport is
            // above lg and hits this harder than a phone, because the
            // engine block is only rendered there.
            'overflow-y-auto scrollbar-hidden',
            !paneSwipe.shows('moves') && 'max-lg:hidden',
          )}
        >
          {/* Docked on desktop; its own tab on phones (below). */}
          <EngineBlock className="max-lg:hidden" />
          <PanelHeader
            // A study's moves belong to a chapter, and the chapter's name
            // is the useful thing to see while reading it — the study's own
            // title is already in the header above.
            title={movesTitle}
            actions={
              <>
                <SidelinesToggle />
                {/* On the header where there is room; under ⋯ on a phone. */}
                <span className="hidden items-center gap-1 md:inline-flex">
                  <ReviewButton />
                </span>
                {/* Not an editing tool: putting a position on the board
                    is how you read one that arrived as a FEN in a message
                    or a diagram in a photo, and while reading nothing is
                    written back (the store's autosave subscriber ignores a
                    reader's walk). Gating it on Edit made a reader turn
                    editing on to look at a position — the one act that
                    DOES start saving. */}
                <LoadPositionButton
                  open={loadOpen}
                  onOpenChange={setLoadOpen}
                  triggerClassName="max-md:hidden"
                />
                {editing && <MoveActions allowReset={false} allowClear />}
                {/* No Clear the board here: in a study the board IS the
                    document, and resetting it would take the chapter's own
                    starting position, its introduction and its headers with
                    the moves. Clearing the MOVES is a real editing act
                    though — offered while editing, and undoable. This is
                    also the only way to copy a chapter's FEN or PGN on a
                    phone — the Board's status bar has never existed here. */}
                <MovesOverflow
                  allowReset={false}
                  allowClear={editing}
                  onLoadPosition={() => setLoadOpen(true)}
                />
              </>
            }
          />
          <MoveTreePane />
          <ReviewStrip />
          <PaneControls className="max-lg:hidden" />
          <AnnotationPane
            editing={editing}
            rootPlaceholder={t(kind === 'game' ? 'Notes on this game…' : 'Chapter introduction…')}
          />
        </Panel>
        <Panel
          className={cn('flex-1 min-h-0 lg:hidden', !paneSwipe.shows('engine') && 'max-lg:hidden')}
        >
          <EngineBlock standalone />
        </Panel>
        <ExplorerPane
          resizeKey="study-explorer"
          className={cn(
            'max-lg:min-h-0 max-lg:flex-1 lg:max-h-[35%]',
            !paneSwipe.shows('explorer') && 'max-lg:hidden',
          )}
        />
        <ColumnControls className="lg:hidden" />
      </div>

      {recovery && (
        <RecoveryDialog
          name={id.split('/').at(-1)!}
          at={recovery.at}
          onRecover={() => useStudy.getState().recover()}
          onDismiss={() => void useStudy.getState().dismissRecovery()}
          onDefer={() => useStudy.getState().deferRecovery()}
        />
      )}


      {/* Phones: move navigation in the bottom bar (see AnalysisView). */}
      <MobileActionBar>
        <BoardControls className="py-1.5" />
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
    // navigateNow: a rename lands on the SAME document under a new id, so
    // there is nothing to ask about leaving.
    if (result.id && result.id !== id) navigateNow(backSection, encodeURIComponent(result.id));
  };

  if (editing) {
    return (
      <ClearableInput
        autoFocus
        inputSize="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void submit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="flex-1"
        inputClassName="text-base font-semibold"
      />
    );
  }

  // The naming moment: creation never asks (rightly — a New button should
  // cost nothing), but nothing ever asked again, and the shelf filled with
  // "Untitled study 3". A quiet offer, worn only while the placeholder is.

  return (
    <>
      <h1
        onDoubleClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        title={failure ?? id}
        className={cn('min-w-0 flex-1 truncate text-base font-semibold', failure ? 'text-destructive' : 'text-foreground')}
      >
        {folder && <span className="text-muted-foreground">{folder} / </span>}
        {name}
        {failure ? `: ${failure}` : ''}
      </h1>
    </>
  );
}

function ChaptersPanel({ className }: { className?: string }) {
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
    //
    // It shrinks (no `shrink-0`) down to a floor of its own: the column is
    // the board's height, and a study with a dozen chapters would otherwise
    // spend 12rem of it on the list and clip whatever the explorer had
    // below. The list scrolls inside either way.
    <Panel
      className={cn('lg:max-h-48 lg:min-h-[min(6rem,15%)] max-lg:flex-1 max-lg:min-h-0', className)}
      resizeKey="study-chapters"
    >
      <PanelHeader
        title={`${t('Chapters')} · ${chapters.length}`}
        actions={
          <Button variant="ghost" size="icon-sm" title={t('Add a chapter')} onClick={() => addChapter()}>
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <ul className="min-h-0 overflow-y-auto px-1">
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

  const coarse = isCoarsePointer();
  return (
    <li className={cn('group flex items-center', sub && 'pl-5')}>
      {renaming === index && coarse ? (
        // Touch: the inline input sits where the keyboard lands — rename in
        // a top-pinned sheet instead (the annotation/opening-search idiom).
        <>
          <span className="text-muted-foreground flex h-(--row-h) min-w-0 flex-1 items-center truncate px-1.5 text-sm">
            {ownName}
          </span>
          <PromptDialog
            label={t('Rename this chapter')}
            initial={ownName}
            onSubmit={(value) => {
              const segment = value.replace(/\//g, '-').trim();
              if (segment) renameChapter(index, `${prefix}${segment}`);
            }}
            onClose={() => setRenaming(null)}
          />
        </>
      ) : renaming === index ? (
        <ClearableInput
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
          // The fold's keyboard: the chevron inside is a mouse target
          // only (a button cannot hold a button), so the row itself folds
          // on ← and unfolds on →, the way a tree row does, and says
          // which way it stands through aria-expanded.
          aria-expanded={childCount > 0 ? !isFolded : undefined}
          onKeyDown={(e) => {
            if (childCount === 0) return;
            if ((e.key === 'ArrowLeft' && !isFolded) || (e.key === 'ArrowRight' && isFolded)) {
              e.preventDefault();
              e.stopPropagation();
              onToggleFold();
            }
          }}
          className={cn(
            // The height is the density token, not a literal: this row
            // cannot be sized by its text (it swaps in a rename input and
            // carries a hover tray), so what it states is a height.
            'flex h-(--row-h) min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-sm',
            'transition-colors duration-100',
            index === chapterIndex
              ? 'bg-muted text-primary font-semibold'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {childCount > 0 ? (
            <TitleTip
              title={
                isFolded ? t('Unfold {n} sub-chapters', { n: childCount }) : t('Fold sub-chapters')
              }
            >
              <span
                // A mouse target inside the row's button, not a control
                // of its own: the keyboard folds through the row (above).
                aria-hidden
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFold();
                }}
                // Touch gets a ~32px hit area; the negative margin cancels
                // the padding so the visual layout doesn't move.
                className="hover:text-foreground -m-1 shrink-0 p-1 pointer-coarse:-m-2.5 pointer-coarse:p-2.5"
              >
                <ChevronDown
                  className={cn('size-3 transition-transform duration-100', isFolded && '-rotate-90')}
                />
              </span>
            </TitleTip>
          ) : (
            <span className="size-3 shrink-0" />
          )}
          <span className="text-muted-foreground w-4 shrink-0 text-right font-mono text-xs">
            {index + 1}
          </span>
          {/* The row's tip rides its NAME, not the button: the fold
              chevron inside carries a tip of its own, and a tip around a
              tip opens both at once — pointing at the chevron would put
              "double-click to rename" up beside "fold sub-chapters". Same
              answer openingmap/FieldRow reached, for the same reason. */}
          <TitleTip title={t('Double-click to rename')}>
            <span className="truncate">{ownName}</span>
          </TitleTip>
          {isFolded && childCount > 0 && (
            <span className="text-muted-foreground shrink-0 font-mono text-xs">+{childCount}</span>
          )}
        </button>
      )}
      {renaming !== index && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          {!sub && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Add a sub-chapter')}
              onClick={onAddSub}
            >
              <ListTree className="size-3" />
            </Button>
          )}
          {/* Touch has no double-click, so rename gets a real button. */}
          <Button variant="ghost" size="icon-sm" title={t('Rename this chapter')} onClick={startRename}>
            <Pencil className="size-3" />
          </Button>
          {chapters.length > 1 && (
            <ConfirmDialog
              icon={Trash2}
              triggerTitle={t(
                childCount > 0
                  ? 'Delete this chapter (its sub-chapters move to the top level)'
                  : 'Delete this chapter',
              )}
              question={t('Delete this chapter?')}
              confirmLabel="Delete"
              onConfirm={() => deleteChapter(index)}
            />
          )}
        </div>
      )}
    </li>
  );
}
