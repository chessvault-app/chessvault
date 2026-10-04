import { useState } from 'react';
import QRCode from 'qrcode';
import { Eraser, ShieldCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, reauth, size, type HistoryLeaks, type Note, type Settings } from '@/settings/cards/shared';

// --- Security ----------------------------------------------------------------

export function SecurityCard({
  settings,
  leaks,
  onChanged,
  onHistoryRewritten,
}: {
  settings: Settings;
  /** What the history holds of old credentials, or null where it cannot say. */
  leaks: HistoryLeaks | null;
  onChanged: () => Promise<void>;
  /** The history was written again, and is smaller for it. */
  onHistoryRewritten: () => void;
}) {
  const held = leaks?.available === true && ((leaks.commits ?? 0) > 0 || leaks.pending === true);
  return (
    <Card icon={ShieldCheck} title={t('Security')}>
      {/* First, and only while there is something to take out: it is the
          one thing in this card that is wrong now rather than a choice. */}
      {held && leaks && (
        <>
          <HistorySecretsBlock leaks={leaks} settings={settings} onRewritten={onHistoryRewritten} />
          <Separator />
        </>
      )}
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
 * Old secrets and old files in the history, and the way to take them out.
 *
 * A vault older than the history's excludes, or one wiped before 0.12.1,
 * holds in earlier saves what the history never keeps
 * (server/historyExcludes.ts): config.json and sessions.json, with every
 * password hash, authenticator secret and Lichess token they ever held;
 * and, from such a wipe, the repo's own folder, every book's PDF, the
 * databases' PGN files and other leftovers. Each rides along in every
 * downloaded copy. The way out was git in a terminal
 * (server/historyPurge.ts does it now).
 *
 * In Security rather than Deleted documents: what it guards first is the
 * credentials, and what closes each one afterwards is in this card, in
 * the Lichess token card under it, or at Lichess. Shown only while the
 * history holds them. The server says which secrets it holds and whether
 * each is still the one in use, so the question and the line after it
 * name only those; and which files it holds and what they take, which the
 * block and the question list. A history whose copies of config.json hold
 * no secret (a wipe of a vault with no password and no token) is told it
 * holds old files, with nothing to change after.
 */
function HistorySecretsBlock({
  leaks,
  settings,
  onRewritten,
}: {
  leaks: HistoryLeaks;
  settings: Settings;
  onRewritten: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  /** Whether the line after it points at Lichess, where a token is deleted. */
  const [atLichess, setAtLichess] = useState(false);
  const held = heldOf(leaks);
  const files = filesOf(leaks, held);
  const after = afterwards(leaks, settings);

  const purge = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api('/api/history/purge', { method: 'POST' });
    } catch (e) {
      // Through t(): every refusal the route gives is a sentence the
      // dictionary has.
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    setBusy(false);
    setNote({ kind: 'ok', text: purgedLine(held, files.length > 0, after.lines) });
    setAtLichess(held === 'secrets' && after.lichess);
    onRewritten();
  };

  // Done: what is left to do, in the block's place, until the page is
  // read again. The heading and the offer are not true any more. A token
  // is deleted at Lichess, so the line carries the page that does it,
  // drawn as the Lichess token card draws its own link there.
  if (note?.kind === 'ok') {
    return (
      <div className="flex flex-col gap-2">
        <Feedback note={note} />
        {atLichess && (
          <a
            className="text-primary text-sm underline underline-offset-2"
            href="https://lichess.org/account/oauth/token"
            target="_blank"
            rel="noreferrer"
          >
            lichess.org/account/oauth/token
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">
        {held === 'secrets' ? t('Old secrets in the history') : t('Old files in the history')}
      </span>
      <p className="text-muted-foreground text-sm">
        {held === 'files'
          ? t('Removes the old files that earlier saves left in the change history, which every downloaded copy carries. Every version of every document stays.')
          : files.length > 0
            ? t('Removes the old secrets and old files that earlier saves left in the change history, which every downloaded copy carries. Every version of every document stays.')
            : t('Removes the old secrets that earlier saves left in the change history, which every downloaded copy carries. Every version of every document stays.')}
      </p>
      <HeldFilesList files={files} />
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => setAsking(true)}>
          {busy ? t('Removing…') : held === 'secrets' ? t('Remove old secrets') : t('Remove old files')}
        </Button>
        <Feedback note={note} />
      </div>
      {/* The default tone: nothing the owner wants is lost, which is what
          the question says first. The label is the window's title and its
          button too, and "Remove them from the history" was cut to
          "emove them from the histor" in that button at 1280 wide. Whole
          sentences, each its own string, so a translation never has to
          mend a sentence assembled from parts; what goes of the files is
          the same list the block shows, under the question. */}
      <ConfirmDialog
        icon={Eraser}
        tone="default"
        open={asking}
        onOpenChange={setAsking}
        question={
          held === 'files'
            ? t('Every version of every document stays, and only the old files below go. A copy downloaded before still holds them.')
            : [
                files.length > 0
                  ? t('Every version of every document stays, and only old secrets and the old files below go. A copy downloaded before still holds them.')
                  : t('Every version of every document stays, and only old secrets go. A copy downloaded before still holds them.'),
                ...after.lines,
              ].join(' ')
        }
        confirmLabel={held === 'secrets' ? 'Remove old secrets' : 'Remove old files'}
        onConfirm={() => void purge()}
      >
        <HeldFilesList files={files} />
      </ConfirmDialog>
    </div>
  );
}

/** What the history holds, as the block words it: secrets, or only old
    files (copies of config.json with no secret in them among them). */
type Held = 'secrets' | 'files';

function heldOf(leaks: HistoryLeaks): Held {
  const kinds = leaks.secrets;
  // Where the server cannot tell (a purge cut off part way, an older
  // server), credentials are taken for secrets: the worse case.
  if (!kinds) return (leaks.credentials ?? 0) > 0 || leaks.pending === true ? 'secrets' : 'files';
  return [kinds.password, kinds.totp, kinds.token].some((kind) => kind.current || kind.past > 0) ? 'secrets' : 'files';
}

/** One kind of old file the history holds: what the block calls it, and
    what it takes there, where the server says. */
interface HeldFile {
  label: string;
  bytes: number | null;
}

/**
 * The old files the history holds, one line a kind, in the order that
 * matters most to the owner: what is not theirs to pass on (a book's PDF)
 * and what is biggest (the databases' PGN files) first. The copies of
 * config.json are old files only where they hold no secret; where they
 * hold one, they are the secrets the heading names.
 */
function filesOf(leaks: HistoryLeaks, held: Held): HeldFile[] {
  const bytes = leaks.bytes ?? {};
  const files: HeldFile[] = [];
  if ((leaks.books ?? 0) > 0) files.push({ label: 'Book PDFs and their caches', bytes: bytes.books ?? null });
  if ((leaks.sources ?? 0) > 0) files.push({ label: 'PGN files for the databases', bytes: bytes.sources ?? null });
  if ((leaks.folder ?? 0) > 0) files.push({ label: 'A copy of the history’s own files', bytes: bytes.folder ?? null });
  if ((leaks.other ?? 0) > 0) files.push({ label: 'Other leftover files', bytes: bytes.other ?? null });
  if (held === 'files' && (leaks.credentials ?? 0) > 0) files.push({ label: 'Copies of the vault’s settings, with no secret in them', bytes: null });
  return files;
}

/** The old files, each with its size beside it: the block's list, and the
    question's. Nothing for a history that holds only secrets. */
function HeldFilesList({ files }: { files: HeldFile[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="text-muted-foreground flex flex-col gap-1 text-left text-sm">
      {files.map(({ label, bytes }) => (
        <li key={label} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">{t(label)}</span>
          {bytes !== null && <span className="shrink-0 tabular-nums">{size(bytes)}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * What a copy downloaded before still holds that is worth acting on, one
 * whole sentence each, saying what closes it and where.
 *
 * A secret matters only while it still works. The password and the 2FA
 * secret in use are changed in this card, which makes the copies in the
 * history worthless. A password no longer in use works wherever it still
 * is in use, which only its owner knows. A Lichess token works at Lichess
 * until it is deleted there, and saving or removing one in the Lichess
 * token card does not delete it (server/settings.ts only writes
 * config.json), so every token the history holds is deleted at Lichess.
 * A 2FA secret no longer in use works nowhere, and is not named.
 *
 * Where the server cannot tell which it holds, what is set now is named,
 * as what may be among them.
 */
function afterwards(leaks: HistoryLeaks, settings: Settings): { lines: string[]; lichess: boolean } {
  const kinds = leaks.secrets;
  const lines: string[] = [];
  if (!kinds) {
    if (settings.gate) lines.push(t('The app password in use may be among them: change it in this card.'));
    if (settings.totp) lines.push(t('The 2FA secret in use may be among them: turn 2FA off and set it up again in this card.'));
    if (settings.lichess.configured) {
      lines.push(t('The Lichess token in use may be among them: delete it at Lichess and save a new one in the Lichess token card.'));
    }
    return { lines, lichess: settings.lichess.configured };
  }
  const { password, totp, token } = kinds;
  if (password.current) lines.push(t('The app password in use is among them: change it in this card.'));
  if (password.past === 1) lines.push(t('An app password this vault no longer uses is among them: change it wherever you still use it.'));
  if (password.past > 1) lines.push(t('App passwords this vault no longer uses are among them: change them wherever you still use them.'));
  if (totp.current) lines.push(t('The 2FA secret in use is among them: turn 2FA off and set it up again in this card.'));
  if (token.current) lines.push(t('The Lichess token in use is among them: delete it at Lichess and save a new one in the Lichess token card.'));
  if (token.past === 1) lines.push(t('A Lichess token this vault no longer uses is among them: delete it at Lichess.'));
  if (token.past > 1) lines.push(t('Lichess tokens this vault no longer uses are among them: delete them at Lichess.'));
  return { lines, lichess: token.current || token.past > 0 };
}

/** What is left to do once the history no longer holds them: the same
    sentences the question gave, after what is done. */
function purgedLine(held: Held, withFiles: boolean, lines: string[]): string {
  if (held === 'files') return t('The old files are out of the history.');
  const done = withFiles ? t('The old secrets and old files are out of the history.') : t('The old secrets are out of the history.');
  if (lines.length === 0) return done;
  return [done, t('A copy downloaded before still holds them.'), ...lines].join(' ');
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
