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
    <div className="bg-app text-fg grid h-[100dvh] place-items-center p-4">
      <div className="bg-surface border-line w-full max-w-xs rounded-xl border p-6 shadow-[var(--shadow-panel)]">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="bg-primary-soft grid size-9 place-items-center rounded-lg">
            <Lock className="text-primary size-4" />
          </div>
          <div>
            <h1 className="text-fg text-sm font-semibold">Chess Vault</h1>
            <p className="text-subtle text-xs">This vault is locked.</p>
          </div>
        </div>
        <Input
          autoFocus
          inputSize="lg"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="Password"
          className="mb-2 w-full"
        />
        {error && <p className="text-bad mb-2 text-xs">{error}</p>}
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={!password || busy}
          onClick={() => void submit()}
        >
          Unlock
        </Button>
      </div>
    </div>
  );
}
