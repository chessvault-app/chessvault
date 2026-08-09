import { Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/**
 * Wraps the app when the server has an appPassword configured (public
 * deployments): everything under /api answers 401 until the session cookie
 * is set, so the shell shows a lock screen instead of a broken app. When
 * no password is configured (local use) the status check passes straight
 * through and this renders nothing extra.
 */
export function PasswordGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d: { required: boolean; authed: boolean }) =>
        setState(d.required && !d.authed ? 'locked' : 'open'),
      )
      // If the server is unreachable the app shows its own errors; don't
      // trap the user on a lock screen for that.
      .catch(() => setState('open'));
  }, []);

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <div className="bg-app h-[100dvh]" />;

  const submit = async (): Promise<void> => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      setState('open');
      return;
    }
    setError(
      res.status === 429
        ? 'Too many attempts — wait a few minutes.'
        : 'Wrong password.',
    );
    setPassword('');
  };

  return (
    <div className="bg-app text-fg flex h-[100dvh] flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center">
        {/* The same knight as the sidebar — the lock screen is the front
            door, so it wears the brand, not a padlock. */}
        <div className="bg-primary text-primary-fg mb-5 grid size-14 place-items-center rounded-2xl shadow-[var(--shadow-panel)]">
          <svg viewBox="4.5 5 36 36" className="size-8" fill="currentColor" aria-hidden>
            <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 Z M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 Z" />
          </svg>
        </div>
        <h1 className="text-fg text-xl font-semibold tracking-tight">Chess Vault</h1>
        <p className="text-subtle mb-6 mt-1 text-sm">Your chess, on your disk.</p>

        <form
          className="bg-surface border-line w-full rounded-2xl border p-5 shadow-[var(--shadow-panel)]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="text-subtle mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
            <Lock className="size-3" />
            Password
          </label>
          <Input
            autoFocus
            inputSize="lg"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="current-password"
            className="mb-3 w-full"
          />
          {error && (
            <p className="text-bad mb-3 text-xs" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || !password}
            className="w-full justify-center"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
        <p className="text-subtle mt-6 text-center text-xs">
          Private instance — every game, study and puzzle here lives in plain files on its
          owner&rsquo;s server.
        </p>
      </div>
    </div>
  );
}
