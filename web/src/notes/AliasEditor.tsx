import { useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { ClearableInput } from '@/components/text-fields';
import { t } from '@/lib/i18n';

/**
 * The other names a document answers to.
 *
 * An alias exists because a filename and the way you refer to something in
 * a sentence are different things: the study is called "Sicilian Defence —
 * Najdorf Variation" because that reads well in a list, and mid-sentence
 * you write "the Najdorf". Display text fixes how a link READS; an alias
 * fixes what you have to type.
 *
 * One dialog for all three kinds, because it is one idea. WHERE the names
 * are kept is not its business and differs by kind — front matter for a
 * note, which is where Obsidian keeps it so a vault opened in both agrees;
 * an `[Aliases]` PGN header for a study or a game, which have no front
 * matter but whose codec preserves headers it does not know. The caller
 * hands over the current list and takes back the edited one.
 *
 * It needs an editor at all because of the standing rule that every user
 * action must be possible in the app. Reading aliases while requiring a
 * text editor to set one would put half a feature behind file access.
 */
export function AliasEditor({
  title,
  names,
  onSave,
}: {
  /** What the control and its dialog are called, e.g. "…for this study". */
  title: string;
  names: string[];
  onSave: (names: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const current = names.join(', ');

  // Re-read on open rather than on every render: the field is a draft
  // while the dialog is up, and a save elsewhere must not retype it.
  useEffect(() => {
    if (open) setText(current);
  }, [open, current]);

  const commit = (): void => {
    setOpen(false);
    const next = text.split(',');
    // Compared as the cleaned list the caller would store, so closing the
    // dialog having typed nothing new never writes the document.
    if (next.map((n) => n.trim()).filter(Boolean).join(', ') !== current) onSave(next);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        title={title}
        active={open}
        onClick={() => setOpen(true)}
      >
        <Tags className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : commit())}>
        <DialogContent size="sm" title={title}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="note-aliases">{t('Names')}</FieldLabel>
              <ClearableInput
                id="note-aliases"
                value={text}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                }}
                placeholder={t('Najdorf, B90')}
              />
              <FieldDescription>
                {t('Separated by commas. A [[link]] to any of these opens this document.')}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </DialogContent>
      </Dialog>
    </>
  );
}
