import { create } from 'zustand';
import { api, apiErrorMessage } from '@/lib/api';
import { emptyDoc, ensureMaps, type MapDoc } from './model';

/**
 * The opening map's document store: load once, edit in memory through the
 * model's pure operations, autosave the whole document.
 *
 * The save discipline is the study store's, for the study store's reason:
 * a slow PUT plus the next autosave behind it must never put two bodies
 * in flight at once, or the older document can land last and silently
 * revert the newest edits. And a load that failed on a DAMAGED file (the
 * server's 500) locks editing entirely — saving a fresh document over a
 * file that still has the user's data in it would finish what the damage
 * started.
 */

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface OpeningMapState {
  doc: MapDoc | null;
  loaded: boolean;
  /** Set when the vault's map file cannot be read; editing is locked. */
  loadError: string | null;
  saveState: SaveState;
  saveError: string | null;
  load: () => Promise<void>;
  /** Run a pure edit over the document; a changed result schedules a save. */
  apply: (edit: (doc: MapDoc) => MapDoc) => void;
  save: () => Promise<void>;
}

const AUTOSAVE_MS = 1500;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

export const useOpeningMap = create<OpeningMapState>()((set, get) => {
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().save(), AUTOSAVE_MS);
  };

  async function doSave(): Promise<void> {
    const { doc, saveState, loadError } = get();
    if (!doc || loadError || saveState === 'saved') return;
    set({ saveState: 'saving' });
    try {
      await api('/api/openingmap', { method: 'PUT', json: doc });
      // Saved only if no edit landed while the PUT was out.
      set((s) => ({
        saveState: s.saveState === 'saving' ? 'saved' : s.saveState,
        saveError: null,
      }));
    } catch (error) {
      set({ saveState: 'error', saveError: apiErrorMessage(error) });
    }
  }

  return {
    doc: null,
    loaded: false,
    loadError: null,
    saveState: 'saved',
    saveError: null,

    load: async () => {
      try {
        const doc = (await api<MapDoc>('/api/openingmap')) ?? emptyDoc();
        // The two standing maps are made on first visit; persisting them
        // right away keeps the file the single source of what exists.
        const ensured = ensureMaps(doc);
        set({ doc: ensured, loaded: true, loadError: null });
        if (ensured !== doc) {
          set({ saveState: 'dirty' });
          scheduleSave();
        }
      } catch (error) {
        set({ doc: null, loaded: true, loadError: apiErrorMessage(error) });
      }
    },

    apply: (edit) => {
      const { doc, loadError } = get();
      if (!doc || loadError) return;
      const next = edit(doc);
      if (next === doc) return;
      set({ doc: next, saveState: 'dirty' });
      scheduleSave();
    },

    save: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const turn = saveChain.then(() => doSave());
      saveChain = turn.catch(() => {});
      return turn;
    },
  };
});
