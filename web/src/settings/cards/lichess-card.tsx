import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { forgetLichessToken } from '@/components/lichess-token-notice';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Input } from '@/components/ui/input';
import { TitleTip } from '@/components/title-tip';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, type Note, type Settings } from '@/settings/cards/shared';

// --- Lichess -----------------------------------------------------------------

export function LichessCard({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const save = async (): Promise<void> => {
    try {
      await api('/api/settings/lichess', { method: 'PUT', json: { token } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setToken('');
    // Every view that warns about a missing token asked once for the
    // session; without this the warning outlives the token it is about.
    forgetLichessToken();
    setNote({ kind: 'ok', text: t('Token saved.') });
    await onChanged();
  };

  const clear = async (): Promise<void> => {
    // Saying "removed" while the token survived was the old behaviour
    // (the response went unchecked); a failed delete now says so.
    try {
      await api('/api/settings/lichess', { method: 'DELETE' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    forgetLichessToken();
    setNote({ kind: 'ok', text: t('Token removed.') });
    await onChanged();
  };

  return (
    <Card icon={KeyRound} title={t('Lichess token')}>
      {/* One sentence, one string. Assembling it around the link left the
          tail in English while the head was Korean, and no translator can
          fix a sentence that is three fragments in the source. */}
      <p className="text-muted-foreground text-sm">
        {t('Powers the online opening explorer and your Lichess puzzle history. Create one with no scopes and paste it here. It is stored in the vault and never shown again.')}
      </p>
      <a
        className="text-primary text-sm underline underline-offset-2"
        href="https://lichess.org/account/oauth/token/create"
        target="_blank"
        rel="noreferrer"
      >
        lichess.org/account/oauth/token/create
      </a>
      {settings.lichess.configured && (
        <p className="text-muted-foreground text-sm">
          {t('A token ending in {last4} is configured.', { last4: `…${settings.lichess.last4}` })}
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* A token is a secret, so it stays masked by default — but you
            paste it here, so an eye toggle lets you check it before saving. */}
        <div className="relative flex-1">
          <Input
            inputSize="lg"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            placeholder="lip_…"
            aria-label={t('Lichess token')}
            className="w-full pr-9"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <TitleTip title={t(show ? 'Hide token' : 'Show token')}>
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={t(show ? 'Hide token' : 'Show token')}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 grid w-9 place-items-center"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </TitleTip>
        </div>
        <Button variant="default" disabled={token.trim() === ''} onClick={() => void save()}>{t('Save')}</Button>
        {settings.lichess.configured && (
          <Button variant="destructive" onClick={() => void clear()}>{t('Remove')}</Button>
        )}
      </div>
      <Feedback note={note} />
    </Card>
  );
}
