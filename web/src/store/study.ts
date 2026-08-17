import { create } from 'zustand';
import { chaptersToPgn, pgnToChapters } from '@shared/pgn';
import { createTree } from '@shared/tree';
import type { Chapter } from '@shared/types';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { useAnalysis } from './analysis';
import { usePrefs } from './prefs';
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
   * The document exactly as the vault last had it, as PGN.
   *
   * Kept so "discard" is a re-parse of known-good text rather than a
   * refetch: the codec is proved lossless AND idempotent
   * (shared/pgn.test.ts), and this string is itself chaptersToPgn output,
   * so restoring runs the direction that is proved. A refetch would be a
   * round trip that can fail, for no extra fidelity.
   */
  savedPgn: string;
  /**
   * A pending copy found in the vault when this document was opened.
   *
   * Set only when the vault held a swap file that differs from the saved
   * document — work from a session that ended without saving. It is a
   * QUESTION, not a state: the view offers it, and answering either way
   * clears it. Null the rest of the time, which is almost always.
   */
  recovery: { pgn: string; at: string } | null;
  /** Take the parked copy: it becomes the pending buffer. */
  recover: () => void;
  /** Leave it: the swap is deleted and the saved document stands. */
  dismissRecovery: () => Promise<void>;
  /** Park the pending copy in the vault, against a crash. */
  park: () => Promise<void>;
  /** Drop whatever is parked — the pending copy is resolved. */
  dropPark: () => void;
  /**
   * Reading, or annotating.
   *
   * A TOOLS toggle, and nothing more: it shows and hides the NAG palette,
   * the comment boxes and the move surgery. It is not a write guard, and
   * the save no longer consults it.
   *
   * It used to be both, and the second job is what made it awkward. The
   * autosave lived here and had to know, because reading a study must not
   * rewrite it — so reading also locked the board, and pushing a piece
   * around a position meant first declaring you meant to edit it. Nothing
   * writes unasked now, so the guard has nothing left to guard and the
   * board is live either way.
   *
   * Still in the store rather than in StudyView because the panes that
   * read it are scattered, and because a document that opens is a
   * document that opens reading (see `open`).
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
   * Rename the OPEN document (study or collection game) in place, keeping
   * its collection. Waits for any save already in flight, so the move never
   * races it, but does not force one — pending changes belong to the reader.
   * Returns the new id on success (caller updates the URL), or an error.
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
  /** Throw the pending changes away and go back to what the vault has. */
  discard: () => void;
}

/**
 * While a study is open, the *current chapter's* tree lives in the analysis
 * store — the board, move tree, engine and explorer all already speak that
 * store, so a study chapter gets the whole editing UX for free. This module
 * watches the analysis tree and mirrors it back into `chapters[chapterIndex]`,
 * marking the document pending — and writing it to the vault only when
 * asked, or on a debounce for anyone who has turned autosave on.
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

/**
 * Arm the autosave, if this device asked for one.
 *
 * Callers mark the document dirty either way — the badge and the leave
 * question are about the buffer, not about whether a timer is running.
 * Without the preference, dirty is where it stays until someone presses
 * Save. Module-level because the tree subscriber at the bottom of the
 * file needs it too, and it lives outside the store's closure.
 */
function scheduleAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!usePrefs.getState().autosave) {
    // Nothing is going to be written, so the pending copy is the only
    // record of this work outside the tab. Park it.
    schedulePark();
    return;
  }
  saveTimer = setTimeout(() => void useStudy.getState().save(), AUTOSAVE_MS);
}

/**
 * How long after the last edit the pending copy is parked in the vault.
 *
 * Longer than the autosave debounce on purpose. This is a crash net, not
 * a save: nobody is waiting for it, and a full document body per 1.5s of
 * typing is a lot of writing for something that is thrown away the moment
 * Save is pressed.
 */
const PARK_MS = 4000;
let parkTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPark(): void {
  if (parkTimer) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }
}

