import { Volume2 } from 'lucide-react';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { CAPTURE_SOUNDS, MOVE_SOUNDS, usePrefs, type SoundChoice } from '@/store/prefs';
import { previewSound } from '@/board/sound';
import { t } from '@/lib/i18n';

// --- Sound ---------------------------------------------------------------

/**
 * Numbered options, or the rotating one — see MOVE_SOUNDS for the order.
 *
 * Named per kind ("Move 3", "Capture 3") rather than a bare number, so a
 * choice read aloud or written down still says which sound it is.
 */
const soundOption =
  (kind: 'Move' | 'Capture') =>
  ({ id, take }: SoundChoice): { value: string; label: string } => ({
    value: id,
    label:
      take === null
        ? t('Rotate through all')
        : kind === 'Move'
          ? t('Move {n}', { n: take })
          : t('Capture {n}', { n: take }),
  });


/**
 * Its own card rather than one switch under Appearance.
 *
 * Choosing a sound is the one setting on this page that cannot be judged by
 * reading it, so every control here plays what it does the moment it
 * changes — picking from a dropdown IS the audition, with no separate
 * preview step to find.
 */
export function SoundCard() {
  const { sound, soundVolume, moveSound, captureSound, haptics, setSound, setSoundVolume, setMoveSound, setCaptureSound, setHaptics } =
    usePrefs();

  return (
    <Card icon={Volume2} title={t('Sound')}>
      <SettingRow title={t('Move sounds')} blurb={t('Play a click on moves and captures.')}>
        <Switch checked={sound} onCheckedChange={() => setSound(!sound)} aria-label={t('Move sounds')} />
      </SettingRow>

      {/* Only where the browser has the API at all (Android, in practice).
          iOS Safari has no web haptics, and a switch that can only ever
          no-op is worse than an absent one. */}
      {'vibrate' in navigator && (
        <SettingRow title={t('Vibrate on moves')} blurb={t('One short tick when your piece lands, and when a swipe takes. Android only.')}>
          <Switch
            checked={haptics}
            onCheckedChange={() => setHaptics(!haptics)}
            aria-label={t('Vibrate on moves')}
          />
        </SettingRow>
      )}

      {/* The readout rides with the slider rather than sitting up beside
          the label, which is where the Field's hint put it: in a row the
          label is on the other side of the card, and a percentage two
          hundred pixels from the control it belongs to is a figure with
          no owner. */}
      <SettingRow title={t('Volume')} control="wide" className={cn(!sound && 'opacity-50')}>
        <div className="flex w-full items-center gap-2">
          <Slider
            min={0}
            max={100}
            step={5}
            value={Math.round(soundVolume * 100)}
            disabled={!sound}
            onValueChange={(v) => setSoundVolume((v as number) / 100)}
            // Preview on release rather than on every step: dragging fires
            // dozens of times and would machine-gun the sample.
            onValueCommitted={() => previewSound('move', moveSound)}
            aria-label={t('Volume')}
            className="min-w-0 flex-1"
          />
          <span className="text-foreground w-10 shrink-0 text-right font-mono text-sm tabular-nums">
            {Math.round(soundVolume * 100)}%
          </span>
        </div>
      </SettingRow>

      <SettingRow title={t('Move sound')} control="wide">
        <Select
          value={moveSound}
          onValueChange={(v) => {
            setMoveSound(v);
            previewSound('move', v);
          }}
          ariaLabel={t('Move sound')}
          className="w-full"
          groups={[{ options: MOVE_SOUNDS.map(soundOption('Move')) }]}
        />
      </SettingRow>

      <SettingRow title={t('Capture sound')} control="wide">
        <Select
          value={captureSound}
          onValueChange={(v) => {
            setCaptureSound(v);
            previewSound('capture', v);
          }}
          ariaLabel={t('Capture sound')}
          className="w-full"
          groups={[{ options: CAPTURE_SOUNDS.map(soundOption('Capture')) }]}
        />
      </SettingRow>

    </Card>
  );
}
