import { useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, reauth, type Note, type Settings } from '@/settings/cards/shared';

// --- Security ----------------------------------------------------------------

export function SecurityCard({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  return (
    <Card icon={ShieldCheck} title={t('Security')}>
      <PasswordBlock gate={settings.gate} />
      <Separator />
      <TotpBlock settings={settings} onChanged={onChanged} />
      {/* Only when a gate exists: with no password there is no session to
          end, and a Sign out that reloads into an open app is noise. */}
      {settings.gate && (
        <>
          <Separator />
          <SignOutBlock />
        </>
      )}
    </Card>
  );
}

/**
 * The way out of a session from inside the app. /auth/logout genuinely
 * revokes now (the store forgets this token, so a stolen copy dies with
 * it) — but nothing called it, which made signing out a user action that
 * needed a shell. PasswordGate has no relock hook to reach from here (its
 * 401 handler only fires on an unauthorised api() reply, and logout
 * answers 200), so this takes the card's own reauth() path: the same
 * note-then-reload every credential change uses, landing on the lock
 * screen once the cookie is gone.
 */
function SignOutBlock() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const signOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    // Deliberately still busy: the button must not invite a second press
    // during the beat before the reload.
    setNote({ kind: 'ok', text: t('Signed out. Back to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{t('Sign out')}</span>
      <p className="text-muted-foreground text-sm">
        {t('Ends this device’s session on the server, so a copy of its cookie stops working too. Other devices stay signed in.')}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void signOut()}>
          {t('Sign out')}
        </Button>
        <Feedback note={note} />
      </div>
    </div>
  );
}

function PasswordBlock({ gate }: { gate: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState<Note>(null);

  const change = async (): Promise<void> => {
    if (next !== confirm) {
      setNote({ kind: 'error', text: t('New passwords do not match.') });
      return;
    }
    try {
      await api('/api/settings/password', { method: 'POST', json: { current, next } });
    } catch (e) {
      // Through t(): the server's refusals ("wrong password") are
      // translation keys, as they were before api() carried them.
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('Password changed. Signing you out to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{gate ? t('Change app password') : t('Set an app password')}</span>
      {!gate && (
        <p className="text-muted-foreground text-sm">
          {t('No password is set, so anyone who can reach this server sees everything. Setting one turns the lock screen on.')}
        </p>
      )}
      {gate && (
        <Field label="Current password">
          <Input inputSize="lg" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password">
          <Input inputSize="lg" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat new password">
          <Input inputSize="lg" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="default" disabled={next.length < 8 || (gate && current === '')} onClick={() => void change()}>
          {t(gate ? 'Change password' : 'Set password')}
        </Button>
        <Feedback note={note} />
      </div>
    </div>
  );
}

function TotpBlock({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<Note>(null);

  const start = async (): Promise<void> => {
    let body: { secret?: string; otpauth?: string } | undefined;
    try {
      body = await api<{ secret?: string; otpauth?: string }>('/api/settings/2fa/start', {
        method: 'POST',
      });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    if (!body?.secret || !body.otpauth) {
      setNote({ kind: 'error', text: t('Could not start 2FA enrolment.') });
      return;
    }
    const qr = await QRCode.toDataURL(body.otpauth, { margin: 1, width: 192 });
    setEnroll({ secret: body.secret, qr });
    setCode('');
    setNote(null);
  };

  const enable = async (): Promise<void> => {
    if (!enroll) return;
    try {
      await api('/api/settings/2fa/enable', { method: 'POST', json: { secret: enroll.secret, code } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setEnroll(null);
    setNote({ kind: 'ok', text: t('2FA is on. Signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  const disable = async (): Promise<void> => {
    try {
      await api('/api/settings/2fa/disable', { method: 'POST', json: { code } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('2FA is off. Signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  if (settings.totp) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-base font-medium">
          {t('Two-factor authentication')}
          <Badge variant="good">{t('On')}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">{t('Turning it off needs a current code from your authenticator app.')}</p>
        <div className="flex items-center gap-2">
          <Input
            inputSize="lg"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            aria-label={t('Authenticator code')}
            className="w-28"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button variant="destructive" disabled={code.trim().length < 6} onClick={() => void disable()}>
            {t('Turn off 2FA')}
          </Button>
        </div>
        <Feedback note={note} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{t('Two-factor authentication')}</span>
      {!enroll ? (
        <>
          <p className="text-muted-foreground text-sm">
            {t('Adds a 6-digit authenticator code (Google Authenticator, 1Password, Aegis…) to the lock screen.')}{' '}
            {settings.gate ? '' : t('Set an app password first.')}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={!settings.gate} onClick={() => void start()}>{t('Set up 2FA')}</Button>
            <Feedback note={note} />
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t('Scan with your authenticator app, then enter the code it shows. Nothing is saved until the code checks out.')}
          </p>
          <img src={enroll.qr} alt={t('TOTP enrolment QR code')} className="size-40 rounded-lg bg-white p-1.5" />
          <p className="text-muted-foreground break-all text-sm">
            Manual entry key: <span className="font-mono">{enroll.secret}</span>
          </p>
          <div className="flex items-center gap-2">
            <Input
              inputSize="lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              aria-label={t('Authenticator code')}
              className="w-28"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button variant="default" disabled={code.trim().length < 6} onClick={() => void enable()}>
              {t('Verify & enable')}
            </Button>
            <Button variant="ghost" onClick={() => setEnroll(null)}>{t('Cancel')}</Button>
          </div>
          <Feedback note={note} />
        </>
      )}
    </div>
  );
}
