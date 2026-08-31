import { useEffect, useState } from 'react';
import { FileText, Link } from 'lucide-react';
import type { LinkSection } from '@shared/wikiLinks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * What links here.
 *
 * Links point one way on disk — a note writes `[[Some Game]]` and the game
 * knows nothing about it — so this asks the server, which derives the
 * reverse by reading the notes. Only notes can hold a link today, studies
 * and games being PGN with no markdown body, so a document is a target
 * here and never a source.
 *
 * Placement took three tries and each was wrong for a reason worth
 * keeping. A section at the foot of the moves panel looked natural and was
 * not: that panel documents itself as full — every child but the move
 * table is shrink-0, so whatever is last gets clipped when they stop
 * fitting, which meant the mentions took the annotation editor's space and
 * then their own. Its own panel in the column fixed the clipping and
 * bought a permanent card on every game, for something most games have
 * none of and nobody consults while reading moves.
 *
 * So it sits where `DocumentHistory` sits and works the same way: an icon
 * in the title row, a dialog on press, and that dialog is the phone sheet
 * at small widths. One implementation covers every screen — no pane tab,
 * no second placement. The icon carries no count: the row it sits in is a
 * row of bare icons, and a number beside one reads as a badge on a toolbar
 * rather than part of it. How many is what opening it tells you.
 *
 * Nothing links here means no icon at all. Most documents will never be
 * mentioned, and a permanently empty control is a question every one of
 * them has to carry.
 */

interface Mention {
  from: string;
  context: string;
  target: string;
  at: number;
  /** Where in `context` the matched words are, when the server knows. */
  markAt?: number;
}

interface Answer {
  mentions: Mention[];
  unlinked: Mention[];
  unlinkedCapped: boolean;
}

const NOTHING: Answer = { mentions: [], unlinked: [], unlinkedCapped: false };

export function LinkedMentions({ section, id }: { section: LinkSection; id: string }) {
  const [answer, setAnswer] = useState<Answer>(NOTHING);
  const [open, setOpen] = useState(false);
  /** Mentions linked in this sitting, so a pressed row stops offering. */
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const { mentions, unlinked, unlinkedCapped } = answer;

  useEffect(() => {
    let cancelled = false;
    // A document with no backlinks is the common case and its answer is an
    // empty list, so a failure here is treated the same way: no icon. The
    // alternative is an error surfaced on a page about something else.
    setLinked(new Set());
    void api<Answer>(`/api/links/${section}/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!cancelled) setAnswer({ ...NOTHING, ...r });
      })
      .catch(() => {
        if (!cancelled) setAnswer(NOTHING);
      });
    return () => {
      cancelled = true;
      // Closed on the way out: the dialog belongs to the document that was
      // open, and leaving it up over the next one would be a list of the
      // wrong thing.
      setOpen(false);
    };
  }, [section, id]);

  /**
   * Wrap one mention in brackets, in the note it sits in.
   *
   * The offset came from a cached scan, so the server verifies the text is
   * still there and refuses if the note has moved on — better to ask again
   * than to write brackets into the middle of a changed sentence. A refusal
   * leaves the row offering, which is the honest state.
   */
  const link = async (m: Mention, at: string): Promise<void> => {
    try {
      await api('/api/links/link', {
        method: 'POST',
        json: { note: m.from, at: m.at, text: m.target, target: id.split('/').at(-1) },
      });
      setLinked((held) => new Set(held).add(at));
      // Re-asked, not patched. Wrapping one mention adds four characters to
      // that note, so every LATER mention in it has moved -- a second row
      // pressed against the old offsets would fail the server's check and
      // read as a button that does nothing. The fresh answer also moves the
      // one just linked out of this list and into the mentions above, which
      // is what actually happened.
      const fresh = await api<Answer>(`/api/links/${section}/${encodeURIComponent(id)}`);
      setAnswer({ ...NOTHING, ...fresh });
    } catch {
      // Left as it was: the row still offers, and pressing again re-asks.
    }
  };

  if (mentions.length === 0 && unlinked.length === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        title={t('Linked mentions')}
        active={open}
        onClick={() => setOpen(true)}
      >
        <Link className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm" title={t('Linked mentions')}>
          {/* The spacing goes on a wrapper, never on the card. The card's
              sticky header reaches 14px DOWN under the content below it
              and relies on the card's own gap-4 to put that back;
              overriding the gap with anything smaller makes the sum
              negative and slides the first row up under the title. */}
          <div className="flex flex-col gap-1">
          <ul className="flex flex-col gap-0.5">
            {mentions.map((m) => (
              <li key={`${m.from}:${m.at}`}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('notes', encodeURIComponent(m.from));
                  }}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="text-muted-foreground size-3.5 shrink-0" />
                    {m.from.split('/').at(-1)}
                  </span>
                  <span className="text-muted-foreground text-xs leading-5">
                    <Context text={m.context} mark={m.target} at={m.markAt} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {unlinked.length > 0 && (
            <>
              {/* Kept apart from the mentions above, and second, because
                  they are a different kind of thing: those are links
                  somebody made, these are guesses about ones they might
                  have meant to. Mixing them would make the list above less
                  trustworthy than it is. */}
              <h3 className="text-muted-foreground mt-2 px-2 text-xs font-medium">
                {t('Unlinked mentions')}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {unlinked.map((m) => {
                  const at = `${m.from}:${m.at}`;
                  return (
                    /* The action sits on the TITLE line, not out at the
                       right of a two-line row. Beside two lines of context
                       it read as floating next to the block rather than
                       belonging to it; on the title line it lines up with
                       the thing it acts on. Two controls, not one row that
                       is also a button: a button inside a button is not
                       valid, and the name is the part worth pressing to
                       open. */
                    <li key={at} className="hover:bg-accent rounded-md px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <FileText className="text-muted-foreground size-3.5 shrink-0" />
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            navigate('notes', encodeURIComponent(m.from));
                          }}
                          className="focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {m.from.split('/').at(-1)}
                        </button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="-my-1 shrink-0"
                          disabled={linked.has(at)}
                          onClick={() => void link(m, at)}
                        >
                          {linked.has(at) ? t('Linked') : t('Link')}
                        </Button>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-xs leading-5">
                        <Context text={m.context} mark={m.target} at={m.markAt} />
                      </p>
                    </li>
                  );
                })}
              </ul>
              {unlinkedCapped && (
                <p className="text-muted-foreground px-2 pb-1 text-xs">
                  {t('Only the first {n} are shown.', { n: unlinked.length })}
                </p>
              )}
            </>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The sentence, with the words that formed the link picked out.
 *
 * Plain text and one substring, so no markup is parsed and nothing from a
 * note reaches the DOM as anything but a string.
 */
function Context({ text, mark, at }: { text: string; mark: string; at?: number }) {
  const wanted = mark.trim();
  // The server says WHICH occurrence when a sentence holds the name more
  // than once. Falling back to the first is right where it is the only one
  // and harmless where the server did not say.
  const found = at !== undefined && at >= 0 ? at : text.toLowerCase().indexOf(wanted.toLowerCase());
  if (found < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, found)}
      {/* A block, not a colour. Coloured text asks the reader to compare two
          shades of grey across a line to find the words that matched; a
          filled ground says it at a glance, and reads as what it is — the
          selection the row is about. `mark` because that is what the
          element means, with its own yellow taken off. */}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">
        {text.slice(found, found + wanted.length)}
      </mark>
      {text.slice(found + wanted.length)}
    </>
  );
}
