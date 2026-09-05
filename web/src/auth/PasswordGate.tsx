import { ChevronLeft, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
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
    // Raw fetch DELIBERATELY, here and in submit(): this component is the
    // 401 handler api() reports to, so routing its own auth traffic
    // through api() would re-trigger the relock it implements. Do not
    // migrate these to api().
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
  if (state === 'checking') return <div className="bg-background h-[100dvh]" />;

  // `completed` is the code as InputOTP just completed it, when its sixth
  // digit submits: the state update that carries it may not have landed.
  const submit = async (completed?: string): Promise<void> => {
    if (busy) return;
    const otp = completed ?? code;
    if (stage === 'password' ? !password : otp.trim().length < 6) return;
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      // Raw fetch on purpose — a wrong password answers 401, and through
      // api() that 401 would invoke the very relock this screen exists to
      // resolve (see the note on the status probe above).
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Stage one sends the password alone; the server replies needTotp
        // when an authenticator is configured.
        body: JSON.stringify(stage === 'code' ? { password, code: otp } : { password }),
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
      setError(t('Too many attempts. Wait a few minutes.'));
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
    <div className="bg-background text-foreground flex h-[100dvh] flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        {/* The same mark as the sidebar — the lock screen is the front
            door, so it wears the brand, not a padlock. Bare, like the
            sidebar's and the home header's: everywhere the mark appears
            it is line-work in the surrounding ink, and a ground survives
            only on the icons an OS composites onto grounds the image
            cannot see (apple-touch, the desktop installers). */}
        <BrandMark className="mb-5 size-10" />
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{t('Chess Vault')}</h1>
        <p className="text-muted-foreground mb-6 mt-1 text-base">{t('Your chess, in plain files.')}</p>

        <form
          className="bg-card border-border w-full rounded-2xl border p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {stage === 'password' ? (
            <>
              <Field className="mb-3">
                <FieldLabel htmlFor="gate-password" className="gap-1.5">
                  <Lock className="size-3" />
                  {t('Password')}
                </FieldLabel>
                <Input
                  id="gate-password"
                  autoFocus
                  inputSize="lg"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  className="w-full"
                />
              </Field>
            </>
          ) : (
            <>
              <Field className="mb-3">
                <FieldLabel htmlFor="gate-code" className="gap-1.5">
                  <ShieldCheck className="size-3" />
                  {t('Authenticator code')}
                </FieldLabel>
                {/* shadcn's InputOTP (lanph3re's call), two groups of three
                    like every authenticator app prints the code, each digit in
                    its own cell so the focus ring never overlaps a neighbour.
                    The sixth digit submits: a code is never longer, so there
                    is nothing to press after it. Digits only, and
                    one-time-code lets iOS offer the code from Messages. */}
                <InputOTP
                  id="gate-code"
                  autoFocus
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={setCode}
                  onComplete={(value) => void submit(value)}
                  containerClassName="justify-center gap-4"
                >
                  <InputOTPGroup className="gap-1.5">
                    <InputOTPSlot index={0} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                    <InputOTPSlot index={1} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                    <InputOTPSlot index={2} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                  </InputOTPGroup>
                  <InputOTPGroup className="gap-1.5">
                    <InputOTPSlot index={3} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                    <InputOTPSlot index={4} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                    <InputOTPSlot index={5} className="size-10 rounded-md border border-input text-lg data-[active=true]:border-ring first:rounded-md last:rounded-md first:border-l" />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            </>
          )}
          {error && (
            <p className="text-destructive mb-3 text-sm" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="default"
            size="default"
            disabled={busy || (stage === 'password' ? !password : code.trim().length < 6)}
            className="w-full justify-center"
          >
            {t(busy ? 'Checking…' : stage === 'password' ? 'Continue' : 'Unlock')}
          </Button>
          {stage === 'code' && (
            <button
              type="button"
              onClick={backToPassword}
              className="text-muted-foreground hover:text-foreground mx-auto mt-3 flex items-center gap-1 text-sm"
            >
              <ChevronLeft className="size-3" />
              {t('Use a different password')}
            </button>
          )}
        </form>
        <p className="text-muted-foreground mt-6 text-center text-sm">
          {t('Private instance. Every game, study and puzzle here lives in plain files on its owner’s server.')}
        </p>
      </div>
    </div>
  );
}
