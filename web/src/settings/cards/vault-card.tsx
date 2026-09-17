import { useEffect, useState } from 'react';
import { SkeletonVaultTree, useSlowLoad } from '@/components/skeletons';
import { copyText } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { VAULT_ROWS, VaultTree, type VaultRow } from '@/components/vault-tree';
import { DEMO_VAULT_NOTE, SettingsCard as Card, VAULT_COPY_NOTE, VAULT_NAME_NOTE, VAULT_ROWS_KEY, readVaultPaths } from '@/settings/SettingsPage.skeleton';
import { toast } from '@/components/ui/toast';
import { ClearableInput } from '@/components/text-fields';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { BrandMark } from '@/components/brand-mark';
import { setVaultName } from '@/lib/vaultName';
import { Feedback, size, type Note, type Settings, type StorageReport } from '@/settings/cards/shared';

// --- Vault name ----------------------------------------------------------------
// Its own card, not a second name in Profile: "Display name" is the
// person's, and two name fields side by side read as one thing. The
// placeholder is what the sidebar shows without a name, so blanking the
// field is not a mystery.

/** The card's listing, read off the page's one /api/storage answer
    (useStorage). config.json is a file rather than an area, so its
    figures come from the vault folder's own. */
function vaultRows(report: StorageReport): { rows: VaultRow[]; folders: number } {
  const by: Record<string, { bytes: number; files: number }> = Object.fromEntries(report.areas.map((a) => [a.key, a]));
  by.config = { bytes: report.vault?.config ?? 0, files: report.vault?.config ? 1 : 0 };
  const rows = VAULT_ROWS.map((r) => ({
    path: r.path,
    kind: r.kind,
    gloss: t(r.gloss),
    bytes: r.keys.reduce((s, k) => s + (by[k]?.bytes ?? 0), 0),
    files: r.keys.reduce((s, k) => s + (by[k]?.files ?? 0), 0),
  })).filter((r) => r.files > 0);
  return { rows, folders: report.vault?.folders ?? 0 };
}

/** What the download weighs: the documents and the history, not the
    config the archive leaves out. */
const vaultBytes = (rows: VaultRow[]): number => rows.filter((r) => r.path !== 'config.json').reduce((s, r) => s + r.bytes, 0);

/** The desktop shell's bridge, where there is one (desktop/preload.cjs). */
function revealVault(): (() => Promise<boolean>) | null {
  const shell = (window as unknown as { vaultShell?: { revealVault?: () => Promise<boolean> } }).vaultShell;
  return shell?.revealVault ?? null;
}

/**
 * Which rows the Vault listing drew last visit, by path.
 *
 * The placeholder reserves each row's own gloss, laid out invisible, so
 * it has to know WHICH rows and not merely how many: a vault with no
 * books drops two folders from the MIDDLE of the list and still ends on
 * `.history.git` and `config.json`, and the first eight reserved two
 * glosses that never arrive and missed the two that do. The same bargain
 * as the other reservations: a paint hint, wrong by at most one visit,
 * corrected by whatever /api/storage says.
 */
/** What a settled listing records for the reader above. */
function useStoredVaultPaths(rows: VaultRow[] | null): void {
  useEffect(() => {
    if (rows === null || rows.length === 0) return;
    try {
      localStorage.setItem(VAULT_ROWS_KEY, JSON.stringify(rows.map((r) => r.path)));
    } catch {
      // Nothing to reserve next time; the count serves.
    }
  }, [rows]);
}

/**
 * The demo's Vault card: the listing and the sentence, without a name to
 * give or a path to show. It is the one card that says what a vault is
 * MADE of, which is worth showing somebody deciding whether to install.
 */
