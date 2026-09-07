import { History, Link, MoreHorizontal, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { Button } from '@/components/ui/button';
import { DocumentHistory, type HistoryKind } from '@/components/history-panel';
import { AliasEditor } from '@/notes/AliasEditor';
import { LinkedMentions } from '@/notes/LinkedMentions';
import type { LinkSection } from '@shared/wikiLinks';
import { useMediaQuery } from '@/lib/media';
import { t } from '@/lib/i18n';

/**
 * A document's three quiet tools — other names, what links here, earlier
 * versions — in the order the header reads them: what points at this
 * document, what it has been, before the Edit and Save that say what it
 * is becoming.
 *
 * On a desktop they are three icon buttons on the title row. On a phone
 * they fold behind one ⋯: the row already holds the back chevron, Edit
 * and Save, and with three more buttons the title was one word wide
 * ("Attack…" for "Attacking the castled king", at 375px). Toolbars on
 * both platforms keep two or three actions in the bar and the rest in a
 * menu, and the moves panel's own header made the same fold for the same
 * reason (`MovesOverflow`). The ⋯ opens the app's sheet, the same menu
 * every row opens; each verb opens the dialog its button used to.
 *
 * Linked mentions drops its button when the document has none, and the
 * menu drops the verb on the same count, so a phone never offers a press
 * that opens nothing.
 */
export function DocumentTools({
  aliases,
  mentions,
  history,
}: {
  aliases: { title: string; names: string[]; onSave: (names: string[]) => void };
  mentions: { section: LinkSection; id: string };
  history: { kind: HistoryKind; id: string; name: string; onRestored: () => void };
}) {
  // The md fold, as the moves panel reads it: below this the bar is a
  // phone's and the buttons go behind the ⋯.
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  const [open, setOpen] = useState<'aliases' | 'mentions' | 'history' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mentionCount, setMentionCount] = useState(0);
  // A dialog belongs to the document it was opened on: the next document
  // (same view, new id) starts with none open.
  useEffect(() => {
    setOpen(null);
    setMenuOpen(false);
  }, [mentions.id]);

  const tools = (
    <>
      <AliasEditor
        title={aliases.title}
        names={aliases.names}
        onSave={aliases.onSave}
        trigger={!phone}
        open={phone ? open === 'aliases' : undefined}
        onOpenChange={phone ? (o) => setOpen(o ? 'aliases' : null) : undefined}
      />
      <LinkedMentions
        section={mentions.section}
        id={mentions.id}
        trigger={!phone}
        open={phone ? open === 'mentions' : undefined}
        onOpenChange={phone ? (o) => setOpen(o ? 'mentions' : null) : undefined}
        onCountChange={setMentionCount}
      />
      <DocumentHistory
        kind={history.kind}
        id={history.id}
        name={history.name}
        onRestored={history.onRestored}
        trigger={!phone}
        open={phone ? open === 'history' : undefined}
        onOpenChange={phone ? (o) => setOpen(o ? 'history' : null) : undefined}
      />
    </>
  );
  if (!phone) return tools;

  const actions: MenuAction[] = [
    { label: aliases.title, icon: Tags, onSelect: () => setOpen('aliases') },
    ...(mentionCount > 0
      ? [{ label: 'Linked mentions', icon: Link, onSelect: () => setOpen('mentions') }]
      : []),
    { label: 'Earlier versions', icon: History, onSelect: () => setOpen('history') },
  ];
  return (
    <>
      <ActionMenu title={t('Document')} actions={actions} open={menuOpen} onOpenChange={setMenuOpen}>
        <Button variant="ghost" size="icon-sm" className="shrink-0" title={t('More')} active={menuOpen}>
          <MoreHorizontal className="size-3.5" />
        </Button>
      </ActionMenu>
      {tools}
    </>
  );
}
