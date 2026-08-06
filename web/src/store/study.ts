import { create } from 'zustand';
import { chaptersToPgn, pgnToChapters } from '@shared/pgn';
import { createTree } from '@shared/tree';
import type { Chapter } from '@shared/types';
import { useAnalysis } from './analysis';

export interface StudyMeta {
  id: string;
  chapters: number;
  bytes: number;
  updatedAt: string;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

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
  error: string | null;

  refresh: () => Promise<void>;
  create: (name: string) => Promise<string | null>;
  createFolder: (name: string) => Promise<string | null>;
  /** Rename and move are one operation — the id is the path. */
  move: (from: string, to: string) => Promise<string | null>;
  moveFolder: (from: string, to: string) => Promise<string | null>;
  removeFolder: (name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  open: (id: string, base?: DocBase) => Promise<boolean>;
  close: () => Promise<void>;
  selectChapter: (index: number) => void;
  addChapter: () => void;
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

function loadIntoAnalysis(chapter: Chapter): void {
  loadingChapter = true;
  // Chapters made from imported games carry players — show their name plates.
  const hasPlayers =
    (chapter.headers['White'] ?? '?') !== '?' || (chapter.headers['Black'] ?? '?') !== '?';
  // Collected games record which side the vault owner played.
  const side = chapter.headers['VaultSide'];
  useAnalysis.setState({
    tree: chapter.tree,
    cursorId: chapter.tree.rootId,
    pendingPromotion: null,
    loadError: null,
    gameHeaders: hasPlayers ? chapter.headers : null,
    ...(side === 'white' || side === 'black' ? { orientation: side } : {}),
  });
  loadingChapter = false;
}

export const useStudy = create<StudyState>()((set, get) => {
  /** Pull the live tree out of the analysis store into the chapter list. */
  const stashCurrent = (): Chapter[] => {
    const { openId, chapters, chapterIndex } = get();
    if (!openId) return chapters;
    const live = useAnalysis.getState().tree;
    return chapters.map((c, i) => (i === chapterIndex ? { ...c, tree: live } : c));
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
      return res.ok ? null : (body?.error ?? 'could not create folder');
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

    moveFolder: async (from, to) => {
      const res = await fetch('/api/studies/folders/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, to }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not rename the folder');
    },

    removeFolder: async (name) => {
      const res = await fetch(`/api/studies/folders/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      await get().refresh();
      return res.ok ? null : (body?.error ?? 'could not delete the folder');
    },

    create: async (name) => {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
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
        set({ openId: id, openBase: base, chapters, chapterIndex: 0, saveState: 'saved', error: null });
        loadIntoAnalysis(chapters[0]!);
        return true;
      } catch {
        set({ error: 'vault server unreachable' });
        return false;
      }
    },

    close: async () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (get().saveState !== 'saved') await get().save();
      set({ openId: null, chapters: [], chapterIndex: 0, saveState: 'saved' });
      useAnalysis.getState().reset();
    },

    selectChapter: (index) => {
      const chapters = stashCurrent();
      const target = chapters[index];
      if (!target) return;
      set({ chapters, chapterIndex: index });
      loadIntoAnalysis(target);
    },

    addChapter: () => {
      const { openId } = get();
      const chapters = stashCurrent();
      const name = `Chapter ${chapters.length + 1}`;
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
      const chapters = stashCurrent().map((c, i) =>
        i === index
          ? {
              ...c,
              name: trimmed,
              headers: { ...c.headers, ChapterName: trimmed, Event: `${openId}: ${trimmed}` },
            }
          : c,
      );
      set({ chapters, saveState: 'dirty' });
      scheduleSave();
    },

    deleteChapter: (index) => {
      const { chapterIndex } = get();
      const chapters = stashCurrent();
      if (chapters.length <= 1) return; // a study always has at least one chapter
      const next = chapters.filter((_, i) => i !== index);
      const nextIndex = Math.min(chapterIndex > index ? chapterIndex - 1 : chapterIndex, next.length - 1);
      set({ chapters: next, chapterIndex: nextIndex, saveState: 'dirty' });
      loadIntoAnalysis(next[nextIndex]!);
      scheduleSave();
    },

    save: async () => {
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
        // Edits made while the request was in flight stay dirty.
        set((s) => ({ saveState: s.saveState === 'saving' ? 'saved' : s.saveState, error: null }));
      } catch {
        set({ saveState: 'error', error: 'vault server unreachable — changes not saved' });
      }
    },
  };
});

// Any tree change in the analysis store while a study is open marks it dirty
// and schedules an autosave. Chapter loads set `loadingChapter` so swapping
// chapters never counts as an edit.
useAnalysis.subscribe((state, prev) => {
  if (state.tree === prev.tree || loadingChapter) return;
  const study = useStudy.getState();
  if (!study.openId) return;
  useStudy.setState({ saveState: 'dirty' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void useStudy.getState().save(), AUTOSAVE_MS);
});
