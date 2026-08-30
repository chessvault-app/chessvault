import { useState } from 'react';
import { FileText, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * MOCK-UP ONLY — fixture data, not wired to anything.
 *
 * What links here, behind one header control rather than a panel.
 *
 * It was a section in the moves panel first, and that panel documents
 * itself as full: every child but the move table is shrink-0, so the last
 * one is clipped away when they stop fitting. Its own panel in the column
 * fixed the clipping and cost a permanent card on every game — for
 * something most games have none of, and nobody consults while reading
 * moves.
 *
 * So it sits where `DocumentHistory` sits, and works the same way: an icon
 * in the title row, a dialog on press. That dialog is the phone sheet at
 * small widths, so one implementation covers every screen — no pane tab,
 * no second placement. A backlink is navigation, and navigation is worth a
 * button, not a column.
 *
 * The icon carries no count. Its presence is the count that matters —
 * whether anything points here at all — and the row it sits in is a row of
 * bare icons, so a number beside one of them reads as a badge on a toolbar
 * rather than as part of it. How MANY is a thing you learn by opening it,
 * which is the same press you were going to make anyway.
 */
const FIXTURE = [
  {
    note: 'Blunders to stop making',
    before: 'The rook lift I keep missing shows up twice in ',
    link: 'Ibarra L vs Tavares M',
    after: ' — same square, same excuse.',
  },
  {
    note: 'What to review after each game',
    before: 'Compare my line against ',
    link: 'Ibarra L vs Tavares M',
    after: ' before deciding the plan was wrong.',
  },
  {
    note: 'Endgame drills for the week',
    before: 'Rook and bishop, from move 42 of ',
    link: 'Ibarra L vs Tavares M',
    after: '.',
  },
];

export function LinkedMentions() {
  const [open, setOpen] = useState(false);

  // Nothing links here: no button at all. Most documents will never be
  // mentioned, and a permanently empty control in the title row is a
  // question every one of them has to carry.
  if (FIXTURE.length === 0) return null;

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
            {FIXTURE.map((row) => (
              <li key={row.note}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('notes', encodeURIComponent(row.note));
                  }}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="text-muted-foreground size-3.5 shrink-0" />
                    {row.note}
                  </span>
                  <span className="text-muted-foreground text-xs leading-5">
                    {row.before}
                    <span className="text-primary">{row.link}</span>
                    {row.after}
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
