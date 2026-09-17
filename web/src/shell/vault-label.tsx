import { useEffect, useState } from 'react';
import { displayName, useVaultInfo } from '@/lib/vaultName';
import { TitleTip } from '@/components/title-tip';
import { t } from '@/lib/i18n';

/**
 * The vault, named in the shell.
 *
 * The product is a folder of plain files, and the app never showed it:
 * the landing page's hero is a directory tree, the sidebar was a list of
 * sections. The vault's name sits over the connection label, with the
 * whole path in its tooltip, on the wide layout where a sidebar has a
 * foot to stand it on. A phone client is a window onto someone else's
 * folder and does not get one. The name is the one given in Settings,
 * or the folder's own when none has been; both come from the settings
 * answer this foot always waited for (lib/vaultName), so a name is not a
 * second thing to load.
 */
export function VaultLabel() {
  const info = useVaultInfo();
  const name = displayName(info);
  // The foot's first line, held while the settings answer is out. Without
  // it the connection label under it and the foot's own height stepped
  // down 8px on every wide route the moment the answer landed. A vault
  // that turns out to have no name reserves nothing: `loaded` is what
  // separates the two, since `name` alone cannot.
  if (!name) return info.loaded ? null : <span className="block h-5" aria-hidden />;
  return (
    <TitleTip title={info.path ? t('Vault folder: {path}', { path: info.path }) : undefined}>
      <span className="text-foreground block truncate text-sm">{name}</span>
    </TitleTip>
  );
}

/**
 * The tab and window title carry the vault's name once one is known, so
 * two windows on two vaults can be told apart from the taskbar. Only a
 * given name changes it: a folder name is a path detail, and the title
 * stays the app's until somebody names the vault.
 */
export function VaultTitle() {
  const { name } = useVaultInfo();
  useEffect(() => {
    if (!name) return;
    const was = document.title;
    document.title = `${name} · Chess Vault`;
    return () => {
      document.title = was;
    };
  }, [name]);
  return null;
}

/**
 * Where this window's data actually lives.
 *
 * It used to read "Offline · local" always — a tagline, not a status, and
 * it said "local" while you were looking at a server on the other side of
 * a tailnet. It now names the host it is talking to, and only says offline
 * when the browser says so.
 */
export function ConnectionLabel() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  return (
    <TitleTip title={location.origin}>
      <span className="text-muted-foreground hidden truncate text-sm lg:block">
        {!online ? t('Offline') : local ? t('This device') : host}
      </span>
    </TitleTip>
  );
}
