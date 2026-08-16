import { EditorContent, useEditor } from '@tiptap/react';
import { ChevronLeft, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate, navigateNow } from '@/lib/router';
import { registerLeaveGuard } from '@/lib/leaveGuard';
import { usePrefs } from '@/store/prefs';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { RecoverySheet } from '@/ui/RecoverySheet';
import { SaveControl, type SaveState } from '@/ui/SaveControl';
import { SkeletonDocument, useSlowLoad } from '@/ui/Skeleton';
import { UndoBar } from '@/ui/UndoBar';
import { useUndoable } from '@/ui/useUndoable';
import { docToMarkdown, markdownToDoc, noteExtensions, splitFrontMatter } from './markdown';
import { EditorPalette } from './EditorPalette';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { isUntitled, t } from '@/lib/i18n';

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
   * saving. Offered, never applied: see RecoverySheet.
   */
  const [recovery, setRecovery] = useState<{ pgn: string; at: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitialDoc(null);
    setFailed(null);
    setFrontMatter('');
    setRecovery(null);
    void fetch(`/api/notes/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`could not open “${id}”`);
        const { pgn, draft, draftAt } = (await res.json()) as {
          pgn: string;
          draft?: string;
          draftAt?: string;
        };
        if (cancelled) return;
        setFrontMatter(splitFrontMatter(pgn).front);
        setLoaded(pgn);
        setInitialDoc(markdownToDoc(pgn).toJSON() as object);
        if (draft && draftAt) setRecovery({ pgn: draft, at: draftAt });
      })
      .catch((error: Error) => {
        if (!cancelled) setFailed(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (failed) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted text-sm">{failed}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate('notes')}>
            <ChevronLeft className="mr-1 size-3.5" />
            {t('All notes')}
          </Button>
        </div>
      </div>
    );
  }

  if (!initialDoc) {
    // A note is prose, so the wait looks like prose rather than a spinner
    // parked in the middle of an empty page.
    return <div className="h-full overflow-y-auto">{pending && <SkeletonDocument />}</div>;
  }

  return (
    <NoteEditor
      key={id}
      id={id}
      initialDoc={initialDoc}
      loaded={loaded}
      frontMatter={frontMatter}
      saveState={saveState}
      setSaveState={setSaveState}
      saveTimer={saveTimer}
      recovery={recovery}
      onRecoveryAnswered={() => setRecovery(null)}
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
  const undoable = useUndoable();

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
    void fetch(`/api/notes/${encodeURIComponent(id)}?draft=1`, { method: 'DELETE' }).catch(() => {});
  };
  const schedulePark = (markdown: string): void => {
    cancelPark();
    parkTimer.current = setTimeout(() => {
      parkTimer.current = null;
      void fetch(`/api/notes/${encodeURIComponent(id)}?draft=1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pgn: markdown }),
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
      lastSaved.current = docToMarkdown(editor.state.doc, front.current);
    },
    onUpdate: ({ editor }) => {
      // Compare rather than trust the event: only a real difference is an
      // edit worth saving (and worth telling the reader about).
      if (docToMarkdown(editor.state.doc, front.current) === lastSaved.current) return;
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
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pgn: markdown }),
      });
      // The baseline moves only when the write LANDED. It used to be set
      // before the request went out, so a failed save left the note
      // claiming the unwritten text was what the vault had — harmless
      // while nothing read the baseline, wrong the moment discard does.
      if (res.ok) lastSaved.current = markdown;
      setSaveState(res.ok ? 'saved' : 'error');
      return res.ok;
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
      <div className="border-line bg-app sticky top-0 z-30 -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pb-1.5 pt-4 md:-mx-6 md:px-6 md:pt-6">
      <header className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('All notes')} onClick={() => navigate('notes')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <NoteTitle id={id} />
        <Button
          variant={editable ? 'primary' : 'secondary'}
          size="sm"
          title={editable ? t('Back to reading') : t('Edit this note')}
          onClick={() => setEditable((v) => !v)}
        >
          <Pencil className="size-3.5 md:mr-1" />
          <span className="max-md:hidden">{editable ? t('Done') : t('Edit')}</span>
        </Button>
        <SaveControl
          state={saveState}
          onSave={() => editor && void save(docToMarkdown(editor.state.doc, front.current))}
        />
      </header>
      <EditorPalette editor={editor} editable={editable} />
      </div>

      <EditorContent editor={editor} className="min-h-0 flex-1" />

      {recovery && editor && (
        <RecoverySheet
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
        />
      )}

      {undoable.pending && (
        <UndoBar
          label={undoable.pending.label}
          message={undoable.pending.label}
          leaving={undoable.pending.leaving}
          onUndo={undoable.undo}
          onHold={undoable.hold}
          onRelease={undoable.release}
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
    const res = await fetch('/api/notes/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: id, to }),
    });
    // navigateNow: a rename lands on the SAME note under a new id, so there
    // is nothing to ask about leaving.
    if (res.ok) navigateNow('notes', encodeURIComponent(to));
    else {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setFailure(t(body?.error ?? 'could not rename'));
    }
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

  // Same naming moment as the studies shelf: the placeholder invites its
  // replacement for as long as it is worn, and no longer.
  const untitled = isUntitled(name, 'Untitled note');

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
      </h1>
      {untitled && (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" />
          {t('Name this note')}
        </Button>
      )}
    </>
  );
}

