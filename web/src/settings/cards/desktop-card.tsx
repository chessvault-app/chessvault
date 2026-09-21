import { MonitorSmartphone, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isInstalled, useInstallPrompt } from '@/lib/install';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { SettingRow } from '@/components/setting-row';
import { t } from '@/lib/i18n';
import { type VaultShell } from '@/settings/cards/shared';

// --- Desktop shell -----------------------------------------------------------

/**
 * The way onto the home screen, said in the app. The page has been
 * installable for a long time and nothing told anyone: a phone user
 * lived in a browser tab, with its address bar and its bounce, never
 * knowing the full-screen version was one menu away. Gone once the page
 * runs from an icon or inside the desktop shell, since then it is done.
 * Chromium hands over its own prompt and gets a button; every other
 * browser gets the menu route, which is the same words on all of them.
 */
export function InstallCard() {
  const prompt = useInstallPrompt();
  if (isInstalled()) return null;
  return (
    <Card icon={Smartphone} title={t('Home screen')}>
      <SettingRow
        title={t('Add to home screen')}
        blurb={
          prompt
            ? t('Opens full screen from its own icon, like an app.')
            : t('Open the browser menu and choose Add to Home Screen. It then opens full screen from its own icon, like an app.')
        }
      >
        {prompt && (
          <Button variant="secondary" size="sm" onClick={() => void prompt()}>
            {t('Install')}
          </Button>
        )}
      </SettingRow>
    </Card>
  );
}

/**
 * The OS's window material, as a switch, because it cannot be the
 * default yet.
 *
 * Windows 11 draws Mica behind a window's chrome and macOS draws
 * sidebar vibrancy; the shell can ask for either (desktop/main.mjs) and
 * the window's frame then gets out of the way from md, leaving the page
 * on its own opaque panel (--window-ground, --app-ground). What stops
 * it being simply on is that neither material has been looked at in a
 * real window yet, on either system. The row is absent wherever the OS
 * has no such material, and absent in a browser, where no bridge is.
 */
function useWindowMaterial(shell: VaultShell | undefined) {
  const [state, setState] = useState<{ supported: boolean; enabled: boolean } | null>(null);
  const ask = shell?.titleBar?.material;
  useEffect(() => {
    if (!ask) return;
    let live = true;
    void ask().then((next) => {
      if (live && next) setState({ supported: next.supported, enabled: next.enabled });
    });
    return () => {
      live = false;
    };
  }, [ask]);
  return state;
}

export function DesktopCard() {
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;
  const material = useWindowMaterial(shell);
  // switchVault is newer than the bridge itself, so an older shell shows
  // no card rather than a button that does nothing.
  if (!shell?.switchVault) return null;
  const setMaterial = shell.titleBar?.setMaterial;
  return (
    <Card icon={MonitorSmartphone} title={t('Desktop app')}>
      <SettingRow
        title={t('Vault')}
        blurb={t('Point this window at a server, or host a folder on this device.')}
      >
        <Button variant="secondary" size="sm" onClick={() => void shell.switchVault!()}>
          {t('Switch…')}
        </Button>
      </SettingRow>
      {material?.supported && setMaterial && (
        <SettingRow
          title={t('Window material')}
          blurb={t('Lets the desktop show through behind the app, the way the system draws its own windows. The window reloads when you change it.')}
        >
          <Switch
            checked={material.enabled}
            onCheckedChange={(on) => void setMaterial(on)}
            aria-label={t('Window material')}
          />
        </SettingRow>
      )}
    </Card>
  );
}
