import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/skeletons';
import { Crown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { forgetTablebaseAnswers } from '@/explorer/tablebase';
import { Field } from '@/components/ui/field';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { ClearableInput } from '@/components/text-fields';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';
import { api, apiErrorMessage } from '@/lib/api';
import { usePrefs } from '@/store/prefs';
import { t } from '@/lib/i18n';
import { Feedback, size, type Note, type Settings, type VaultShell } from '@/settings/cards/shared';

/**
 * The one lookup the app makes without being asked for it.
 *
 * Every other online source in the app is chosen — the explorer's
 * Lichess databases are picked from a switcher and need a token of your
 * own. The tablebase is not picked: it answers whenever the position is
 * small enough, which is what makes it useful and what makes this switch
 * necessary. The blurb says where the position goes and what is kept,
 * because a setting that hides its cost is not a choice.
 *
 * Beside the token card rather than under Documents: both cards are
 * about what this vault says to somebody else's server.
 */
export function TablebaseCard({
  settings,
  onChanged,
  onCleared,
}: {
  settings: Settings;
  onChanged: () => Promise<void>;
  /** Say so when the cache folder has been emptied: Storage used counts
      it, and it does not re-read on its own. */
  onCleared: () => void;
}) {
  const tablebase = usePrefs((p) => p.tablebase);
  const setTablebase = usePrefs((p) => p.setTablebase);
  const [url, setUrl] = useState(settings.tablebase.url ?? '');
  const [dir, setDir] = useState(settings.tablebase.dir ?? '');
  const [note, setNote] = useState<Note>(null);
  /** null while it is being read, 'unknown' if the read failed. */
  const [cache, setCache] = useState<{ answers: number; bytes: number } | 'unknown' | null>(null);
  /** Counts this card's own clearings — a re-read, not a poll. */
  const [cacheStamp, setCacheStamp] = useState(0);
  const source = settings.tablebase.source;
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;

  /**
   * What the cache holds, which is what the button is about to throw
   * away. Nothing else on this card needs the server, so it is read
   * apart from the settings that drew the page; a failure leaves the
   * figures unsaid rather than the card broken.
   */
  useEffect(() => {
    // Nothing shows the figures while the switch is off, so nothing asks
    // for them; turning it on is what sends the request.
    if (!tablebase) return;
    void api<{ answers: number; bytes: number }>('/api/tablebase/cache')
      .then((held) => setCache({ answers: held.answers, bytes: held.bytes }))
      // Not back to null, which is the skeleton: a card that cannot read
      // the figures would have sat on a placeholder for good. An em dash
      // is what Storage used shows for an area it could not measure, and
      // the button stays live, because "we do not know" is not "empty".
      .catch(() => setCache('unknown'));
  }, [cacheStamp, tablebase]);

  /**
   * Follow the server when it changes under us.
   *
   * These boxes are local state seeded from the settings, and `useState`
   * seeds ONCE — so a card that mounted before an answer arrived, or
   * while a value was unset, kept showing the stale one after every
   * refresh. That is not just a wrong-looking box: the Save beside it
   * compares against the SERVER's value, so an empty box next to a
   * configured folder is an enabled Save that would delete the folder.
   * The settings only move as a result of this card's own saves, so
   * following them costs no typing.
   */
  useEffect(() => {
    setUrl(settings.tablebase.url ?? '');
  }, [settings.tablebase.url]);
  useEffect(() => {
    setDir(settings.tablebase.dir ?? '');
  }, [settings.tablebase.dir]);

  const pick = async (next: 'lichess' | 'server' | 'files'): Promise<void> => {
    try {
      await api('/api/settings/tablebase-source', { method: 'PUT', json: { source: next } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote(null);
    await onChanged();
  };

  const save = async (path: string, json: unknown): Promise<void> => {
    try {
      await api(path, { method: 'PUT', json });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('Saved.') });
    await onChanged();
  };

  const forget = async (): Promise<void> => {
    try {
      await api('/api/tablebase/cache', { method: 'DELETE' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      // Both re-read anyway, the way Browsed games re-reads: the delete
      // walks a folder and can fail part way through it, so a failure is
      // not a promise that the figures are unchanged.
      onCleared();
      setCacheStamp((n) => n + 1);
      return;
    }
    // The tab remembers this session's answers too, and a cleared server
    // with a full page memo would be a button that only half worked.
    forgetTablebaseAnswers();
    onCleared();
    // No line of green saying how many went. It was the app's SUCCESS
    // colour on a discard, it never cleared, and it grew the card by 32px
    // — measured — so Browsed games and Storage used both jumped down as
    // you read it. The row's own figures falling to nothing say the same
    // thing in the place you were already looking, and cost no height.
    setCacheStamp((n) => n + 1);
  };

  /**
   * What is answering, where the select does not already say it.
   *
   * The panel used to make you work this out: three controls with a
   * precedence between them that was never written down, so "am I on
   * Lichess or my own tables, and does the switch matter?" had no answer
   * on the screen. One sentence settled it — and then two of its three
   * cases became the select's own value in a full sentence, because the
   * three controls became one. "Lichess's public tablebase" over
   * "Answering from Lichess's public tablebase." is a paragraph of grey
   * saying what the control above it already says.
   *
   * Table files keep it, and are the reason it exists at all: they are
   * the one choice that can be SET and not be answering, because a path
   * that has gone missing or a build with no native binary falls back to
   * Lichess in silence. There the line is the only thing on the card
   * that can tell working from fallen back.
   */
  const answering = settings.tablebase.local
    ? t('Answering from the table files on the server, nothing else involved.')
    : t('Set to your own table files, but they cannot be read. Lichess’s public server is answering instead.');

  return (
    <Card icon={Crown} title={t('Tablebase')} anchor="tablebase">
      <SettingRow
        title={t('Use the tablebase')}
        blurb={
          tablebase
            ? t(
                'Show the exact result for positions of seven pieces or fewer in the explorer and the engine review. This device only. The source is the vault setting below.',
              )
            : // Nothing is below while this is off, so it does not promise one.
              t(
                'Show the exact result for positions of seven pieces or fewer, in the explorer and the engine review. This device only.',
              )
        }
      >
        <Switch
          checked={tablebase}
          onCheckedChange={() => setTablebase(!tablebase)}
          aria-label={t('Use the tablebase')}
        />
      </SettingRow>

      {tablebase && (
        <>
          {/* One choice, not three controls with a hidden order between
              them. The field a choice needs appears under it and nothing
              else does; the others keep whatever was typed in them, since
              the choice is stored rather than inferred from which box is
              full (server/tablebase.ts). */}
          <div className="flex flex-col gap-2">
            {/* A Field and a Select, because that is what a choice looks
                like on this page — App theme, Density, Colour, Board,
                Pieces, Castling and both sounds are all this shape, and
                a segmented strip here would have been the only one of
                its kind on the page. All three options are offered
                wherever you are looking from: only the PATH BOX below is
                a question a remote client cannot answer, and a server
                that holds the tables is an ordinary setup its owner must
                be able to see and change from a phone. */}
            <Field label={t('Answers come from')}>
              <Select
                value={source}
                onValueChange={(v) => void pick(v as 'lichess' | 'server' | 'files')}
                ariaLabel={t('Answers come from')}
                groups={[
                  {
                    options: [
                      { value: 'lichess', label: t('Lichess’s public tablebase') },
                      { value: 'server', label: t('A tablebase server of your own') },
                      { value: 'files', label: t('Table files on the server') },
                    ],
                  },
                ]}
              />
            </Field>
            {source === 'files' && <p className="text-muted-foreground text-sm">{answering}</p>}
          </div>

          {source === 'server' && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                {t(
                  'A tablebase server of your own: lila-tablebase over your own tables, or any address that speaks its protocol. Empty falls back to Lichess.',
                )}
              </p>
              <div className="flex items-center gap-2">
                <ClearableInput
                  inputSize="lg"
                  className="flex-1"
                  autoComplete="off"
                  placeholder={settings.tablebase.fallback}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-label={t('Tablebase server')}
                />
                <Button
                  variant="default"
                  disabled={url.trim() === (settings.tablebase.url ?? '')}
                  onClick={() => void save('/api/settings/tablebase', { url })}
                >
                  {t('Save')}
                </Button>
              </div>
            </div>
          )}

          {source === 'files' && settings.tablebase.sameMachine && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                {t(
                  'A folder of Syzygy files on this device, read directly with nothing else running. Needs the native core built.',
                )}
              </p>
              <div className="flex items-center gap-2">
                <ClearableInput
                  inputSize="lg"
                  className="min-w-0 flex-1"
                  autoComplete="off"
                  placeholder={t('A folder of .rtbw and .rtbz files')}
                  value={dir}
                  onChange={(e) => setDir(e.target.value)}
                  aria-label={t('Tablebase files')}
                />
                {/* Only in the desktop shell, which is the only place a
                    folder can become a path: browsers hand out relative
                    names or opaque handles, never something a server can
                    open. Absent elsewhere rather than present and
                    broken, the way DesktopCard treats the same bridge.
                    It fills the box; Save still commits, so picking by
                    mistake costs nothing. */}
                {shell?.pickFolder && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void shell.pickFolder?.(t('Choose the folder of Syzygy tables')).then(
                        (picked) => {
                          if (picked) setDir(picked);
                        },
                      );
                    }}
                  >
                    {t('Choose…')}
                  </Button>
                )}
                <Button
                  variant="default"
                  disabled={dir.trim() === (settings.tablebase.dir ?? '')}
                  onClick={() => void save('/api/settings/tablebase-dir', { dir })}
                >
                  {t('Save')}
                </Button>
              </div>
            </div>
          )}

          {/* Not offered from a phone pointed at a server in another
              room: a text box asking for a path on a disk you cannot see
              is a question nobody can answer, and one that used to tell
              anybody who asked which paths existed there. It is a
              deployment setting in that case, and says so. */}
          {source === 'files' && !settings.tablebase.sameMachine && (
            <p className="text-muted-foreground text-sm">
              {settings.tablebase.dir
                ? t('This server also has table files at {dir}, set in its vault config.', {
                    dir: settings.tablebase.dir,
                  })
                : t(
                    'To answer from table files on the server itself, set “tablebaseDir” in its vault config. A path cannot be typed from another device.',
                  )}
            </p>
          )}

          {/* The cache never expires, which is right for a fact and wrong
              for a source that has since learned something: add the
              six-piece tables to the machine above and every six-piece
              ending you had already looked at still answers "nothing
              here", because nothing asks it again. This is how you ask
              again — and the way to take the disk back, and to stop
              keeping a record of which endings you studied. */}
          {/* Shaped like a row of Browsed games and of Storage used, which
              is how this page says "here is something you are holding":
              named on the left, measured on the right, emptied by the bin
              at the end. It was a sentence and a ghost button reading
              "Forget cached answers" — the only cache control on the page
              not called Clear, and one that never said what it was about
              to throw away, so the size had to be read off the Storage
              used card two below. That is also the shape the manual has
              been describing all along. */}
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('Answers are kept for good, so each ending is asked about once.')}
          </p>
          <div className="border-border rounded-lg border">
            <div className="flex items-center gap-2 py-(--row-py-dense) pl-3 pr-1.5">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate type-row">{t('Cached answers')}</p>
                {/* h-5: the line box the figures stand in, held while they
                    are unknown so the row does not change height when they
                    arrive — the trick the Browsed games rows use. */}
                {cache === null ? (
                  <span className="flex h-5 shrink-0 items-center">
                    <Skeleton className="h-2.5 w-24" />
                  </span>
                ) : (
                  <p className="text-muted-foreground shrink-0 type-row-sub tabular-nums">
                    {cache === 'unknown'
                      ? '—'
                      : cache.answers === 0
                        ? t('Nothing cached')
                        : `${cache.answers.toLocaleString()} · ${size(cache.bytes)}`}
                  </p>
                )}
              </div>
              {/* No confirmation, the same reasoning as the bins below:
                  this is a cache, and what it costs to be wrong is one
                  request per position the next time each is looked at. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                disabled={cache !== null && cache !== 'unknown' && cache.answers === 0}
                title={t('Clear cached answers')}
                onClick={() => void forget()}
              >
                <Trash2 className="glyph" />
              </Button>
            </div>
          </div>
        </>
      )}
      <Feedback note={note} />
    </Card>
  );
}
