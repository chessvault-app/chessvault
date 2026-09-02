import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from 'react';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { MENU_ITEM } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { CLOSED, type SuggestStore } from './suggestStore';

/**
 * The list `[[` opens, drawn beside the caret.
 *
 * It is a Popover and not a div, and the difference is the whole reason
 * this file exists. The hand-rolled version positioned itself with
 * `coords.left` clamped against `innerWidth`, which handled exactly one
 * of the ways a layer can land wrong: it still fell off the bottom of a
 * note being typed near the foot of the window, still ignored the page's
 * own scrolling, and still stood outside the app's one dismissal and
 * focus stack — the thing the repo forbids by name. Base UI's positioner
 * flips and shifts it, its portal keeps it clear of the editor's
 * overflow, and the layer stack knows it is there.
 *
 * What it must NOT do is take focus. A suggester's list is read while the
 * caret stays in the document, so `initialFocus`/`finalFocus` are off and
 * the rows are `role="option"` rather than buttons: nothing here is a tab
 * stop, and the editor's contenteditable keeps the selection. Arrow keys,
 * Enter, Tab and Escape are the plugin's — see `handleKeyDown` — because
 * they have to beat the editor's own bindings to them. This side only
 * draws, and reports mouse presses.
 */
export function WikiSuggest({
  store,
  host,
}: {
  store: SuggestStore | null;
  /**
   * The element that keeps focus while the list is read — the note's
   * contenteditable, or the comment box. The list is never focused, so
   * this is what has to carry `aria-activedescendant`.
   */
  host: HTMLElement | null;
}) {
  const subscribe = useCallback(
    (fn: () => void) => store?.subscribe(fn) ?? (() => {}),
    [store],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store?.snapshot() ?? CLOSED,
    () => CLOSED,
  );
  const { open, items, index, total, anchor: at } = snapshot;

  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

  /**
   * The active row is announced through the editor, not by focusing the
   * row: `aria-activedescendant` on the element that still holds focus is
   * how a listbox driven from somewhere else says which item is current.
   * Without it the arrow keys move a highlight that only sighted users
   * can see.
   */
  useEffect(() => {
    const dom = host;
    if (!dom) return;
    if (!open) {
      dom.removeAttribute('aria-activedescendant');
      dom.removeAttribute('aria-controls');
      return;
    }
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-activedescendant', `${listId}-${index}`);
    return () => {
      dom.removeAttribute('aria-activedescendant');
      dom.removeAttribute('aria-controls');
    };
  }, [host, open, index, listId]);

  /**
   * A caret is a point, and a positioner wants a box. Base UI takes a
   * virtual element, so the caret's own line box is handed over — the
   * popup then hangs below the line being typed rather than below an
   * arbitrary y, and flips above it when the line is near the foot of
   * the window.
   */
  const anchor = useMemo(() => {
    if (!at) return null;
    const { left, top, right, bottom } = at;
    return {
      getBoundingClientRect: () => new DOMRect(left, top, right - left, bottom - top),
    };
  }, [at]);

  if (!store || !open || !anchor || !at) return null;

  return (
    <Popover open modal={false} onOpenChange={(next) => !next && store.close()}>
      <PopoverContent
        anchor={anchor}
        side={at.side}
        align="start"
        sideOffset={4}
        collisionPadding={8}
        initialFocus={false}
        finalFocus={false}
        className="w-72 gap-0 p-1"
        role="listbox"
        id={listId}
        aria-label={t('Link to a note, study or game')}
      >
        {items.map((id, i) => (
          <div
            key={id}
            id={optionId(i)}
            role="option"
            aria-selected={i === index}
            // The press must not leave the document: a blurred editor has
            // no caret to insert at, and the range this list was armed
            // with is a position in that document.
            onMouseDown={(e) => {
              e.preventDefault();
              store.pick(id);
            }}
            className={cn(
              MENU_ITEM,
              'truncate aria-selected:bg-accent aria-selected:text-accent-foreground',
            )}
          >
            {id}
          </div>
        ))}
        {total > items.length && (
          <div className="text-muted-foreground px-2 py-1 text-xs">
            {t('{n} more, keep typing', { n: total - items.length })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

