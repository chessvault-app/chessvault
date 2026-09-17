import { X } from 'lucide-react';
import { useState } from 'react';
import { type Section } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';

/**
 * Demo notice.
 *
 * A vault that disappears is only honest if it says so: a visitor who
 * writes a study and comes back to find it gone should have been told
 * before rather than after.
 */
/**
 * Where the demo's notice belongs: the hub pages, and not a board or an
 * open document. It was the first thing on every screen, an amber strip
 * (the caution colour) 33px tall above the board on the pages where the
 * design says chrome gives up a rung before the board gives up a pixel,
 * and it could not be put away. A visitor who has opened a game is in the
 * demo already and knows it; the shelves are where the sentence does its
 * work. Dismissed for the tab's life with the X; a reload puts the vault
 * back, and the notice with it.
 */
function demoBannerBelongs(section: Section, params: string[]): boolean {
  switch (section) {
    case 'home':
    case 'databases':
    case 'settings':
    case 'more':
      return true;
    case 'games':
    case 'studies':
    case 'notes':
    case 'books':
    case 'endgames':
      return params.length === 0;
    case 'puzzles':
      return (
        params[0] === 'hub' ||
        params[0] === 'dashboard' ||
        params[0] === 'themes' ||
        (params[0] === 'books' && params.length === 1)
      );
    default:
      return false;
  }
}

const DEMO_BANNER_KEY = 'chess-vault:demo-banner';

export function DemoBanner({ section, params }: { section: Section; params: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DEMO_BANNER_KEY) === 'dismissed';
    } catch {
      return false;
    }
  });
  if (!isDemo() || dismissed || !demoBannerBelongs(section, params)) return null;
  const dismiss = (): void => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DEMO_BANNER_KEY, 'dismissed');
    } catch {
      // Storage refused: the notice comes back on the next page, which is fine.
    }
  };
  return (
    <div
      // Named so the screenshot capture can hide it — the demo is where
      // the docs' images come from, and this notice is a property of the
      // demo rather than of the app being pictured. It used to be found
      // by matching its own sentence, which meant the images depended on
      // a string nobody would think to check when editing it.
      data-demo-banner
      // A landmark of its own, so nothing on the page sits outside one.
      role="status"
      // 10%, not 14%: this is --warn read against a wash of --warn, and at
      // 14% the sentence came to 4.39:1 in light — under the floor, on the
      // first thing anyone sees after clicking "Try the demo". 10% reads
      // 4.68:1 and is still plainly a band. Dark was never close (9.32:1).
      // relative: the X is placed absolutely so the strip keeps the height
      // its sentence gives it; a button in the flow grew it by the icon
      // button's own box (and by the coarse-pointer bump on a phone).
      className="text-warn border-card-ring relative flex shrink-0 items-center justify-center gap-2 border-b bg-[color-mix(in_oklch,var(--warn)_10%,var(--card))] px-3 py-1.5 text-center text-sm"
    >
      {/* The whole sentence wrapped to two lines at 375px and took about
          100px off every page, above the board included. Below md the
          band says the short form, and a tap unfolds the rest. */}
      <span className="max-md:hidden">
        {t('Demo: a sample vault of your own. Edit anything, and a reload puts it back.')}
      </span>
      <button
        type="button"
        className="md:hidden"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? t('Demo: a sample vault of your own. Edit anything, and a reload puts it back.')
          : t('Demo vault. A reload puts it back.')}
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-warn absolute top-1/2 right-1 -translate-y-1/2"
        title={t('Close')}
        onClick={dismiss}
      >
        <X className="glyph-sm" />
      </Button>
    </div>
  );
}
