import { useEffect, useState } from 'react';
import { Link } from 'lucide-react';
import type { LinkSection } from '@shared/wikiLinks';
import { SECTION_ICON } from '@/lib/sectionIcon';
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
 * reverse by reading every document. All three can be a source now: a note
 * anywhere in its markdown, a study or a game inside a move comment.
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
  /**
   * Which kind of document it was written in. A mention could only come
   * from a note when this was built, so the row navigated to `notes`
   * without asking; a comment on a move can hold a link now, and a
   * backlink that opens the wrong section is worse than none.
   */
  fromSection: LinkSection;
  /** Which chapter of a study, so the row opens the one that mentions it. */
  chapter?: number;
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
        json: {
          section: m.fromSection,
          note: m.from,
          at: m.at,
          text: m.target,
          target: id.split('/').at(-1),
        },
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

  /**
   * Open the document a mention was written in — and, for a study, the
   * chapter it was written in. A study is several games in one file, so
   * landing on the first means hunting for what the backlink promised.
   * The chapter comes from the server, recomputed per request, so it
   * cannot point at the wrong one after a reorder.
   */
  const openSource = (m: Mention): void => {
    setOpen(false);
    const id = encodeURIComponent(m.from);
    if (m.chapter !== undefined) navigate(m.fromSection, id, String(m.chapter));
    else navigate(m.fromSection, id);
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
          {/* -mx-2 against the rows' px-2: the padding is the hover
              ground's breathing room, and without pulling it back the text
              sat 8px further in than the window's own title. The ground
              reaches into the card's padding; the words line up. */}
          <div className="-mx-2 flex flex-col gap-1">
          <ul className="flex flex-col gap-0.5">
            {mentions.map((m) => (
              <li key={`${m.from}:${m.at}`}>
                <button
                  type="button"
                  onClick={() => openSource(m)}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <SourceIcon m={m} className="text-muted-foreground size-3.5 shrink-0" />
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
                    /* The action is its own COLUMN, beside the name and the
                       excerpt rather than above the excerpt. On the title
                       line alone it was level with the name but the excerpt
                       ran on underneath it, so the text passed behind the
                       button and neither edge lined up with anything. A
                       column ends the text where the button starts. */
                    <li key={at} className="hover:bg-accent flex items-start gap-2 rounded-md px-2 py-2">
                      <SourceIcon m={m} className="text-muted-foreground mt-1 size-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openSource(m)}
                          className="focus-visible:ring-ring block max-w-full truncate rounded-sm text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                        >
                          {m.from.split('/').at(-1)}
                        </button>
                        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
                          <Context text={m.context} mark={m.target} at={m.markAt} />
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={linked.has(at)}
                        onClick={() => void link(m, at)}
                      >
                        {linked.has(at) ? t('Linked') : t('Link')}
                      </Button>
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
 * Which kind of document this mention was written in.
 *
 * It was a page icon on every row, back when every row was a note. Three
 * kinds can hold a link now, and which one a row came from is the first
 * thing a reader needs — a name alone does not say whether pressing it
 * opens a note or jumps into the middle of a study. The pictures are the
 * app's own, from the sidebar.
 */
function SourceIcon({ m, className }: { m: Mention; className?: string }) {
  const Icon = SECTION_ICON[m.fromSection];
  return <Icon className={className} />;
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
      {/* Square, deliberately. A rounded ground reads as a chip — a small
          object sitting in the sentence — where this is a run of the
          sentence that has been picked out. That is what a text selection
          looks like, and it is what this means. */}
      <mark className="bg-primary/20 text-foreground px-0.5">
        {text.slice(found, found + wanted.length)}
      </mark>
      {text.slice(found + wanted.length)}
    </>
  );
}
