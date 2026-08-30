import { EditorContent, useEditor } from '@tiptap/react';
import { ChevronLeft, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { navigate, navigateNow } from '@/lib/router';
import { registerLeaveGuard } from '@/lib/leaveGuard';
import { usePrefs } from '@/store/prefs';
import { Button } from '@/components/ui/button';
import { ClearableInput } from '@/components/text-fields';
import { RecoveryDialog } from '@/components/recovery-dialog';
import { SaveControl, type SaveState } from '@/components/save-control';
import { DocumentHistory } from '@/components/history-panel';
import { SkeletonDocument, useSlowLoad } from '@/components/skeletons';
import { docToMarkdown, markdownToDoc, noteExtensions, splitFrontMatter } from './markdown';
import { EditorPalette } from './EditorPalette';
import { WikiSuggest } from './WikiSuggest';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { t } from '@/lib/i18n';
import { api, apiErrorMessage } from '@/lib/api';

const AUTOSAVE_MS = 1500;
/** How long after the last edit the pending copy is parked. See the study
    store: a crash net, not a save, so it is deliberately less eager. */
const PARK_MS = 4000;

/** One open note: a Tiptap editor over markdown, boards included. */
export function NoteView({ id }: { id: string }) {
  const [initialDoc, setInitialDoc] = useState<object | null>(null);
  const pending = useSlowLoad(initialDoc === null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    let cancelled = false;
    setInitialDoc(null);
    setFailed(null);
    setFrontMatter('');
    setRecovery(null);
    void api<{ pgn: string; draft?: string; draftAt?: string }>(
      `/api/notes/${encodeURIComponent(id)}`,
    )
      .then(({ pgn, draft, draftAt }) => {
        if (cancelled) return;
        setFrontMatter(splitFrontMatter(pgn).front);
        setLoaded(pgn);
        setInitialDoc(markdownToDoc(pgn).toJSON() as object);
        if (draft && draftAt) setRecovery({ pgn: draft, at: draftAt });
      })
      .catch(() => {
        if (!cancelled) setFailed(t('could not open “{id}”', { id }));
      });
    return () => {
      cancelled = true;
    };
  }, [id, restored]);

  if (failed) {
    return (
      <div className="optical-center h-full p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground text-base">{failed}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate('notes')}>
            <ChevronLeft className="size-3.5" data-icon="inline-start" />
            {t('All notes')}
          </Button>
        </div>
      </div>
    );
  }

  if (!initialDoc) {
    // A note is prose, so the wait looks like prose rather than a spinner
    // parked in the middle of an empty page.
    // SkeletonDocument is the note's own column, scrolling and all, so it
    // needs no wrapper of its own — one used to add a second scroller
    // around a box that already had one.
    return <div className="h-full">{pending && <SkeletonDocument />}</div>;
  }

  return (
    <NoteEditor
      key={`${id}:${restored}`}
      id={id}
      initialDoc={initialDoc}
      loaded={loaded}
      frontMatter={frontMatter}
      saveState={saveState}
      setSaveState={setSaveState}
      saveTimer={saveTimer}
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
  saveState,
  setSaveState,
  saveTimer,
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
  saveState: SaveState;
  setSaveState: (s: SaveState) => void;
  saveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /** A copy the vault kept from a session that ended without saving. */
  recovery: { pgn: string; at: string } | null;
  onRecoveryAnswered: () => void;
  /** An earlier version was written over the file; re-read it. */
  onRestored: () => void;
}) {
  // Notes open read-only (wiki-links follow on plain click); the header's
  // Edit button switches the TipTap editor live.
  const [editable, setEditable] = useState(false);
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
  front.current = frontMatter;
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
        schedulePark(docToMarkdown(editor.state.doc, front.current));
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
  useEffect(() => {
    return () => {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // See StudyView: the same claim on the way out, for the same reasons.
  useEffect(() => {
    if (!editor) return;
    return registerLeaveGuard({
      name: id.split('/').at(-1)!,
      isDirty: () => docToMarkdown(editor.state.doc, front.current) !== lastSaved.current,
      save: () => save(docToMarkdown(editor.state.doc, front.current)),
      discard,
      autoSaves: () => usePrefs.getState().autosave,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return (
    // No padding on the TOP of the scroll container: `sticky top-0` pins to
    // the scrollport, which is the padding box, so a pt- here leaves a band
    // above the pinned header for content to scroll through in plain view.
    // The header wrapper carries that padding instead. The bottom keeps the
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
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+var(--safe-b))] md:px-6 md:pb-6">
      {/* Header AND palette pin together. Pinning only the palette left the
          title scrolling away above it, and the negative margins let the
          bar span the column's full width — inset by the page padding it
          read as narrower than the text it formats. */}
      <div
        className={cn(
          'border-border bg-background sticky top-0 z-30 -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pt-4 md:-mx-6 md:px-6 md:pt-6',
          // The palette is what the small bottom padding was for: it sits
          // right above the rule and does not want a gap of its own. In
          // reading mode it renders nothing, and the header was left with
          // 16px above it and 6px below - the title looked pushed against
          // the rule. Without the palette the block gets even padding.
          editable ? 'pb-1.5' : 'pb-3',
        )}
      >
      <header className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('All notes')} onClick={() => navigate('notes')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <NoteTitle id={id} />
        {/* History, then Edit, then Save — see StudyView's header. */}
        <DocumentHistory kind="notes" id={id} name={id.split('/').at(-1)!} onRestored={onRestored} />
        <Button
          variant={editable ? 'default' : 'secondary'}
          size="sm"
          title={editable ? t('Back to reading') : t('Edit this note')}
          onClick={() => setEditable((v) => !v)}
        >
          <Pencil className="size-3.5 md:mr-1" />
          <span className="max-md:hidden">{editable ? t('Done') : t('Edit')}</span>
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
      <WikiSuggest editor={editor} />

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
      </h1>
    </>
  );
}

