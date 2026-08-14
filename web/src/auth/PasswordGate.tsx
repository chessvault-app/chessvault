import { ChevronLeft, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { KnightIcon } from '@/ui/KnightIcon';
import { Input } from '@/ui/Input';
import { setUnauthorizedHandler } from '@/lib/api';
import { t } from '@/lib/i18n';

/**
 * Wraps the app when the server has an appPassword configured (public
 * deployments): everything under /api answers 401 until the session cookie
 * is set, so the shell shows a lock screen instead of a broken app. When
 * no password is configured (local use) the status check passes straight
 * through and this renders nothing extra.
 *
 * Sign-in is two-stage when an authenticator is configured, the way every
 * other app does it: password first, and only once it is accepted does the
 * code screen appear. The server answers a correct password with
 * `{ needTotp: true }` rather than an error, so the first stage costs no
 * throttle attempt.
 */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [stage, setStage] = useState<'password' | 'code'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d: { required: boolean; authed: boolean }) => {
        setState(d.required && !d.authed ? 'locked' : 'open');
      })
      // If the server is unreachable the app shows its own errors; don't
      // trap the user on a lock screen for that.
      .catch(() => setState('open'));
    // A 401 from anywhere in the app means the session expired while it
    // was open. Relock: the fix is signing in again, and every other
    // surface could only misreport it as the server being away.
    setUnauthorizedHandler(() => setState('locked'));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <div className="bg-app h-[100dvh]" />;

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (stage === 'password' ? !password : code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Stage one sends the password alone; the server replies needTotp
        // when an authenticator is configured.
        body: JSON.stringify(stage === 'code' ? { password, code } : { password }),
      });
    } catch {
      // A tailnet blip at exactly this moment used to leave the button on
      // "Checking…" for ever — the throw skipped setBusy(false).
      setBusy(false);
      setError(navigator.onLine ? t('vault server unreachable') : t('no internet connection'));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; needTotp?: boolean };
    setBusy(false);
    if (res.ok) {
      if (body.needTotp) {
        setStage('code');
        setCode('');
        return;
      }
      setState('open');
      return;
    }
    if (res.status === 429) {
      setError(t('Too many attempts — wait a few minutes.'));
      return;
    }
    if (body.error === 'wrong authenticator code') {
      setError(t('Wrong authenticator code.'));
      setCode('');
      return;
    }
    // A wrong password can only come from stage one; start over there.
    setError(t('Wrong password.'));
    setPassword('');
    setStage('password');
  };

  const backToPassword = (): void => {
    setStage('password');
    setCode('');
    setError(null);
  };

  return (
    <div className="bg-app text-fg flex h-[100dvh] flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        {/* The same knight as the sidebar — the lock screen is the front
            door, so it wears the brand, not a padlock. */}
        <div className="bg-primary text-primary-fg mb-5 grid size-14 place-items-center rounded-2xl shadow-[var(--shadow-panel)]">
          <KnightIcon className="size-8" />
        </div>
        <h1 className="text-fg text-xl font-semibold tracking-tight">{t('Chess Vault')}</h1>
        <p className="text-subtle mb-6 mt-1 text-sm">{t('Your chess, in plain files.')}</p>

        <form
          className="bg-surface border-line w-full rounded-2xl border p-5 shadow-[var(--shadow-panel)]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {stage === 'password' ? (
            <>
              <label
                htmlFor="gate-password"
                className="text-subtle mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
              >
                <Lock className="size-3" />
                {t('Password')}
              </label>
              <Input
                id="gate-password"
                autoFocus
                inputSize="lg"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                className="mb-3 w-full"
              />
            </>
          ) : (
            <>
              <label
                htmlFor="gate-code"
                className="text-subtle mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
              >
                <ShieldCheck className="size-3" />
                {t('Authenticator code')}
              </label>
              <Input
                id="gate-code"
                autoFocus
                inputSize="lg"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                autoComplete="one-time-code"
                className="mb-3 w-full"
              />
            </>
          )}
          {error && (
            <p className="text-bad mb-3 text-xs" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || (stage === 'password' ? !password : code.trim().length < 6)}
            className="w-full justify-center"
          >
            {busy ? 'Checking…' : stage === 'password' ? 'Continue' : 'Unlock'}
          </Button>
          {stage === 'code' && (
            <button
              type="button"
              onClick={backToPassword}
              className="text-subtle hover:text-fg mx-auto mt-3 flex items-center gap-1 text-xs"
            >
              <ChevronLeft className="size-3" />
              {t('Use a different password')}
            </button>
          )}
        </form>
        <p className="text-subtle mt-6 text-center text-xs">
          {t('Private instance — every game, study and puzzle here lives in plain files on its owner’s server.')}
        </p>
      </div>
    </div>
  );
}
