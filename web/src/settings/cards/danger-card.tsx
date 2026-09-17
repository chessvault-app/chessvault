import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { ClearableInput } from '@/components/text-fields';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, type Note } from '@/settings/cards/shared';

// --- Danger zone -------------------------------------------------------------

const WIPE_PHRASE = 'wipe everything';

export function DangerCard({ gate }: { gate: boolean }) {
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Card icon={Trash2} title={t('Danger zone')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('Wipe every game, study, note, puzzle and imported book from the vault, including its change history. The password, 2FA and tokens survive. There is no undo, so download a copy first.')}
      </p>
      <div className="flex items-center gap-2">
        <ClearableInput
          inputSize="lg"
          placeholder={t('Type “{phrase}” to arm', { phrase: WIPE_PHRASE })}
          aria-label={t('Type “{phrase}” to arm', { phrase: WIPE_PHRASE })}
          className="flex-1"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <Button variant="destructive" disabled={phrase !== WIPE_PHRASE} onClick={() => setConfirming(true)}>
          {t('Wipe all data')}
        </Button>
      </div>
      {confirming && <WipeConfirmDialog gate={gate} onClose={() => setConfirming(false)} />}
    </Card>
  );
}

/** The last gate before an irreversible wipe: a modal that (on a gated
    vault) re-asks for the password. Kept separate from the card so the
    password field only exists for the moment it's needed. */
function WipeConfirmDialog({ gate, onClose }: { gate: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const wipe = async (): Promise<void> => {
    setBusy(true);
    // Built before the try: the React Compiler cannot lower the
    // conditional spread inside one yet.
    const json = { confirm: WIPE_PHRASE, ...(gate && { password }) };
    try {
      await api('/api/settings/wipe', { method: 'POST', json });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    setNote({ kind: 'ok', text: t('Vault wiped. Reloading…') });
    setTimeout(() => window.location.reload(), 900);
  };

  // The registry's destructive alert dialog, the same shape as every other
  // confirmation here, only more so: the most destructive question in the
  // app behaves like every other window. The action is a plain Button
  // rather than AlertDialogAction, because the window has to stay up to
  // show a wrong password or the wipe's own failure.
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('Wipe the entire vault?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('This permanently deletes every game, study, note, puzzle and book, and their history. There is no undo.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {gate && (
          <Field label="Confirm your app password">
            <Input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && password !== '' && void wipe()}
            />
          </Field>
        )}
        <Feedback note={note} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || (gate && password === '')}
            onClick={() => void wipe()}
          >
            {busy ? t('Wiping…') : t('Wipe everything')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
