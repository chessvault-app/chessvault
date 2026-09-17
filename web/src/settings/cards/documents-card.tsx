import { Save } from 'lucide-react';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';
import { usePrefs } from '@/store/prefs';
import { t } from '@/lib/i18n';

// --- Documents -----------------------------------------------------------

/**
 * Whether your games, studies and notes write themselves.
 *
 * Its own card rather than a switch under Appearance: this one is not
 * about how the app looks, it is about who decides when the vault
 * changes. Off by default — a document is yours until you save it — and
 * on for anyone who would rather never think about it.
 *
 * Shown in the demo too. The demo runs the real server in the browser, so
 * saving genuinely works there; it is the only card besides Appearance
 * and Sound that means something without a vault of your own.
 */
export function DocumentsCard() {
  const autosave = usePrefs((p) => p.autosave);
  const setAutosave = usePrefs((p) => p.setAutosave);

  return (
    <Card icon={Save} title={t('Documents')}>
      <SettingRow
        title={t('Auto-save')}
        blurb={t('Write changes to the vault as you make them. Off, they wait for you to save.')}
      >
        <Switch
          checked={autosave}
          onCheckedChange={() => setAutosave(!autosave)}
          aria-label={t('Auto-save')}
        />
      </SettingRow>
    </Card>
  );
}
