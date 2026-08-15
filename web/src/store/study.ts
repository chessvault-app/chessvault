import { create } from 'zustand';
import { chaptersToPgn, pgnToChapters } from '@shared/pgn';
import { createTree } from '@shared/tree';
import type { Chapter } from '@shared/types';
import { useAnalysis } from './analysis';
import { forgetCollection } from '@/games/collection';
// Type-only, so nothing of the component reaches this module at runtime —
// the union simply lives beside the badge that renders it.
import type { SaveState } from '@/ui/SaveControl';

export interface StudyMeta {
  id: string;
  chapters: number;
  bytes: number;
  updatedAt: string;
  /** Where the first chapter's mainline ends — the card's thumbnail. */
  fen?: string | null;
  /** The first few chapters' names — the card's caption. */
  chapterNames?: string[];
}


/**
 * Which document API the open document belongs to: real studies, or the games
 * collection (same server contract, different directory).
 */
export type DocBase = 'studies' | 'games/docs';

interface StudyState {
  studies: StudyMeta[];
  folders: string[];
  listLoaded: boolean;

  /** The open study, or null on the list screen. */
  openId: string | null;
  openBase: DocBase;
  chapters: Chapter[];
  chapterIndex: number;
  saveState: SaveState;
  /**
   * Reading, or annotating.
   *
   * In the STORE rather than in StudyView, because the autosave lives
   * here and has to know: reading a study must not rewrite it. The board
   * is already locked while reading, but the engine's lines and the
   * explorer's moves are played through the analysis store, which the
   * autosave watched without ever asking whether the reader had asked to
   * edit anything. Following an engine line to see where it went wrote
   * that line into the file.
   */
  editing: boolean;
  setEditing: (editing: boolean) => void;
  error: string | null;

  refresh: () => Promise<void>;
  create: (name: string, pgn?: string) => Promise<string | null>;
  createFolder: (name: string) => Promise<string | null>;
  /** Rename and move are one operation — the id is the path. */
  move: (from: string, to: string) => Promise<string | null>;
  /**
   * Rename the OPEN document (study or collection game) in place, keeping its
   * collection. Saves first, so the move never races the autosave. Returns
   * the new id on success (caller updates the URL), or an error message.
   */
  renameOpen: (newName: string) => Promise<{ id?: string; error?: string }>;
  moveFolder: (from: string, to: string) => Promise<string | null>;
  removeFolder: (name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  open: (id: string, base?: DocBase) => Promise<boolean>;
  close: () => Promise<void>;
  selectChapter: (index: number) => void;
  /** Append a chapter, optionally inside a sub-chapter group ("Group/Name"). */
  addChapter: (group?: string) => void;
  renameChapter: (index: number, name: string) => void;
  deleteChapter: (index: number) => void;
  save: () => Promise<void>;
}

/**
 * While a study is open, the *current chapter's* tree lives in the analysis
 * store — the board, move tree, engine and explorer all already speak that
 * store, so a study chapter gets the whole editing UX for free. This module
 * watches the analysis tree and mirrors it back into `chapters[chapterIndex]`,
 * with a debounced autosave to the vault.
 *
 * The engine never writes into the tree (nothing calls `setEval` from search
 * results), which is exactly the study requirement: analysis must not modify
 * the note. Only user actions — moves, comments, shapes, NAGs — mark it dirty.
 */

/** True while a chapter is being loaded into the analysis store. */
let loadingChapter = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_MS = 1500;
/**
 * Saves are serialised on this chain. A slow PUT plus the next autosave
 * 1.5 s behind it used to put two full-document bodies in flight at
 * once, and if they reordered across connections the OLDER document
 * landed last — silently reverting the newest edits on disk.
 */
let saveChain: Promise<void> = Promise.resolve();

const asSide = (value: string | undefined): 'white' | 'black' | null =>
  value === 'white' || value === 'black' ? value : null;

function loadIntoAnalysis(chapter: Chapter): void {
  loadingChapter = true;
  // Chapters made from imported games carry players — show their name plates.
  const hasPlayers =
    (chapter.headers['White'] ?? '?') !== '?' || (chapter.headers['Black'] ?? '?') !== '?';
  // Board side: an explicitly saved flip wins, then the side the vault owner
  // played (collected games), and a fresh study starts white-side-down.
  const orientation =
    asSide(chapter.headers['Orientation']) ?? asSide(chapter.headers['VaultSide']) ?? 'white';
  useAnalysis.setState({
    tree: chapter.tree,
    cursorId: chapter.tree.rootId,
    pendingPromotion: null,
    loadError: null,
    gameHeaders: hasPlayers ? chapter.headers : null,
    orientation,
  });
  loadingChapter = false;
}

export const useStudy = create<StudyState>()((set, get) => {
  /** Pull the live tree (and board side) out of the analysis store. */
  const stashCurrent = (): Chapter[] => {
    const { openId, chapters, chapterIndex } = get();
    if (!openId) return chapters;
    const { tree: live, orientation } = useAnalysis.getState();
    return chapters.map((c, i) => {
      if (i !== chapterIndex) return c;
      // The flip is part of the chapter: persisted as an Orientation header,
      // written only when it differs from the load-time default.
      const headers = { ...c.headers };
      const defaultSide = asSide(headers['VaultSide']) ?? 'white';
      if (orientation !== defaultSide) headers['Orientation'] = orientation;
      else delete headers['Orientation'];
      return { ...c, tree: live, headers };
    });
  };

  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().save(), AUTOSAVE_MS);
  };

