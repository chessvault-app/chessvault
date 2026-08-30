import { useEffect, useState } from 'react';
import { FileText, Link2 } from 'lucide-react';
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
}

export function LinkedMentions({ section, id }: { section: LinkSection; id: string }) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A document with no backlinks is the common case and its answer is an
    // empty list, so a failure here is treated the same way: no icon. The
    // alternative is an error surfaced on a page about something else.
    void api<{ mentions: Mention[] }>(`/api/links/${section}/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!cancelled) setMentions(r.mentions);
      })
      .catch(() => {
        if (!cancelled) setMentions([]);
      });
    return () => {
      cancelled = true;
      // Closed on the way out: the dialog belongs to the document that was
      // open, and leaving it up over the next one would be a list of the
      // wrong thing.
      setOpen(false);
    };
  }, [section, id]);

  if (mentions.length === 0) return null;

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
        <Link2 className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm" title={t('Linked mentions')} className="gap-1">
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
                    <Context text={m.context} mark={m.target} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
function Context({ text, mark }: { text: string; mark: string }) {
  const at = text.toLowerCase().indexOf(mark.trim().toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="text-primary">{text.slice(at, at + mark.trim().length)}</span>
      {text.slice(at + mark.trim().length)}
    </>
  );
}
