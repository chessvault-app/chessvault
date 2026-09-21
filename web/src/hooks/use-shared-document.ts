import { useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { shareIcon } from '@/lib/share';
import { CAN_SHARE, shareDocument } from '@/lib/share-doc';
import type { MenuAction } from '@/components/action-menu';

/**
 * A Share verb for a document the shelf has not read.
 *
 * A card knows a study's name, its chapter count and when it was last
 * touched. It does not know its text, and the text is what a person
 * sends. One GET has it, and the awkward part is WHEN: `navigator.share`
 * wants the tap's own turn, and an awaited fetch has already given that
 * turn away by the time it answers (lib/share.ts).
 *
 * So the fetch happens when the MENU opens, one press earlier, and the
 * verb is dimmed until it lands. Dimmed rather than absent, because a
 * menu whose rows appear while it is open is a menu you have to read
 * twice (`MenuAction.disabled` says the same). On a phone a study is a
 * few kilobytes off the same host that served the page, so the row is
 * live long before a thumb reaches it; where it is not, the press does
 * nothing rather than the wrong thing.
 *
 * `prime` is idempotent and forgets a failure, so the next open retries.
 */
export function useSharedDocument({
  label,
  url,
  filename,
  type,
}: {
  /** The verb, in English; the menu runs it through `t()`. */
  label: string;
  /** An existing endpoint answering `{ pgn }` — the document's text.
      Notes answer under that same key; see server/studies.ts. */
  url: string;
  filename: string;
  type: string;
}): { prime: () => void; actions: MenuAction[] } {
  const [text, setText] = useState<string | null>(null);
  const asked = useRef(false);
  const prime = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    void api<{ pgn: string }>(url)
      .then((body) => setText(body.pgn))
      .catch(() => {
        // Nothing to say here: the verb simply stays dimmed, and the
        // next time the menu opens it asks again.
        asked.current = false;
      });
  }, [url]);

  if (!CAN_SHARE) return { prime, actions: [] };
  const Glyph = shareIcon();
  return {
    prime,
    actions: [
      {
        label,
        icon: Glyph,
        disabled: text === null,
        onSelect: () => {
          if (text !== null) shareDocument(text, filename, type);
        },
      },
    ],
  };
}
