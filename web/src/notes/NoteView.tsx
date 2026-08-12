import { EditorContent, useEditor } from '@tiptap/react';
import {
  ChevronLeft,
  Check,
  CircleAlert,
  Loader2,
  Pencil,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useKeyboardInset } from '@/lib/keyboardInset';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { SkeletonDocument, useSlowLoad } from '@/ui/Skeleton';
import { docToMarkdown, markdownToDoc, noteExtensions } from './markdown';
import { EditorPalette } from './EditorPalette';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { t } from '@/lib/i18n';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_MS = 1500;

/** One open note: a Tiptap editor over markdown, boards included. */
export function NoteView({ id }: { id: string }) {
  const [initialDoc, setInitialDoc] = useState<object | null>(null);
  const pending = useSlowLoad(initialDoc === null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitialDoc(null);
    setFailed(null);
    void fetch(`/api/notes/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`could not open “${id}”`);
        const { pgn } = (await res.json()) as { pgn: string };
        if (!cancelled) setInitialDoc(markdownToDoc(pgn).toJSON() as object);
      })
      .catch((error: Error) => {
        if (!cancelled) setFailed(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent): void => {
      if (saveState !== 'saved') e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [saveState]);

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
      saveState={saveState}
      setSaveState={setSaveState}
      saveTimer={saveTimer}
    />
  );
}

function NoteEditor({
  id,
  initialDoc,
  saveState,
  setSaveState,
  saveTimer,
}: {
  id: string;
  initialDoc: object;
  saveState: SaveState;
  setSaveState: (s: SaveState) => void;
  saveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  // Notes open read-only (wiki-links follow on plain click); the header's
  // Edit button switches the TipTap editor live.
  const [editable, setEditable] = useState(false);
  const keyboardInset = useKeyboardInset();
  /** What is on the server, so an edit can be told from a settling node. */
  const lastSaved = useRef('');
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
      lastSaved.current = docToMarkdown(editor.state.doc);
    },
    onUpdate: ({ editor }) => {
      // Compare rather than trust the event: only a real difference is an
      // edit worth saving (and worth telling the reader about).
      if (docToMarkdown(editor.state.doc) === lastSaved.current) return;
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void save(docToMarkdown(editor.state.doc));
      }, AUTOSAVE_MS);
    },
  });

  const save = async (markdown: string): Promise<void> => {
    setSaveState('saving');
    lastSaved.current = markdown;
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pgn: markdown }),
      });
      setSaveState(res.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  };

  // Leaving the note flushes any pending edit.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (editor && !editor.isDestroyed) {
          void save(docToMarkdown(editor.state.doc));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return (
    // No padding on the TOP of the scroll container: `sticky top-0` pins to
    // the scrollport, which is the padding box, so a pt- here leaves a band
    // above the pinned header for content to scroll through in plain view.
    // The header wrapper carries that padding instead. The bottom keeps the
    // home-indicator inset, since an edited note claims the phone's bar and
    // its text would otherwise run under it.
    <div
      className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:px-6 lg:pb-6"
      // While the keyboard is up it covers the bottom of this container,
      // so the text under it cannot be scrolled to and the note reads as
      // stuck. Padding by exactly what the keyboard took gives that text
      // somewhere to go — and gives the browser's own caret-scrolling room
      // to bring the line being typed above the keyboard.
      style={keyboardInset ? { paddingBottom: `${keyboardInset}px` } : undefined}
    >
      {/* Header AND palette pin together. Pinning only the palette left the
          title scrolling away above it, and the negative margins let the
          bar span the column's full width — inset by the page padding it
          read as narrower than the text it formats. */}
      <div className="border-line bg-app sticky top-0 z-30 -mx-4 flex shrink-0 flex-col gap-3 border-b px-4 pb-1.5 pt-4 lg:-mx-6 lg:px-6 lg:pt-6">
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
        <SaveBadge state={saveState} onRetry={() => editor && void save(docToMarkdown(editor.state.doc))} />
      </header>
      <EditorPalette editor={editor} editable={editable} />
      </div>

      <EditorContent editor={editor} className="min-h-0 flex-1" />
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
    if (res.ok) navigate('notes', encodeURIComponent(to));
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
    </>
  );
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'saved') {
    return (
      <span className="text-subtle flex shrink-0 items-center gap-1 text-xs">
        <Check className="size-3.5" /> {t('Saved')}
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="text-subtle flex shrink-0 items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> {t('Saving…')}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry} className="text-bad flex shrink-0 items-center gap-1 text-xs">
        <CircleAlert className="size-3.5" /> {t('Retry save')}
      </button>
    );
  }
  return (
    <span className="text-warn flex shrink-0 items-center gap-1 text-xs">
      <span className="bg-warn size-1.5 rounded-full" /> {t('Unsaved')}
    </span>
  );
}
