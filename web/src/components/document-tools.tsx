import { History, Link, MoreHorizontal, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { Button } from '@/components/ui/button';
import { DocumentHistory, type HistoryKind } from '@/components/history-panel';
import { AliasEditor } from '@/notes/AliasEditor';
import { LinkedMentions } from '@/notes/LinkedMentions';
import type { LinkSection } from '@shared/wikiLinks';
import { useMediaQuery } from '@/lib/media';
import { shareIcon } from '@/lib/share';
import { CAN_SHARE, shareDocument } from '@/lib/share-doc';
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
 * that opens nothing. Share is dropped the same way where the browser has
 * no sheet, which is every desktop one.
 */
export function DocumentTools({
  aliases,
  mentions,
  history,
  share,
}: {
  aliases: { title: string; names: string[]; onSave: (names: string[]) => void };
  mentions: { section: LinkSection; id: string };
  history: { kind: HistoryKind; id: string; name: string; onRestored: () => void };
  /**
   * Send this document to another app, where the browser has a share
   * sheet. Opt-in from the caller, because only the caller knows what
   * its document IS: a study and a game are a `.pgn`, a note is a `.md`,
   * and each reads its own text out of its own editor.
   *
   * `text` is called in the tap's own turn and must stay synchronous:
   * `navigator.share` needs the gesture, and an await loses it.
   */
  share?: { label: string; filename: string; type: string; text: () => string };
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
  // Last on the bar and last in the menu, both. The three above are what
  // this document points at and has been, read in that order; sending it
  // somewhere else is not one of them, and putting it first would have
  // pushed the reference verbs down the list a phone reads first.
  const shareVerb = share && CAN_SHARE ? share : null;
  const ShareGlyph = shareIcon();
  if (!phone)
    return (
      <>
        {tools}
        {shareVerb && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            title={t(shareVerb.label)}
            onClick={() => shareDocument(shareVerb.text(), shareVerb.filename, shareVerb.type)}
          >
            <ShareGlyph className="glyph" />
          </Button>
        )}
      </>
    );

  const actions: MenuAction[] = [
    { label: aliases.title, icon: Tags, onSelect: () => setOpen('aliases') },
    ...(mentionCount > 0
      ? [{ label: 'Linked mentions', icon: Link, onSelect: () => setOpen('mentions') }]
      : []),
    { label: 'Earlier versions', icon: History, onSelect: () => setOpen('history') },
    // The sheet row's own press is the gesture navigator.share wants: the
    // menu closes and calls onSelect in the same turn (action-menu.tsx).
    ...(shareVerb
      ? [
          {
            label: shareVerb.label,
            icon: ShareGlyph,
            onSelect: () => shareDocument(shareVerb.text(), shareVerb.filename, shareVerb.type),
          },
        ]
      : []),
  ];
  return (
    <>
      <ActionMenu title={t('Document')} actions={actions} open={menuOpen} onOpenChange={setMenuOpen}>
        <Button variant="ghost" size="icon-sm" className="shrink-0" title={t('More')} active={menuOpen}>
          <MoreHorizontal className="glyph" />
        </Button>
      </ActionMenu>
      {tools}
    </>
  );
}
