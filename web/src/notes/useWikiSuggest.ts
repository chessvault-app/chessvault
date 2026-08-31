import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { allTargets } from './wikiDocs';
import {
  PENDING_LINK,
  SUGGEST_LIMIT,
  createSuggestStore,
  type SuggestStore,
} from './suggestStore';

/**
 * The `[[` list, driven from a plain textarea.
 *
 * A move comment is one string on one move, not a document, so the notes
 * editor is not what is behind this box — and deliberately so. The comment
 * box grows from two rows to eight as it is typed into, re-fits when its
 * column is dragged, flushes on blur, and becomes a sheet on a phone
 * because the keyboard lands exactly where it sits. Putting ProseMirror
 * under it to gain a popup would mean redoing all of that, and running the
 * comment through a document conversion on every keystroke of a field that
 * autosaves into a PGN — a lossy round trip in front of the one thing a
 * game file cannot afford to get wrong.
 *
 * So the store is reused and the editor is not. Everything the list needs
 * turns out to be four questions, and a textarea answers all of them more
 * simply than a document does: what is behind the caret (`value` up to
 * `selectionStart`), where to put the list, how to replace a range, and
 * which keys to take first.
 */
export function useWikiSuggest({
  box,
  value,
  onChange,
}: {
  box: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Hand back the whole new value; the caret is restored here. */
  onChange: (next: string) => void;
}): {
  store: SuggestStore;
  /** Call whenever the text or the caret may have moved. */
  sync: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
} {
  const store = useMemo(createSuggestStore, []);
  // Held in a ref rather than closed over: `sync` is handed to a change
  // handler and to a selection listener, and a version of it that changed
  // identity on every keystroke would re-bind the listener on every one.
  const notify = useRef(onChange);
  notify.current = onChange;
  /** Where to put the caret once React has rendered the new value. */
  const caretAfter = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const at = caretAfter.current;
    if (!el || at === null) return;
    caretAfter.current = null;
    el.setSelectionRange(at, at);
    // Picking with the mouse never took focus away — the press is
    // preventDefault'd — but picking with Enter can leave it here while
    // the browser settles, and a comment box that has lost the caret
    // after completing a link is a box the next word does not land in.
    el.focus();
  }, [value, box]);

  const sync = useCallback(() => {
    const el = box.current;
    if (!el) return store.close();
    // A selection, not a caret: there is no single point to insert at, and
    // the same rule the editor applies (`selection.empty`).
    if (el.selectionStart !== el.selectionEnd) return store.close();
    const caret = el.selectionStart;
    // The ELEMENT's text, not the `value` prop. This runs from a change
    // handler, which is before React has re-rendered with what was just
    // typed, so the prop is one render behind — measured as an empty
    // string while the box already read "See [[Naj". The DOM node is what
    // is true at the moment the event fires.
    const text = el.value;
    const match = PENDING_LINK.exec(text.slice(0, caret));
    if (!match) return store.close();
    const query = match[1]!.toLowerCase();
    const from = caret - match[1]!.length;
    const rect = el.getBoundingClientRect();
    store.arm(
      (start, end, insert) => {
        const now = box.current?.value ?? text;
        notify.current(now.slice(0, start) + insert + now.slice(end));
        caretAfter.current = start + insert.length;
      },
      { from, to: caret },
      query,
      // The whole box, opening upward. See `SuggestAnchor` for why this is
      // not the caret: the box sits at the foot of its panel, and finding a
      // caret inside a textarea means measuring a mirror of it.
      { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, side: 'top' },
    );
    void allTargets().then((all) => {
      // The count is of everything that matched, not of what is shown: a
      // list silently cut at eight looks like the whole answer, so a writer
      // whose document is ninth concludes it is not there and stops typing.
      const hits = all.filter((id) => id.toLowerCase().includes(query));
      store.offer(query, hits.slice(0, SUGGEST_LIMIT), hits.length);
    });
  }, [box, store]);

  /**
   * The caret can move without the text changing — an arrow key, a click,
   * Home — and each of those can carry it out of a `[[` it was inside, or
   * into one. `selectionchange` is the only event that reports all of
   * them; it fires on the document, so it is filtered to this box.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onSelect = (): void => {
      if (document.activeElement === el) sync();
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [box, sync]);

  // Nothing survives the box going away: the list is anchored to an
  // element that is no longer on the page.
  useEffect(() => () => store.close(), [store]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      /* The list is on screen but focus is not in it — the caret is still
         in the box, which is the point of the thing. So the keys that
         drive the list are taken here, ahead of the box's own handling,
         and only while it is open. */
      if (!store.snapshot().open) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        store.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        // Enter in a comment box makes a new line and Tab leaves the field;
        // while a name is being completed, both mean "take this one".
        if (store.commit()) event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        // Stopped here: Escape also closes the sheet this box sits in on a
        // phone, and dismissing the list should not also throw away the
        // comment being written.
        event.preventDefault();
        event.stopPropagation();
        store.close();
      }
    },
    [store],
  );

  return { store, sync, onKeyDown };
}
