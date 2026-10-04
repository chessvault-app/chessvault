import { useState } from 'react';
import QRCode from 'qrcode';
import { Eraser, ShieldCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { Feedback, reauth, type HistoryLeaks, type Note, type Settings } from '@/settings/cards/shared';

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
  /** The history was written again, and is smaller for it; `token`, the
      token in use was sent to Lichess to be deleted, and the server may
      have taken it out of the vault. */
  onHistoryRewritten: (token: boolean) => void;
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
 * Old credentials in the history, and the way to take them out.
 *
 * A vault older than the history's excludes, or one wiped before 0.12.1,
 * holds config.json and sessions.json in earlier saves, and a wipe's may
 * hold the repo's own folder: every password hash, authenticator secret and
 * Lichess token they ever held rides along in each downloaded copy. The
 * way out was git in a terminal (server/historyPurge.ts does it now).
 *
 * In Security rather than Deleted documents: what it guards is the
 * credentials, and what closes each one afterwards is in this card, in
 * the Lichess token card under it, or at Lichess. Shown only while the
 * history holds them. The server says which secrets it holds and whether
 * each is still the one in use, so the question and the line after it
 * name only those; a history whose copies of config.json hold none (a
 * wipe of a vault with no password and no token), or that holds only the
 * folder (a wipe of a vault with no config.json yet), is told so, with
 * nothing to change after.
 *
 * Of those, a Lichess token is the one nothing in this vault closes, so
 * where the history holds any the question also offers to delete them at
 * Lichess (TokenChoice). Off until ticked: it is a request to a third party
 * on the user's account, and the user is who decides to send it.
 */
function HistorySecretsBlock({
  leaks,
  settings,
  onRewritten,
}: {
  leaks: HistoryLeaks;
  settings: Settings;
  onRewritten: (token: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  /** Whether the line after it points at Lichess, where a token is deleted. */
  const [atLichess, setAtLichess] = useState(false);
  /** Which tokens the user chose to have deleted at Lichess. */
  const [chosen, setChosen] = useState<TokenAsk>(NONE);
  const held = heldOf(leaks);
  const offer = tokenOffer(leaks, held);
  const after = afterwards(leaks, settings, offer ? 'offered' : 'advise');

  const purge = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    // Only what is offered and ticked: a tick cannot outlive its row.
    const asked: TokenAsk = { past: (offer?.past ?? 0) > 0 && chosen.past, current: offer?.current === true && chosen.current };
    let reply: PurgeReply | undefined;
    try {
      reply = await api<PurgeReply>('/api/history/purge', { method: 'POST', json: { revokeTokens: asked } });
    } catch (e) {
      // Through t(): every refusal the route gives is a sentence the
      // dictionary has.
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    // What Lichess said, as the server counted it; where it says nothing
    // (an older server), each token keeps the advice to delete it there.
    const done = afterwards(leaks, settings, { asked, answered: reply?.tokens ?? null });
    setBusy(false);
    setNote({ kind: 'ok', text: purgedLine(held, done) });
    setAtLichess(held === 'secrets' && done.lichess);
    onRewritten(asked.current);
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
        {held === 'secrets'
          ? t('Removes the old secrets that earlier saves left in the change history, which every downloaded copy carries. Every version of every document stays.')
          : held === 'settings'
            ? t('Removes the old copies of the vault’s settings that earlier saves left in the change history, which every downloaded copy carries. They hold no password, 2FA secret or token.')
            : t('Removes the copy of the history’s own files that earlier saves left in it, which every downloaded copy carries. Every version of every document stays.')}
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            // Every question starts with nothing to send to Lichess.
            setChosen(NONE);
            setAsking(true);
          }}
        >
          {busy ? t('Removing…') : held === 'secrets' ? t('Remove old secrets') : t('Remove old files')}
        </Button>
        <Feedback note={note} />
      </div>
      {/* The default tone: nothing the owner wants is lost, which is what
          the question says first. The label is the window's title and its
          button too, and "Remove them from the history" was cut to
          "emove them from the histor" in that button at 1280 wide. Whole
          sentences, each its own string, so a translation never has to
          mend a sentence assembled from parts. A token offered below is
          left out of the question: its row says what happens to it. */}
      <ConfirmDialog
        icon={Eraser}
        tone="default"
        open={asking}
        onOpenChange={setAsking}
        question={
          held === 'secrets'
            ? [t('Every version of every document stays, and only old secrets go. A copy downloaded before still holds them.'), ...after.lines].join(' ')
            : held === 'settings'
              ? t('Every version of every document stays, and only the old copies of the vault’s settings go. A copy downloaded before still holds them.')
              : t('Every version of every document stays, and only the copy of the history’s own files goes. A copy downloaded before still holds it.')
        }
        confirmLabel={held === 'secrets' ? 'Remove old secrets' : 'Remove old files'}
        onConfirm={() => void purge()}
      >
        {offer && <TokenChoice offer={offer} value={chosen} onChange={setChosen} />}
      </ConfirmDialog>
    </div>
  );
}

/** Which tokens to delete at Lichess, as the purge's request says it. */
interface TokenAsk {
  /** The ones this vault no longer uses. */
  past: boolean;
  /** The one in use. */
  current: boolean;
}

const NONE: TokenAsk = { past: false, current: false };

/** What Lichess said to the tokens of one kind (server/historyPurge.ts). */
interface RevokeCount {
  revoked: number;
  invalid: number;
  failed: number;
}

/** What POST /api/history/purge answers, as far as this block reads it. */
interface PurgeReply {
  /** Null where none was asked for, or none could be read. */
  tokens?: { past: RevokeCount; current: RevokeCount } | null;
}

/** Which tokens the history holds to offer: those no longer in use, and
    whether the one in use is among them. Null where it holds none, or
    where the server cannot say which it holds (the old advice stands). */
function tokenOffer(leaks: HistoryLeaks, held: Held): { past: number; current: boolean } | null {
  const token = leaks.secrets?.token;
  if (held !== 'secrets' || !token || (token.past === 0 && !token.current)) return null;
  return { past: token.past, current: token.current };
}

/**
 * The question's choice to delete the tokens at Lichess: one row for the
 * tokens this vault no longer uses and one for the token in use, each
 * there only where the history holds it.
 *
 * Two rows, because the two cost different things. An old token is used
 * by nothing here, so deleting it costs nothing. The token in use is what
 * the online explorer and the import of private studies run on (public
 * ones need none), and deleting it stops both until a new one is saved,
 * since the server takes it out of the vault as well; offered as its own
 * row, it is a
 * cost the user takes on knowingly, and never as a side effect of the
 * first. Both start off (HistorySecretsBlock says why). The rows are the
 * puzzle rebuild's (DumpSourceChoice): the mark, the answer, and what it
 * does under it.
 */
function TokenChoice({
  offer,
  value,
  onChange,
}: {
  offer: { past: number; current: boolean };
  value: TokenAsk;
  onChange: (value: TokenAsk) => void;
}) {
  const rows: { kind: keyof TokenAsk; label: string; blurb: string }[] = [];
  if (offer.past === 1) {
    rows.push({
      kind: 'past',
      label: t('Delete the old Lichess token at Lichess'),
      blurb: t('The server asks Lichess to delete it. Otherwise, delete it there yourself.'),
    });
  }
  if (offer.past > 1) {
    rows.push({
      kind: 'past',
      label: t('Delete the old Lichess tokens at Lichess'),
      blurb: t('The server asks Lichess to delete them. Otherwise, delete them there yourself.'),
    });
  }
  if (offer.current) {
    rows.push({
      kind: 'current',
      label: t('Delete the Lichess token in use at Lichess'),
      blurb: t('The online opening explorer and private study imports stop until you save a new token.'),
    });
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ kind, label, blurb }) => (
        <label key={kind} className="flex cursor-pointer items-start gap-2 text-left">
          {/* mt-0.5 lines the 16px box up with the first line of the
              label; iOS draws a 22px circle, which -mt-px centres on it. */}
          <Checkbox
            className="mt-0.5 ios:-mt-px"
            checked={value[kind]}
            onCheckedChange={(on) => onChange({ ...value, [kind]: on === true })}
          />
          <span className="text-sm">
            {label}
            <span className="text-muted-foreground block">{blurb}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** What the history holds, as the block words it: secrets; copies of
    config.json with none in them; or only the history's own folder. */
type Held = 'secrets' | 'settings' | 'files';

function heldOf(leaks: HistoryLeaks): Held {
  const kinds = leaks.secrets;
  // Where the server cannot tell (a purge cut off part way, an older
  // server), credentials are taken for secrets: the worse case.
  if (!kinds) return (leaks.credentials ?? 0) > 0 || leaks.pending === true ? 'secrets' : 'files';
  if ([kinds.password, kinds.totp, kinds.token].some((kind) => kind.current || kind.past > 0)) return 'secrets';
  return (leaks.credentials ?? 0) > 0 ? 'settings' : 'files';
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
 *
 * The tokens are said as `tokens` asks. `advise`: each kind gets its
 * advice. `offered`: none, since the question's own rows say what
 * becomes of them. After a purge, `asked` and what Lichess `answered`: a
 * kind that was not asked for, or that the server says nothing about,
 * gets its advice; one Lichess deleted, or no longer knew, is said in
 * `done`, as what was done; one it could not be reached for is advised
 * again, as left to do.
 */
function afterwards(
  leaks: HistoryLeaks,
  settings: Settings,
  tokens: 'advise' | 'offered' | { asked: TokenAsk; answered: PurgeReply['tokens'] | null },
): { done: string[]; lines: string[]; lichess: boolean } {
  const kinds = leaks.secrets;
  const done: string[] = [];
  const lines: string[] = [];
  if (!kinds) {
    if (settings.gate) lines.push(t('The app password in use may be among them: change it in this card.'));
    if (settings.totp) lines.push(t('The 2FA secret in use may be among them: turn 2FA off and set it up again in this card.'));
    if (settings.lichess.configured) {
      lines.push(t('The Lichess token in use may be among them: delete it at Lichess and save a new one in the Lichess token card.'));
    }
    return { done, lines, lichess: settings.lichess.configured };
  }
  const { password, totp, token } = kinds;
  if (password.current) lines.push(t('The app password in use is among them: change it in this card.'));
  if (password.past === 1) lines.push(t('An app password this vault no longer uses is among them: change it wherever you still use it.'));
  if (password.past > 1) lines.push(t('App passwords this vault no longer uses are among them: change them wherever you still use them.'));
  if (totp.current) lines.push(t('The 2FA secret in use is among them: turn 2FA off and set it up again in this card.'));
  let lichess = false;
  /** What Lichess said to one kind, where it was asked and says. */
  const answer = (kind: keyof TokenAsk): RevokeCount | null =>
    typeof tokens === 'object' && tokens.asked[kind] ? (tokens.answered?.[kind] ?? null) : null;

  /** Said after the old tokens, since it ends on what to do next. */
  let inUseDone: string | null = null;
  if (token.current && tokens !== 'offered') {
    const said = answer('current');
    if (!said) {
      lines.push(t('The Lichess token in use is among them: delete it at Lichess and save a new one in the Lichess token card.'));
      lichess = true;
    } else if (said.revoked > 0) {
      inUseDone = t('Lichess deleted the token in use: save a new one in the Lichess token card.');
    } else if (said.invalid > 0) {
      inUseDone = t('The token in use was already gone at Lichess: save a new one in the Lichess token card.');
    } else if (said.failed > 0) {
      lines.push(t('The token in use could not be deleted from here: delete it at Lichess and save a new one in the Lichess token card.'));
      lichess = true;
    }
    // None of the three: by the time the server read config.json the
    // token in use was another, which the history does not hold.
  }
  if (token.past > 0 && tokens !== 'offered') {
    const said = answer('past');
    if (!said) {
      lines.push(
        token.past === 1
          ? t('A Lichess token this vault no longer uses is among them: delete it at Lichess.')
          : t('Lichess tokens this vault no longer uses are among them: delete them at Lichess.'),
      );
      lichess = true;
    } else {
      // Counted by the server, which finds more than the page was told
      // when the token in use was replaced since from another device.
      if (said.revoked === 1) done.push(t('Lichess deleted 1 old token.'));
      if (said.revoked > 1) done.push(t('Lichess deleted {n} old tokens.', { n: said.revoked }));
      if (said.invalid === 1) done.push(t('1 old token was already gone at Lichess.'));
      if (said.invalid > 1) done.push(t('{n} old tokens were already gone at Lichess.', { n: said.invalid }));
      if (said.failed === 1) lines.push(t('1 old token could not be deleted from here: delete it at Lichess.'));
      if (said.failed > 1) lines.push(t('{n} old tokens could not be deleted from here: delete them at Lichess.', { n: said.failed }));
      if (said.failed > 0) lichess = true;
    }
  }
  if (inUseDone) done.push(inUseDone);
  return { done, lines, lichess };
}

/** What is left to do once the history no longer holds them: what was
    done at Lichess, then the question's sentences for what is not. */
function purgedLine(held: Held, { done, lines }: { done: string[]; lines: string[] }): string {
  if (held === 'files') return t('The history no longer holds a copy of its own files.');
  if (held === 'settings') return t('The history no longer holds old copies of the vault’s settings.');
  const left = lines.length === 0 ? [] : [t('A copy downloaded before still holds them.'), ...lines];
  return [t('The old secrets are out of the history.'), ...done, ...left].join(' ');
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