function schedulePark(): void {
  cancelPark();
  parkTimer = setTimeout(() => {
    parkTimer = null;
    void useStudy.getState().park();
  }, PARK_MS);
}

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



  return {
    studies: [],
    folders: [],
    listLoaded: false,
    openId: null,
    openBase: 'studies',
    chapters: [],
    chapterIndex: 0,
    saveState: 'saved',
    savedPgn: '',
    recovery: null,
    editing: false,
    setEditing: (editing) => set({ editing }),
    error: null,

    refresh: async () => {
      try {
        const body = await api<{ studies: StudyMeta[]; folders?: string[] }>('/api/studies');
        set({ studies: body.studies, folders: body.folders ?? [], listLoaded: true, error: null });
      } catch {
        set({ listLoaded: true, error: 'vault server unreachable' });
      }
    },

    createFolder: async (name) => {
      // The refresh runs whether the write landed or not — a failure may
      // still have changed the list (or proved it stale), and the returned
      // string is the caller's to show.
      let failure: string | null = null;
      try {
        await api('/api/studies/folders', { method: 'POST', json: { name } });
      } catch (e) {
        failure = apiErrorMessage(e);
      }
      await get().refresh();
      return failure;
    },

    move: async (from, to) => {
      let failure: string | null = null;
      try {
        await api('/api/studies/move', { method: 'POST', json: { from, to } });
      } catch (e) {
        failure = apiErrorMessage(e);
      }
      await get().refresh();
      return failure;
    },

    renameOpen: async (newName) => {
      const { openId, openBase } = get();
      const trimmed = newName.trim();
      if (!openId) return { error: 'nothing is open' };
      if (!trimmed) return { error: 'name cannot be empty' };
      const folder = openId.includes('/') ? openId.slice(0, openId.lastIndexOf('/')) : '';
      const to = folder ? `${folder}/${trimmed}` : trimmed;
      if (to === openId) return { id: openId };

      // Wait for any PUT already out to land on the OLD path, rather than
      // forcing a save of our own: renaming moves the FILE, and the buffer
      // is untouched by it. Saving first would write pending changes the
      // reader has not committed, on the way to doing something else
      // entirely.
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await saveChain;
      try {
        await api(`/api/${openBase}/move`, { method: 'POST', json: { from: openId, to } });
      } catch (e) {
        return { error: apiErrorMessage(e) };
      }
      // The buffer follows the file: doSave builds its URL from openId
      // alone, so the pending changes now belong to the new name.
      set({ openId: to });
      // Re-arm what was disarmed above, or a rename would quietly turn
      // autosave off for the rest of the visit.
      if (get().saveState !== 'saved') scheduleAutosave();
      return { id: to };
    },

    moveFolder: async (from, to) => {
      let failure: string | null = null;
      try {
        await api('/api/studies/folders/move', { method: 'POST', json: { from, to } });
      } catch (e) {
        failure = apiErrorMessage(e);
      }
      await get().refresh();
      return failure;
    },

    removeFolder: async (name) => {
      let failure: string | null = null;
      try {
        await api(`/api/studies/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
      } catch (e) {
        failure = apiErrorMessage(e);
      }
      await get().refresh();
      return failure;
    },

    create: async (name, pgn) => {
      try {
        await api('/api/studies', { method: 'POST', json: { name, ...(pgn && { pgn }) } });
      } catch (e) {
        return apiErrorMessage(e);
      }
      await get().refresh();
      return null;
    },

    remove: async (id) => {
      let failure: string | null = null;
      try {
        await api(`/api/studies/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (e) {
        failure = apiErrorMessage(e);
      }
      await get().refresh();
      return failure;
    },

    open: async (id, base = 'studies') => {
      try {
        const body = await api<{ pgn: string; draft?: string; draftAt?: string }>(
          `/api/${base}/${encodeURIComponent(id)}`,
        );
        const chapters = pgnToChapters(body.pgn);
        if (chapters.length === 0) {
          chapters.push({
            id: 'ch-fallback',
            name: 'Chapter 1',
            tree: createTree(),
            headers: { Event: `${id}: Chapter 1`, ChapterName: 'Chapter 1', Result: '*' },
          });
        }
        // A swap file the vault was still holding: work from a session
        // that ended without saving. The document opens SAVED and shows
        // what is on disk — the recovery is offered, never applied behind
        // the reader's back, because taking it silently would be the same
        // unasked-for write this whole change is about.
        const recovery =
          body.draft && body.draftAt ? { pgn: body.draft, at: body.draftAt } : null;
        cancelPark();
        // Re-serialised rather than kept as the fetched body: a file whose
        // chapters did not parse gets the fallback chapter above, and the
        // baseline has to be what is actually in memory or discarding
        // would restore a document the reader never saw.
        set({
          openId: id,
          openBase: base,
          chapters,
          chapterIndex: 0,
          saveState: 'saved',
          savedPgn: chaptersToPgn(chapters),
          recovery,
          error: null,
          editing: false,
        });
        loadIntoAnalysis(chapters[0]!);
        return true;
      } catch (e) {
        // A server that ANSWERED with an error is a document that would
        // not open (deleted, renamed); anything else is the server away.
        set({
          error:
            e instanceof ApiError && e.status !== 0
              ? `could not open “${id}”`
              : 'vault server unreachable',
        });
        return false;
      }
    },

    close: async () => {
      // Idempotent: the view's unmount cleanup calls this even when the
      // study was already detached (e.g. the explorer handed a game to the
      // analysis tab) — a second run must not wipe the handed-off tree.
      if (!get().openId) return;
      // No save here any more. Closing is the tail of a departure the leave
      // guard has already put a question to, so by the time this runs the
      // answer is in and the document is clean — saved, or discarded on
      // purpose. Writing again would be writing changes the reader has
      // just declined, which is exactly what this change is about.
      // The timer still has to go, or an armed autosave fires at a
      // document that is no longer open.
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // A park still on the clock would fire at a document nobody has
      // open and leave a swap nobody asked for. The leave guard has
      // already resolved the buffer either way.
      cancelPark();
      set({
        openId: null,
        chapters: [],
        chapterIndex: 0,
        saveState: 'saved',
        savedPgn: '',
        recovery: null,
        editing: false,
      });
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
      scheduleAutosave();
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
      scheduleAutosave();
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
      scheduleAutosave();
    },

    park: async () => {
      const { openId, openBase, saveState } = get();
      // Only pending work is worth parking, and only while it is still
      // pending — a save that landed between the timer and here has
      // already dropped the swap server-side.
      if (!openId || saveState === 'saved') return;
      const pgn = chaptersToPgn(stashCurrent());
      try {
        await api(`/api/${openBase}/${encodeURIComponent(openId)}?draft=1`, {
          method: 'PUT',
          json: { pgn },
        });
      } catch {
        // A crash net that cannot reach the server is simply not there.
        // The badge already says the work is unsaved; saying it twice in
        // a different colour would not help anyone.
      }
    },

    /** Drop whatever is parked. Fire-and-forget: a swap left behind is a
        stale question, not lost data — and the next open discards one that
        matches its file anyway. */
    dropPark: () => {
      const { openId, openBase } = get();
      cancelPark();
      if (!openId) return;
      void api(`/api/${openBase}/${encodeURIComponent(openId)}?draft=1`, {
        method: 'DELETE',
      }).catch(() => {});
    },

    recover: () => {
      const { recovery, chapterIndex } = get();
      if (!recovery) return;
      const chapters = pgnToChapters(recovery.pgn);
      if (chapters.length === 0) {
        set({ recovery: null });
        return;
      }
      const index = Math.min(chapterIndex, chapters.length - 1);
      // Recovered work arrives PENDING, not saved: it never reached the
      // document, and pressing Save is still what puts it there. savedPgn
      // is untouched, so discarding still goes back to the vault's copy.
      set({ chapters, chapterIndex: index, saveState: 'dirty', recovery: null });
      loadIntoAnalysis(chapters[index]!);
    },

    dismissRecovery: async () => {
      const { openId, openBase } = get();
      set({ recovery: null });
      if (!openId) return;
      // Deleted rather than left to rot: an unanswered question that keeps
      // being asked is worse than no question.
      try {
        await api(`/api/${openBase}/${encodeURIComponent(openId)}?draft=1`, { method: 'DELETE' });
      } catch {
        /* it will be offered again, or dropped on the next save */
      }
    },

    discard: () => {
      const { openId, savedPgn, chapterIndex } = get();
      if (!openId) return;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      get().dropPark();
      const chapters = pgnToChapters(savedPgn);
      if (chapters.length === 0) return;
      // Chapter ids are re-minted by the parse, so the analysis cursor
      // cannot survive: a discard lands at the chapter's start, which is
      // honest — the moves it was pointing at are the ones just thrown
      // away. Selecting a chapter already behaves this way.
      const index = Math.min(chapterIndex, chapters.length - 1);
      set({ chapters, chapterIndex: index, saveState: 'saved', error: null });
      loadIntoAnalysis(chapters[index]!);
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
    const pgn = chaptersToPgn(chapters);
    // The server drops the swap when this PUT lands; cancel the timer so a
    // park cannot fire afterwards and re-park work that is now on disk.
    cancelPark();
    set({ chapters, saveState: 'saving' });
    try {
      await api(`/api/${openBase}/${encodeURIComponent(openId)}`, {
        method: 'PUT',
        json: { pgn },
      });
      // Annotating a collected game changes what its row says about it
      // (its comments, its glyphs, its variations), so the cached
      // collection list is stale the moment the save lands.
      if (openBase === 'games/docs') forgetCollection();
      // Edits made while the request was in flight stay dirty. The
      // baseline is what LANDED, not what is on screen — discarding after
      // one of those in-flight edits must go back to the written file.
      set((s) => ({
        saveState: s.saveState === 'saving' ? 'saved' : s.saveState,
        savedPgn: pgn,
        error: null,
      }));
    } catch (e) {
      // The server refusing is worth its own words; the server being away
      // must also say the changes are still only here.
      set({
        saveState: 'error',
        error:
          e instanceof ApiError && e.status !== 0
            ? e.message
            : 'vault server unreachable — changes not saved',
      });
    }
  }
});

/**
 * Any change to the tree while a document is open makes it pending.
 *
 * There is no longer a reading exception. There used to be one, and it
 * had to exist: the save wrote itself, so following an engine line while
 * reading would have written that line into the file. It was paid for by
 * a locked board — you could not push a piece around a position without
 * first declaring you meant to edit it — and by the changes it discarded
 * in silence. Nothing writes without being asked now, so a move made
 * while reading is simply a change you have not saved, exactly like a
 * move made while editing. One buffer, one badge, one question on the
 * way out.
 *
 * The FLIP is deliberately not in here any more. Orientation is still
 * part of the chapter and still rides along with the next save (see
 * stashCurrent), but turning the board round to read from the other side
 * must not raise "Unsaved" and must not summon a question on the way out.
 * That was free when the save was silent; under a manual save it is a
 * modal for a gesture people make constantly while reading, and a prompt
 * that cries wolf is a prompt that gets dismissed unread. The cost, said
 * plainly: a visit whose only change was a flip leaves without offering
 * to keep it.
 *
 * Chapter loads set `loadingChapter`, so swapping chapters is never an edit.
 */
useAnalysis.subscribe((state, prev) => {
  if (state.tree === prev.tree || loadingChapter) return;
  if (!useStudy.getState().openId) return;
  useStudy.setState({ saveState: 'dirty' });
  scheduleAutosave();
});