  return {
    studies: [],
    folders: [],
    listLoaded: false,
    openId: null,
    openBase: 'studies',
    chapters: [],
    chapterIndex: 0,
    saveState: 'saved',
    editing: false,
    setEditing: (editing) => set({ editing }),
    error: null,

    refresh: async () => {
      try {
        const res = await fetch('/api/studies');
        const body = (await res.json()) as { studies: StudyMeta[]; folders?: string[] };
        set({ studies: body.studies, folders: body.folders ?? [], listLoaded: true, error: null });
      } catch {
        set({ listLoaded: true, error: 'vault server unreachable' });
      }
    },

    createFolder: async (name) => {
      const res = await fetch('/api/studies/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not create the collection');
    },

    move: async (from, to) => {
      const res = await fetch('/api/studies/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not move the study');
    },

    renameOpen: async (newName) => {
      const { openId, openBase } = get();
      const trimmed = newName.trim();
      if (!openId) return { error: 'nothing is open' };
      if (!trimmed) return { error: 'name cannot be empty' };
      const folder = openId.includes('/') ? openId.slice(0, openId.lastIndexOf('/')) : '';
      const to = folder ? `${folder}/${trimmed}` : trimmed;
      if (to === openId) return { id: openId };

      if (saveTimer) clearTimeout(saveTimer);
      await get().save();
      const res = await fetch(`/api/${openBase}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: openId, to }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) return { error: body?.error ?? 'could not rename' };
      set({ openId: to });
      return { id: to };
    },

    moveFolder: async (from, to) => {
      const res = await fetch('/api/studies/folders/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not rename the collection');
    },

    removeFolder: async (name) => {
      const res = await fetch(`/api/studies/folders/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not delete the collection');
    },

    create: async (name, pgn) => {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(pgn && { pgn }) }),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) return body?.error ?? 'could not create study';
      await get().refresh();
      return null;
    },

    remove: async (id) => {
      const res = await fetch(`/api/studies/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'delete failed');
    },

    open: async (id, base = 'studies') => {
      try {
        const res = await fetch(`/api/${base}/${encodeURIComponent(id)}`);
        if (!res.ok) {
          set({ error: `could not open “${id}”` });
          return false;
        }
        const body = (await res.json()) as { pgn: string };
        const chapters = pgnToChapters(body.pgn);
        if (chapters.length === 0) {
          chapters.push({
            id: 'ch-fallback',
            name: 'Chapter 1',
            tree: createTree(),
            headers: { Event: `${id}: Chapter 1`, ChapterName: 'Chapter 1', Result: '*' },
          });
        }
        set({ openId: id, openBase: base, chapters, chapterIndex: 0, saveState: 'saved', error: null, editing: false });
        loadIntoAnalysis(chapters[0]!);
        return true;
      } catch {
        set({ error: 'vault server unreachable' });
        return false;
      }
    },

    close: async () => {
      // Idempotent: the view's unmount cleanup calls this even when the
      // study was already detached (e.g. the explorer handed a game to the
      // analysis tab) — a second run must not wipe the handed-off tree.
      if (!get().openId) return;
      if (saveTimer) clearTimeout(saveTimer);
      if (get().saveState !== 'saved') await get().save();
      set({ openId: null, chapters: [], chapterIndex: 0, saveState: 'saved', editing: false });
      useAnalysis.getState().reset();
    },

    selectChapter: (index) => {
      const chapters = stashCurrent();
      const target = chapters[index];
      if (!target) return;
      set({ chapters, chapterIndex: index });
      loadIntoAnalysis(target);
    },

    addChapter: (group) => {
      const { openId } = get();
      const chapters = stashCurrent();
      // The name IS the identity for grouping and sub-chapter promotion, so
      // it must be unique. Counting alone collides after deletions (create
      // 3, delete 2, create -> a second "Chapter 3"); probe upward instead.
      const taken = new Set(chapters.map((c) => c.name));
      const inGroup = group
        ? chapters.filter((c) => c.name.startsWith(`${group}/`)).length
        : chapters.length;
      let n = inGroup + 1;
      const nameFor = (i: number): string => (group ? `${group}/Chapter ${i}` : `Chapter ${i}`);
      while (taken.has(nameFor(n))) n++;
      const name = nameFor(n);
      const fresh: Chapter = {
        id: `ch-new-${Date.now().toString(36)}`,
        name,
        tree: createTree(),
        headers: { Event: `${openId}: ${name}`, ChapterName: name, Result: '*' },
      };
      set({ chapters: [...chapters, fresh], chapterIndex: chapters.length, saveState: 'dirty' });
      loadIntoAnalysis(fresh);
      scheduleSave();
    },

    renameChapter: (index, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const { openId } = get();
      const stashed = stashCurrent();
      const oldName = stashed[index]?.name ?? '';
      // Duplicate names break grouping and delete-promotion — refuse.
      if (stashed.some((c, i) => i !== index && c.name === trimmed)) return;
      const withName = (c: Chapter, next: string): Chapter => ({
        ...c,
        name: next,
        headers: { ...c.headers, ChapterName: next, Event: `${openId}: ${next}` },
      });
      const chapters = stashed.map((c, i) => {
        if (i === index) return withName(c, trimmed);
        // Sub-chapters follow their parent's new name.
        if (!oldName.includes('/') && c.name.startsWith(`${oldName}/`)) {
          return withName(c, `${trimmed}/${c.name.slice(oldName.length + 1)}`);
        }
        return c;
      });
      set({ chapters, saveState: 'dirty' });
      scheduleSave();
    },

    deleteChapter: (index) => {
      const { chapterIndex, openId } = get();
      const chapters = stashCurrent();
      if (chapters.length <= 1) return; // a study always has at least one chapter
      const target = chapters[index]!;
      let next = chapters.filter((_, i) => i !== index);
      // Deleting a parent promotes its sub-chapters to top level rather
      // than orphaning or destroying them.
      if (!target.name.includes('/')) {
        next = next.map((c) => {
          if (!c.name.startsWith(`${target.name}/`)) return c;
          const promoted = c.name.slice(target.name.length + 1);
          return {
            ...c,
            name: promoted,
            headers: { ...c.headers, ChapterName: promoted, Event: `${openId}: ${promoted}` },
          };
        });
      }
      const nextIndex = Math.min(chapterIndex > index ? chapterIndex - 1 : chapterIndex, next.length - 1);
      set({ chapters: next, chapterIndex: nextIndex, saveState: 'dirty' });
      loadIntoAnalysis(next[nextIndex]!);
      scheduleSave();
    },

    save: async () => {
      // Queue behind any PUT still in flight — see saveChain above. The
      // document is snapshotted when the turn comes, not when the save
      // was requested, so a queued save always writes the newest state.
      const turn = saveChain.then(() => doSave());
      saveChain = turn.catch(() => {});
      return turn;
    },
  };

  async function doSave(): Promise<void> {
    const { openId, openBase } = get();
    if (!openId) return;
    const chapters = stashCurrent();
    set({ chapters, saveState: 'saving' });
    try {
      const res = await fetch(`/api/${openBase}/${encodeURIComponent(openId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pgn: chaptersToPgn(chapters) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        set({ saveState: 'error', error: body?.error ?? `save failed (${res.status})` });
        return;
      }
      // Annotating a collected game changes what its row says about it
      // (its comments, its glyphs, its variations), so the cached
      // collection list is stale the moment the save lands.
      if (openBase === 'games/docs') forgetCollection();
      // Edits made while the request was in flight stay dirty.
      set((s) => ({ saveState: s.saveState === 'saving' ? 'saved' : s.saveState, error: null }));
    } catch {
      set({ saveState: 'error', error: 'vault server unreachable — changes not saved' });
    }
  }
});

// Any tree change — or a board flip, which is saved as part of the chapter —
// while a study is open marks it dirty and schedules an autosave. Chapter
// loads set `loadingChapter` so swapping chapters never counts as an edit.
useAnalysis.subscribe((state, prev) => {
  const treeChanged = state.tree !== prev.tree;
  const flipped = state.orientation !== prev.orientation;
  if ((!treeChanged && !flipped) || loadingChapter) return;
  const study = useStudy.getState();
  if (!study.openId) return;
  /**
   * Reading must not rewrite what is being read.
   *
   * The board refuses moves while reading, so this only ever fires for
   * the two controls that reach the tree another way — an engine line
   * and an explorer move. Following one is a useful thing to do while
   * reading; it just belongs in memory, not in the vault. The change
   * stays on screen and is gone on the next open, which is what "not
   * saved" should look like.
   *
   * The flip is not gated with it: which way the board faces is saved
   * with the chapter, and turning it round to read from the other side
   * is a reading act that should stick.
   */
  if (treeChanged && !study.editing) return;
  useStudy.setState({ saveState: 'dirty' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void useStudy.getState().save(), AUTOSAVE_MS);
});
