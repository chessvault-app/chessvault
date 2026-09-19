import { EditorContent, useEditor } from '@tiptap/react';
import { ChevronLeft, FileX, Pencil } from 'lucide-react';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { navigate, navigateNow } from '@/lib/router';
import { registerLeaveGuard } from '@/lib/leaveGuard';
import { usePrefs } from '@/store/prefs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { TitleTip } from '@/components/title-tip';
import { ClearableInput } from '@/components/text-fields';
import { RecoveryDialog } from '@/components/recovery-dialog';
import { SaveControl, type SaveState } from '@/components/save-control';
import { DocumentTools } from '@/components/document-tools';
import { useSlowLoad } from '@/components/skeletons';
import NoteOutline from './NoteView.skeleton';
import { routePlaceholderShown } from '@/lib/lazyRoute';
import { docToMarkdown, markdownToDoc, noteExtensions, splitFrontMatter } from './markdown';
import { EditorPalette } from './EditorPalette';
import { WikiSuggest } from './WikiSuggest';
import { wikiSuggestStore } from './wikiLink';
import { readAliases, writeAliases } from '@shared/frontMatter';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { useScrollReveal } from '@/hooks/use-scroll-reveal';
import { useMediaQuery } from '@/lib/media';
import { usePinnedBand } from '@/hooks/use-pinned-band';
import { t } from '@/lib/i18n';
import { api, apiErrorMessage } from '@/lib/api';

const AUTOSAVE_MS = 1500;
/** How long after the last edit the pending copy is parked. See the study
    store: a crash net, not a save, so it is deliberately less eager. */
const PARK_MS = 4000;

