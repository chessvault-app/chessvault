import { useState } from 'react';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PROFILE_NOTE, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { ClearableInput } from '@/components/text-fields';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, type Note, type Settings } from '@/settings/cards/shared';

// --- Profile -----------------------------------------------------------------

export function ProfileCard({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(settings.profile.name ?? '');
  const [chesscom, setChesscom] = useState(settings.profile.chesscom ?? '');
  const [lichess, setLichess] = useState(settings.profile.lichess ?? '');
  const [note, setNote] = useState<Note>(null);

  const save = async (): Promise<void> => {
    try {
      await api('/api/settings/profile', { method: 'PUT', json: { name, chesscom, lichess } });
    } catch {
      setNote({ kind: 'error', text: t('Could not save.') });
      return;
    }
    setNote({ kind: 'ok', text: t('Saved.') });
    await onSaved();
  };

  return (
    <Card icon={User} title={t('Profile')}>
      <Field label="Display name">
        <ClearableInput inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('How the app greets you')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Chess.com username">
          <ClearableInput inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder={t('your Chess.com username')} autoCapitalize="none" />
        </Field>
        <Field label="Lichess username">
          <ClearableInput inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder={t('your Lichess username')} autoCapitalize="none" />
        </Field>
      </div>
      <p className="text-muted-foreground text-sm">{t(PROFILE_NOTE)}</p>
      <div className="flex items-center gap-3">
        <Button variant="default" onClick={() => void save()}>{t('Save profile')}</Button>
        <Feedback note={note} />
      </div>
    </Card>
  );
}
