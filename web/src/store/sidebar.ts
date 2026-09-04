import { create } from 'zustand';

/**
 * Whether the sidebar is folded to its icon rail — a reading preference,
 * per device, kept the way the Games details column's pin is
 * (games/CollectionView, PIN_KEY): written on every toggle and never
 * removed for agreeing with the default, because the default moves with
 * the window and a choice erased for matching it would be undone by a
 * resize.
 *
 * A store rather than the sidebar's own state because two controls now
 * drive it: the switch in the sidebar's brand row, and the desktop
 * shell's title bar (components/title-bar), which stands outside the
 * sidebar and has to say the same thing.
 *
 * `choice` is null until somebody has pressed, and then the width
 * decides — the labelled column from lg, the icon rail below it, which
 * is what the rail always did before it could be asked. The caller
 * resolves it with `foldedFrom`.
 */
const FOLD_KEY = 'vault:sidebar-folded';

interface SidebarState {
  choice: boolean | null;
  setFolded: (folded: boolean) => void;
}

export const useSidebar = create<SidebarState>()((set) => ({
  choice: (() => {
    try {
      const stored = localStorage.getItem(FOLD_KEY);
      return stored === null ? null : stored === '1';
    } catch {
      return null;
    }
  })(),
  setFolded: (folded) => {
    set({ choice: folded });
    try {
      localStorage.setItem(FOLD_KEY, folded ? '1' : '0');
    } catch {
      /* the session still remembers; it just will not survive a reload */
    }
  },
}));

/** The rail's state for a window: the choice if there is one, else the width's. */
export const foldedFrom = (choice: boolean | null, lg: boolean): boolean => choice ?? !lg;
