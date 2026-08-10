import { EditorContent, useEditor } from '@tiptap/react';
import {
  ChevronLeft,
  Check,
  CircleAlert,
  Loader2,
  Pencil,
  PlusSquare,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { SkeletonDocument, useSlowLoad } from '@/ui/Skeleton';
import { docToMarkdown, markdownToDoc, noteExtensions } from './markdown';

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
            All notes
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
  const editor = useEditor({
    extensions: noteExtensions,
    content: initialDoc,
    editable: false,
    editorProps: {
      attributes: { class: 'note-editor focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void save(docToMarkdown(editor.state.doc));
      }, AUTOSAVE_MS);
    },
  });

  const save = async (markdown: string): Promise<void> => {
    setSaveState('saving');
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
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto p-4 lg:p-6">
      <header className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title="All notes" onClick={() => navigate('notes')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <NoteTitle id={id} />
        <Button
          variant={editable ? 'primary' : 'secondary'}
          size="sm"
          title={editable ? 'Back to reading' : 'Edit this note'}
          onClick={() => setEditable((v) => !v)}
        >
          <Pencil className="mr-1 size-3.5" />
          {editable ? 'Done' : 'Edit'}
        </Button>
        {editable && (
        <Button
          variant="secondary"
          size="sm"
          title="Insert an interactive board at the cursor"
          onClick={() => editor?.chain().focus().insertChessBlock().run()}
        >
          <PlusSquare className="mr-1 size-3.5" />
          Board
        </Button>
        )}
        <SaveBadge state={saveState} onRetry={() => editor && void save(docToMarkdown(editor.state.doc))} />
      </header>

      <EditorContent editor={editor} className="min-h-0 flex-1" />
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
      setFailure(body?.error ?? 'could not rename');
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
        <Check className="size-3.5" /> Saved
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="text-subtle flex shrink-0 items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button type="button" onClick={onRetry} className="text-bad flex shrink-0 items-center gap-1 text-xs">
        <CircleAlert className="size-3.5" /> Retry save
      </button>
    );
  }
  return (
    <span className="text-warn flex shrink-0 items-center gap-1 text-xs">
      <span className="bg-warn size-1.5 rounded-full" /> Unsaved
    </span>
  );
}
