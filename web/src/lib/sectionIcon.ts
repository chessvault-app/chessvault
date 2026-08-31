import { Folder, Library, NotebookPen } from 'lucide-react';
import type { LinkSection } from '@shared/wikiLinks';

/**
 * The icon each kind of document is known by.
 *
 * One table because there were two, and they disagreed. The sidebar has
 * always drawn games as a folder, studies as a library and notes as a
 * notebook; the unresolved-link dialog picked its own — crossed swords, an
 * open folder, a page — back when it only ever drew one of them at a time,
 * beside a name, where nothing invited a comparison. Offering all three
 * at once put them in a column, and a reader who navigates by the sidebar
 * every day was looking at three icons that named the same three places
 * differently.
 *
 * The sidebar's are the ones that win: they are what the app is navigated
 * by, and they were here first.
 */
export const SECTION_ICON: Record<LinkSection, typeof Folder> = {
  games: Folder,
  studies: Library,
  notes: NotebookPen,
};