/** One open note: a Tiptap editor over markdown, boards included. */
export function NoteView({ id }: { id: string }) {
  const [initialDoc, setInitialDoc] = useState<object | null>(null);
  /** The route's own outline was already drawing this picture while the
      editor's chunk came down (lib/lazyRoute), so useSlowLoad's 180ms has
      nothing to protect against here and would only put a hole between
      the two. */
  const [continuing] = useState(routePlaceholderShown);
  const pending = useSlowLoad(initialDoc === null) || (continuing && initialDoc === null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  /**
   * The note's front matter, held aside for the whole visit.
   *
   * It is deliberately not in the document — see splitFrontMatter — so
   * every write has to put it back, or opening a note would silently strip
   * its metadata.
   */
  const [frontMatter, setFrontMatter] = useState('');
  /** The file as loaded, so a save can tell an edit from a settling node. */
  const [loaded, setLoaded] = useState('');
  /**
   * A copy the vault was still holding — a session that ended without
   * saving. Offered, never applied: see RecoveryDialog.
   */
  const [recovery, setRecovery] = useState<{ pgn: string; at: string } | null>(null);
  /**
   * Bumped when an earlier version is restored. The file on disk changed
   * underneath the open editor, so the note is re-fetched and the editor
   * remounted on it — patching the live document would leave the save
   * baseline describing a file that no longer exists.
   */
  const [restored, setRestored] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    setInitialDoc(null);
    setFailed(null);
    setFrontMatter('');
    setRecovery(null);
    void api<{ pgn: string; draft?: string; draftAt?: string }>(
      `/api/notes/${encodeURIComponent(id)}`,
      { signal: ctl.signal },
    )
      .then(({ pgn, draft, draftAt }) => {
        if (ctl.signal.aborted) return;
        setFrontMatter(splitFrontMatter(pgn).front);
        setLoaded(pgn);
        setInitialDoc(markdownToDoc(pgn).toJSON() as object);
        if (draft && draftAt) setRecovery({ pgn: draft, at: draftAt });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(t('could not open “{id}”', { id }));
      });
    return () => {
      ctl.abort();
    };
  }, [id, restored]);

  if (failed) {
    return (
      <div className="optical-center h-full">
        <EmptyState
          ground
          icon={FileX}
          title="The note could not be opened"
          body={failed}
          action={
            <Button onClick={() => navigate('notes')}>
              <ChevronLeft className="glyph" data-icon="inline-start" />
              {t('All notes')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!initialDoc) {
    // A note is prose, so the wait looks like prose rather than a spinner
    // parked in the middle of an empty page.
    // SkeletonDocument is the note's own column, scrolling and all, so it
    // needs no wrapper of its own — one used to add a second scroller
    // around a box that already had one.
    return pending ? <NoteOutline /> : <div className="h-full" />;
  }

  return (
    <NoteEditor
      key={`${id}:${restored}`}
      id={id}
      initialDoc={initialDoc}
      loaded={loaded}
      frontMatter={frontMatter}
      setFrontMatter={setFrontMatter}
      saveState={saveState}
      setSaveState={setSaveState}
      recovery={recovery}
      onRecoveryAnswered={() => setRecovery(null)}
      onRestored={() => setRestored((n) => n + 1)}
    />
  );
}

function NoteEditor({
  id,
  initialDoc,
  loaded,
  frontMatter,
  setFrontMatter,
  saveState,
  setSaveState,
  recovery,
  onRecoveryAnswered,
  onRestored,
}: {
  id: string;
  initialDoc: object;
  /** The file exactly as it came off the server, as the save baseline. */
  loaded: string;
  /** Put back on every write; it is not part of the document. */
  frontMatter: string;
  /** Editing aliases rewrites one key of it — see AliasEditor. */
  setFrontMatter: (front: string) => void;
  saveState: SaveState;
  setSaveState: (s: SaveState) => void;
  /** A copy the vault kept from a session that ended without saving. */
  recovery: { pgn: string; at: string } | null;
  onRecoveryAnswered: () => void;
  /** An earlier version was written over the file; re-read it. */
  onRestored: () => void;
}) {
  // Where the note opens: editable on a desktop, read-only on a phone.
  // Notion, Linear and Obsidian's live preview edit in place, and a
  // separate Edit mode was the one thing on the desktop that read as
  // older than the rest of the app; the desktop has a caret and a
  // keyboard, so an editable page costs it nothing. A phone keeps the
  // mode: a tap on a read-only note is a scroll, on an editable one it
  // is the keyboard rising over half the page. Reading mode is one press
  // away on either, and is where a plain click follows a wiki link; while
  // editing, Ctrl/Cmd+click does (wikiLink.ts). The header's button
  // switches the TipTap editor live.
  const opensEditable = useState(() => window.matchMedia('(min-width: 48rem) and (pointer: fine)').matches)[0];
  const [editable, setEditable] = useState(opensEditable);
  const headerRef = useRef<HTMLDivElement>(null);
  // The armed autosave. Owned here, where it is set and cleared: it used
  // to come down from NoteView as a prop, which the React Compiler refuses
  // to see written, and nothing up there read it. Leaving flushes it, so
  // a remount starts with none pending.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * What is on the server, so an edit can be told from a settling node.
   *
   * Seeded from the FILE rather than left empty for onCreate to fill in.
   * An empty baseline means "the server has nothing", so the first
   * settling transaction — a chess block normalising itself, say — reads
   * as an edit and writes the document back. Under StrictMode's double
   * mount that is exactly what happened: two editors, and the one whose
   * onCreate had not run for this ref saved a note nobody had touched.
   * Dev-only in that instance, but a baseline that says the file is empty
   * is the wrong thing to have lying around either way.
   */
  const lastSaved = useRef(loaded);
  /**
   * Whether that baseline is the editor's own serialisation yet, and the
   * one-shot that makes it so.
   *
   * It used to be onCreate's job alone, and onCreate is too late. Tiptap
   * emits `create` from a setTimeout — a whole macrotask after the editor
   * exists — while the effect that applies `editable` runs synchronously
   * on mount and emits `update`. So the first onUpdate compared against
   * the raw FILE, and any note the serialiser normalises on the way in
   * (a `-` bullet comes back as `*`, a trailing space goes) opened with
   * Save lit over a note nobody had touched. Measured on this vault:
   * seven of the first twelve notes.
   *
   * Whichever of the two arrives first is the right answer — the document
   * cannot have been edited before either, since a note opens read-only —
   * so the baseline is simply the first serialisation anyone offers.
   */
  const baselined = useRef(false);
  const takeBaseline = (markdown: string): boolean => {
    if (baselined.current) return false;
    baselined.current = true;
    lastSaved.current = markdown;
    return true;
  };
  /**
   * The front matter every write has to put back, in a ref.
   *
   * As a prop it was captured by the leaving-the-note effect, whose deps
   * are [editor] — so that closure kept the value from load, which for a
   * note with no front matter is the empty string. Tag a note, walk away,
   * and the flush wrote the document back WITHOUT the block it had just
   * been given. Tagging appeared not to work at all, because the tag only
   * survived as long as you stayed on the page.
   */
  const front = useRef(frontMatter);
  // Filled after commit: the React Compiler refuses a ref written during
  // render, and every reader of it is a handler or an effect.
  useLayoutEffect(() => {
    front.current = frontMatter;
  });
  // Subscribed, not read: turning autosave on in Settings has to reach the
  // header of a note that is already open.
  const autosave = usePrefs((p) => p.autosave);

  /**
   * The crash net — see the study store, which does the same thing for
   * the same reason. Longer than the autosave debounce on purpose: nobody
   * is waiting for it, and it is thrown away the moment Save is pressed.
   */
  const parkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPark = (): void => {
    if (parkTimer.current) {
      clearTimeout(parkTimer.current);
      parkTimer.current = null;
    }
  };
  const dropPark = (): void => {
    cancelPark();
    void api(`/api/notes/${encodeURIComponent(id)}?draft=1`, { method: 'DELETE' }).catch(() => {});
  };
  const schedulePark = (markdown: string): void => {
    cancelPark();
    parkTimer.current = setTimeout(() => {
      parkTimer.current = null;
      void api(`/api/notes/${encodeURIComponent(id)}?draft=1`, {
        method: 'PUT',
        json: { pgn: markdown },
        // A crash net that cannot reach the server is simply not there;
        // the badge already says the work is unsaved.
      }).catch(() => {});
    }, PARK_MS);
  };

  const editor = useEditor({
    extensions: noteExtensions,
    content: initialDoc,
    editable: false,
    editorProps: {
      attributes: { class: 'note-editor focus:outline-none' },
    },
    // Off at birth on every device, and the effect below applies the
    // opening state: the baseline logic (`takeBaseline`) counts on the
    // first serialisation, whoever offers it, being the untouched file,
    // which holds when nothing can type before the editor is live.
    // The canonical serialisation of what was loaded. Node views settle
    // after mount — a chess block normalises itself — and each settling is
    // a transaction, so onUpdate fired on a note nobody had touched and the
    // badge announced 저장 중… over an unedited note.
    onCreate: ({ editor }) => {
      takeBaseline(docToMarkdown(editor.state.doc, front.current));
    },
    onUpdate: ({ editor }) => {
      // Compare rather than trust the event: only a real difference is an
      // edit worth saving (and worth telling the reader about).
      const now = docToMarkdown(editor.state.doc, front.current);
      // No baseline yet, so this IS the baseline — see takeBaseline. It
      // cannot be an edit: the note opens read-only and this fires before
      // anyone has been offered a way to change anything.
      if (takeBaseline(now)) return;
      if (now === lastSaved.current) return;
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Pending is pending either way; the timer is only for anyone who
      // asked this device to write as they type.
      if (!usePrefs.getState().autosave) {
        saveTimer.current = null;
        // Nothing is going to be written, so the copy parked in the vault
        // is the only record of this outside the tab.
        schedulePark(now);
        return;
      }
      saveTimer.current = setTimeout(() => {
        // Cleared as it fires: a timer id left behind reads as "a save is
        // still pending" forever, so leaving the note re-PUT the document
        // every single time — touching its mtime, and reordering the shelf
        // — for a note that had already been saved.
        saveTimer.current = null;
        void save(docToMarkdown(editor.state.doc, front.current));
      }, AUTOSAVE_MS);
    },
  });

  const save = async (markdown: string): Promise<boolean> => {
    setSaveState('saving');
    // The server drops the swap when this PUT lands; cancel the timer so a
    // park cannot fire afterwards and re-park what is now on disk.
    cancelPark();
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        json: { pgn: markdown },
      });
      // The baseline moves only when the write LANDED. It used to be set
      // before the request went out, so a failed save left the note
      // claiming the unwritten text was what the vault had — harmless
      // while nothing read the baseline, wrong the moment discard does.
      lastSaved.current = markdown;
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  };

  /** Back to the vault's copy. `lastSaved` already holds it, front matter
      and all, so this is a re-parse rather than a refetch. */
  const discard = (): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    dropPark();
    if (!editor || editor.isDestroyed) return;
    const markdown = lastSaved.current;
    // emitUpdate false, or the restore itself reads as an edit and dirties
    // the note it has just cleaned.
    editor.commands.setContent(markdownToDoc(markdown).toJSON() as object, { emitUpdate: false });
    front.current = splitFrontMatter(markdown).front;
    setSaveState('saved');
  };

  // Leaving flushes an autosave that was armed but had not fired. Only
  // that: with autosave off there is no timer, and the leave guard has
  // already asked what to do with the changes and been answered.
  // What leaving the editor does, as an Effect Event: it reads the latest
  // save and park without them being dependencies (the React Compiler
  // refuses a suppressed list), and runs from the effect's cleanup.
  const onLeaveEditor = useEffectEvent(() => {
    // A park still on the clock would fire at a note nobody has open.
    // Whatever is already parked stays: that is the whole point of it.
    cancelPark();
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (editor && !editor.isDestroyed) {
        void save(docToMarkdown(editor.state.doc, front.current));
      }
    }
  });
  useEffect(() => {
    return () => onLeaveEditor();
  }, [editor]);

  // See StudyView: the same claim on the way out, for the same reasons.
  const guardLeaving = useEffectEvent(() =>
    registerLeaveGuard({
      name: id.split('/').at(-1)!,
      isDirty: () => docToMarkdown(editor!.state.doc, front.current) !== lastSaved.current,
      save: () => save(docToMarkdown(editor!.state.doc, front.current)),
      discard,
      autoSaves: () => usePrefs.getState().autosave,
    }),
  );
  useEffect(() => {
    if (!editor) return;
    return guardLeaving();
  }, [editor, id]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  /**
   * The bar names the note at rest on every device. For a while a phone's
   * bar held its title back until the note's own level-one heading had
   * scrolled under it, so the same words were not printed twice, 60px
   * apart; lanph3re took that out (2026-09-18): a header with a blank in
   * it read as a header that had not loaded, which is exactly what the
   * note's outline draws there while it loads, so the finished page
   * looked like its own placeholder.
   */
  // The header is measured twice over: once for whether the note has
  // scrolled under it, once for how much of the note it covers, so a Tab or
  // a Shift+Tab onto a board's controls lands below it rather than behind it.
  const pinHeader = usePinnedBand('top');
  const setHeader = (el: HTMLDivElement | null) => {
    headerRef.current = el;
    pinHeader(el);
  };
  // Whether the note has scrolled under the header at all, for its fill,
  // and whether the header should be off the screen: it steps up out of
  // the way while the note is read downwards and comes back on the first
  // move up (hooks/use-scroll-reveal).
  const { scrolled, hidden } = useScrollReveal(headerRef);
  const phone = useMediaQuery('(max-width: 47.9375rem)');

  return (
    // No padding on the TOP of the scroll container: `sticky top-0` pins to
    // the scrollport, which is the padding box, so a pt- here leaves a band
    // above the pinned header for content to scroll through in plain view.
    // The header wrapper carries that padding instead, the phone's
    // status-bar inset included (--page-t, styles/shell.css): the header
    // reaches the top of the screen and its fill runs up behind the
    // status bar, one surface from the screen's edge to the rule, and the
    // note scrolls under all of it. The bottom keeps the
    // home-indicator inset, since an edited note claims the phone's bar and
    // its text would otherwise run under it — and --safe-b is zero while
    // the keyboard is up, when the indicator is behind the keys.
    //
    // Nothing here pads for the KEYBOARD any more. It used to add exactly
    // what the keyboard covered, from when the app shell stayed full
    // height and the bottom of this box was underneath the keys. The shell
    // ends at the keyboard now (lib/keyboardInset, index.css), so this box
    // is already entirely above it and padding again pushed the last lines
    // of the note up out of a container that had nothing under it.
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+var(--safe-b))] md:px-6 md:pb-6 ios:h-[calc(100%+var(--bottom-bar-h))] ios:pb-[calc(1rem+var(--page-b))]">
      {/* Header AND palette pin together. Pinning only the palette left the
          title scrolling away above it, and the negative margins let the
          bar span the column's full width — inset by the page padding it
          read as narrower than the text it formats. */}
      <div
        ref={setHeader}
        className={cn(
          'sticky top-0 z-30 -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pt-[calc(1rem+var(--page-t))] md:-mx-6 md:px-6 md:pt-6',
          // The page's own tone at rest, and once the note has scrolled
          // under it the card's edge as a rule, so the line returns under
          // High contrast. The card's FILL comes with it only on a phone,
          // where the column is the screen and the bar runs edge to edge.
          // On a desktop the column is narrower than its pane, and a filled
          // bar stopped at the text's edges: a slab floating in the pane,
          // the lid of a box with no box under it. There it keeps the page
          // tone, as the top strip of Notion or Obsidian does, and the note
          // just stops under it (lanph3re, 2026-09-19).
          'bg-background transition-[transform,background-color,border-color] duration-(--pane-turn) ease-(--pane-turn-ease)',
          scrolled ? 'border-card-ring max-md:bg-card' : 'border-transparent',
          // Off the top of the scrollport while the note is read down;
          // the sticky box keeps its place, so nothing below moves.
          // Not while editing: pressing Edit focuses the editor, the browser
          // scrolls the caret into view, and that scroll read as a scroll
          // down and slid the bar, and the formatting toolbar in it, off
          // the screen the moment it was needed (lanph3re, 2026-09-18).
          hidden && !editable && '-translate-y-full',
          // The palette is what the small bottom padding was for: it sits
          // right above the rule and does not want a gap of its own. In
          // reading mode it renders nothing, and the header was left with
          // 16px above it and 6px below - the title looked pushed against
          // the rule. Without the palette the block gets even padding.
          editable ? 'pb-1.5' : 'pb-3',
        )}
      >
      <header
        // On the page ground, except a phone's scrolled bar, which is a
        // card and the Edit button's secondary fill separates on its own
        // (index.css, `[data-ground]`).
        data-ground={scrolled && phone ? undefined : ''}
        // Page chrome: on iOS its icon buttons are glass circles (shell.css).
        data-chrome=""
        className="flex shrink-0 items-center gap-2"
      >
        <Button variant="ghost" size="icon-sm" title={t('All notes')} onClick={() => navigate('notes')}>
          <ChevronLeft className="glyph" />
        </Button>
        <NoteTitle id={id} />
        {/* What links here, then History, then Edit, then Save — see
            StudyView's header. */}
        <DocumentTools
          aliases={{
            title: t('Other names for this note'),
            names: readAliases(frontMatter),
            onSave: (names) => {
              // A note keeps them in front matter, which this is the only key
              // of that the app understands — every other line comes back
              // exactly as the writer left it.
              const next = writeAliases(frontMatter, names);
              // Both the ref every write reads and the state this prop comes
              // from: the ref so the save below carries the new block, the
              // state so reopening the dialog shows what was just set.
              front.current = next;
              setFrontMatter(next);
              if (editor) void save(docToMarkdown(editor.state.doc, next));
            },
          }}
          mentions={{ section: 'notes', id }}
          history={{ kind: 'notes', id, name: id.split('/').at(-1)!, onRestored }}
        />
        <Button data-chrome-circle=""
          variant={editable ? 'default' : 'secondary'}
          size="sm"
          title={editable ? t('Back to reading') : t('Edit this note')}
          onClick={() => setEditable((v) => !v)}
        >
          <Pencil className="glyph md:mr-1" />
          {/* Where the note opened editable, leaving is going to read,
              not finishing; where it opened read-only, Done is what the
              press means. */}
          <span className="max-md:hidden">{editable ? (opensEditable ? t('Read') : t('Done')) : t('Edit')}</span>
        </Button>
        <SaveControl
          state={saveState}
          autoSaves={autosave}
          onSave={() => editor && void save(docToMarkdown(editor.state.doc, front.current))}
        />
      </header>
      <EditorPalette editor={editor} editable={editable} />
      </div>

      <EditorContent editor={editor} className="min-h-0 flex-1" />
      <WikiSuggest store={editor ? wikiSuggestStore(editor) : null} host={editor?.view.dom ?? null} />

      {recovery && editor && (
        <RecoveryDialog
          name={id.split('/').at(-1)!}
          at={recovery.at}
          onRecover={() => {
            // Pending, not saved: it never reached the file, and pressing
            // Save is still what puts it there. lastSaved stays where it
            // is, so discarding still goes back to the vault's copy.
            editor.commands.setContent(markdownToDoc(recovery.pgn).toJSON() as object, {
              emitUpdate: false,
            });
            front.current = splitFrontMatter(recovery.pgn).front;
            setSaveState('dirty');
            onRecoveryAnswered();
          }}
          onDismiss={() => {
            dropPark();
            onRecoveryAnswered();
          }}
          // Closes the question without answering it: the park is left
          // alone, so the next open asks again.
          onDefer={onRecoveryAnswered}
        />
      )}

      {/* While editing, the note owns the bottom of the phone: the global
          tabs are pushed above the keyboard by iOS and eat the room the
          note needs. Claiming the bar (with nothing in it) hides them. */}
      {editable && <MobileActionBar>{null}</MobileActionBar>}
    </div>
  );
}

function NoteTitle({ id }: { id: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const name = id.split('/').at(-1)!;
  const folder = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';

  const submit = async (): Promise<void> => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === name) return;
    const to = folder ? `${folder}/${next}` : next;
    try {
      await api('/api/notes/move', { method: 'POST', json: { from: id, to } });
      // navigateNow: a rename lands on the SAME note under a new id, so
      // there is nothing to ask about leaving.
      navigateNow('notes', encodeURIComponent(to));
    } catch (error) {
      setFailure(t(apiErrorMessage(error)));
    }
  };

  if (editing) {
    return (
      <ClearableInput
        autoFocus
        inputSize="sm"
        aria-label={t('Rename this note')}
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

  // Same naming moment as the studies shelf: the placeholder invites its
  // replacement for as long as it is worn, and no longer.

  return (
    <>
      <TitleTip title={failure ?? id}>
      <h1
        onDoubleClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        // The name the note was given, so a long press selects it.
        data-user-text
        className={cn(
          'min-w-0 flex-1 truncate text-base font-semibold',
          failure ? 'text-destructive' : 'text-foreground',
        )}
      >
        {folder && <span className="text-muted-foreground">{folder} / </span>}
        {name}
      </h1>
      </TitleTip>
    </>
  );
}

