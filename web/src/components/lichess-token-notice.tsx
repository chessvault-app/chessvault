import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * "The online field needs a token, and Settings is where it goes" — the
 * one place that sentence is written.
 *
 * Three surfaces read the Lichess explorer through the server's token:
 * the explorer pane, the repertoire trainer's online field, and the
 * opening map's coverage check. Each had grown its own words for the
 * same missing thing — one linked, one did not, one said nothing at all
 * and simply drew an empty map — so the same fault read as three
 * different faults, and only one of them named the fix.
 *
 * The answer is deliberately one sentence and one link rather than a
 * sentence per surface: every one of these views has its source picker
 * within reach, so "pick something else instead" is advice the screen is
 * already giving.
 */

/**
 * Whether this vault has a Lichess token configured.
 *
 * `undefined` until the answer is in, and again if settings cannot be
 * reached — the difference between "no token" and "nobody has said yet"
 * is the difference between a reason and a false accusation, so callers
 * must warn on `false` alone and let whatever they were doing report its
 * own failure otherwise.
 *
 * The demo has no server to ask and offers no online source, so it is
 * answered without a request.
 */
export function useLichessToken(): boolean | undefined {
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (isDemo()) return;
    let live = true;
    void ask().then((answer) => {
      if (live) setConfigured(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return configured;
}

/**
 * One request per session, not one per mount.
 *
 * The map asks from the canvas, from its options window and from every
 * node panel it opens; three views asking the same question of the same
 * settings file on every selection is a request nobody reads the answer
 * to twice. A failure is not cached — an unreachable server now may be
 * reachable a second from now — and `forgetLichessToken` clears the
 * answer when the token itself changes.
 */
let asked: Promise<boolean | undefined> | null = null;

function ask(): Promise<boolean | undefined> {
  asked ??= api<{ lichess?: { configured?: boolean } }>('/api/settings')
    .then((body) => body?.lichess?.configured === true)
    .catch(() => {
      asked = null;
      return undefined;
    });
  return asked;
}

/**
 * Called by Settings when the token is saved or removed, so a user who
 * fixes the thing this notice complains about does not carry the
 * complaint around for the rest of the session.
 */
export function forgetLichessToken(): void {
  asked = null;
}

/**
 * The sentence, and the way to act on it.
 *
 * The way out is a Button in the registry's `link` dress rather than an
 * `<a>` or a filled control, and both halves of that were arrived at the
 * hard way.
 *
 * A button, because `href="#/settings"` moves the hash behind the
 * router's back: the leave guard still catches it, but `navigate()` also
 * marks the arrival as a navigation, and a raw hash change leaves that
 * mark unset — so Settings would read as arrived-at-by-Back, which is
 * what its own chevron keys off.
 *
 * Dressed as a link, because every surface this lands on already has its
 * own action: Start under the trainer's fields, the panel's row of five,
 * the sheet's own Add, a window of tappable rows. A filled button among
 * those is a second primary in the same box, and a boxed control stacked
 * under one muted sentence reads as bolted on rather than as the end of
 * the sentence. Quiet is also honest here — nothing has failed and
 * nothing is urgent; a setting is missing.
 *
 * The invisible inset is the app's own answer to a small target on a
 * touch screen (the statistics table's + does the same): the
 * words keep their size and the thumb gets 40-odd px.
 *
 * `break-keep` on the sentence because Korean breaks between SYLLABLES
 * by default: the map's card split 설정 down the middle and left 정에서
 * to start the next line, which is a word cut in half rather than a line
 * ending. Keep-all breaks at spaces, the way the English does.
 */
export function LichessTokenNotice({ className }: { className?: string }) {
  return (
    <p className={cn('text-muted-foreground break-keep text-sm leading-relaxed', className)}>
      {t('The Lichess database needs an API token.')}{' '}
      <Button
        variant="link"
        size="sm"
        className={cn(
          'relative h-auto whitespace-nowrap p-0 align-baseline text-sm',
          'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
        )}
        onClick={() => navigate('settings')}
      >
        {t('Add one in Settings')}
      </Button>
    </p>
  );
}