export function DemoVaultCard({
  storage,
  outlineShown,
}: {
  storage: StorageReport | null;
  /** The page outline has been drawing this tree; see SettingsPage. */
  outlineShown: boolean;
}) {
  const vault = storage && vaultRows(storage);
  const [reservedPaths] = useState(readVaultPaths);
  useStoredVaultPaths(vault ? vault.rows : null);
  // The demo answers in the page, so the placeholder is a formality
  // here (useSlowLoad holds it back for longer than the answer takes);
  // it is drawn all the same, so the shape is proved on the one vault
  // everybody can see. The whole card used to be withheld until the
  // listing was in, which is what left the jump row above with no Vault
  // in it.
  //
  // No delay once the page outline has been drawing this tree: the
  // handover is the one moment a delay cannot help, and it left a hole
  // (see SettingsPage, outlineShown).
  const slow = useSlowLoad(vault === null) || outlineShown;
  return (
    <Card icon={BrandMark} title={t('Vault')} anchor="vault">
      {vault ? (
        <VaultTree path={null} rows={vault.rows} />
      ) : slow ? (
        <SkeletonVaultTree path={null} rows={7} paths={reservedPaths} />
      ) : null}
      <p className="text-muted-foreground text-sm">{t(DEMO_VAULT_NOTE)}</p>
    </Card>
  );
}

export function VaultCard({
  settings,
  onSaved,
  storage,
  outlineShown,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
  storage: StorageReport | null;
  /** The page outline has been drawing this tree; see SettingsPage. */
  outlineShown: boolean;
}) {
  const [name, setName] = useState(settings.name ?? '');
  const [note, setNote] = useState<Note>(null);
  const folder = settings.vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? settings.vaultPath;
  // The same answer the Storage used card below reads, so a clearing on
  // this page updates this listing too: browsed games are counted under
  // games/ here, and the tree used to keep the size it read at mount.
  const vault = storage && vaultRows(storage);
  const [reservedPaths] = useState(readVaultPaths);
  useStoredVaultPaths(vault ? vault.rows : null);
  // No delay once the page outline has been drawing this tree: the
  // handover between the two is the one moment a delay cannot help, and
  // it left a hole (see SettingsPage, outlineShown).
  const slow = useSlowLoad(vault === null) || outlineShown;
  const reveal = revealVault();
  const copyPath = async (): Promise<void> => {
    // copyText, not the bare Clipboard API: the isolated build denies
    // that one (lib/clipboard.ts says why) and this button failed there.
    if (await copyText(settings.vaultPath)) toast.add({ title: t('Path copied'), timeout: 3000 });
    else toast.add({ title: t('Could not copy the path'), timeout: 4000 });
  };

  const save = async (): Promise<void> => {
    const clean = name.trim();
    try {
      await api('/api/settings/name', { method: 'PUT', json: { name: clean } });
    } catch {
      setNote({ kind: 'error', text: t('Could not save.') });
      return;
    }
    // The sidebar foot reads the store, not the settings answer, so it
    // changes with the save rather than on the next full load.
    setVaultName(clean === '' ? null : clean);
    setNote({ kind: 'ok', text: t('Saved.') });
    await onSaved();
  };

  return (
    <Card icon={BrandMark} title={t('Vault')} anchor="vault">
      <Field label="Vault name">
        <ClearableInput inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder={folder} maxLength={60} />
      </Field>
      <p className="text-muted-foreground text-sm">{t(VAULT_NAME_NOTE)}</p>
      <div className="flex items-center gap-3">
        <Button variant="default" onClick={() => void save()}>{t('Save name')}</Button>
        <Feedback note={note} />
      </div>
      {/* The vault as a folder: where it is, what it weighs, what lives in
          it (components/vault-tree). /api/storage walks the vault to answer,
          which on a vault of books is the slowest wait on this page, and the
          box used to appear from nothing and push the buttons under it down
          by its whole height. */}
      {vault ? (
        <VaultTree path={settings.vaultPath} rows={vault.rows} />
      ) : slow ? (
        <SkeletonVaultTree path={settings.vaultPath} paths={reservedPaths} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {/* The backup verb (server/backup.ts): a plain link, since the
            session is a cookie and the browser's own download handles a
            vault of books without holding it in memory. Its size is on
            the button because on a phone that is the decision. */}
        <Button variant="secondary" render={<a href="/api/storage/backup" download />} nativeButton={false}>
          {vault ? t('Download a copy ({size})', { size: size(vaultBytes(vault.rows)) }) : t('Download a copy')}
        </Button>
        <Button variant="secondary" onClick={() => void copyPath()}>{t('Copy the path')}</Button>
        {reveal && (
          <Button variant="secondary" onClick={() => void reveal()}>{t('Show in the file manager')}</Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{t(VAULT_COPY_NOTE)}</p>
    </Card>
  );
}
