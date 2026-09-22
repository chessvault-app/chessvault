import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';

/**
 * The settings-row shell: a titled, blurbed strip with one control on
 * the right — a Switch, usually, but the desktop card puts a Button
 * here. One component because the identical row was pasted six times
 * across Settings and the home customiser and stayed aligned only by
 * copy-discipline.
 *
 * On the row rung, not text-base over text-sm. This was the last row in
 * the app still pinned at 16 over 14 at every width, the shape the
 * windows pass (2026-09-17) named and could not reach from here: it is
 * shared with Settings, so the size is that page's as well as the
 * customise window's. Both read wrong on a desktop and for the same
 * reason. In the customise window the card rows drew their title at 16
 * while every other line in the window — its three group headings, its
 * eleven destination rows, the paragraph over them — drew 14, so one
 * list in a window of lists was a size larger than the rest. On Settings
 * the row's title matched the CARD HEADING above it exactly, both 16 and
 * both medium, so a card announced itself no louder than the switches
 * inside it. type-row and type-row-sub put a row at 14 over 12 on a
 * desktop, which is what macOS System Settings (13pt over 11) and
 * Windows Settings (14 over 12) draw, and leave the phone at 16 over 14,
 * exactly where text-base and text-sm already had it. So no phone moves,
 * which is why the three computed-size sweeps over the phone routes
 * passed this row every time.
 *
 * The blurb takes the same rung the registry's own FieldDescription
 * takes here (components/ui/field.tsx, `field-hint`), and the title the
 * one Label takes, so a switch in a row and a control under a label are
 * lettered alike.
 */
export function SettingRow({
  title,
  blurb,
  control = 'compact',
  className,
  children,
}: {
  title: string;
  /** The line under the title. Optional: a named choice whose options say
      what it does ("App theme", "Density") has nothing to add under it,
      and an empty grey line under every one of them was the shape the
      stacked fields had before. */
  blurb?: string;
  /**
   * How much room the control on the right is given.
   *
   * `compact` is a switch, a small button or a menu: it takes its own
   * width, and the words give way (see below). `wide` is a Select, a
   * Slider, a Segmented or a short input — a control that has to show a
   * VALUE, not just a state. Those are given one settled width so a card
   * of them lines up in a column rather than each ending where its
   * longest option happens to end, and a Select at its own width is 5rem
   * for "Dark" beside 13rem for "A tablebase server of your own". 10rem
   * under a thumb and 14rem from sm, which is inside the 12 to 16rem a
   * desktop settings row gives a dropdown and leaves a phone's label
   * room to finish. A wide control is passed `className="w-full"` by its
   * caller, which is how it fills the slot; the slot does not reach into
   * it, because the sound row puts a readout beside its slider.
   *
   * `full` stacks UNDER md and is the wide slot from md: the words on
   * top and the control under them at the row's whole width on a phone,
   * a row again on a desktop. It is the slider's shape, and the phone
   * half is the platform's (iOS draws Brightness as a full-width track
   * in its own grouped row, the label carried by the group above it).
   *
   * It is a width rule and not a platform one, because the thing it
   * fixes is a width. A slider in the `wide` slot is a 160px track with
   * a 48px readout beside it, and on a 390px phone that leaves the blurb
   * about 166px: it wrapped to five lines with the track floating
   * against a taller block of text than itself. A desktop card is 624px,
   * where the same slot leaves the blurb around 350 and nothing is
   * squeezed. Stacking there instead buys a 518px throw for a nought to
   * a hundred and a line of empty card beside a one-word label
   * (measured, 2026-09-22), which is why macOS and Windows both keep a
   * slider in the row's control column. The other controls stay in a row
   * at every width: a switch or a menu says what it is at its own width
   * and gains nothing from the card's.
   */
  control?: 'compact' | 'wide' | 'full';
  /** For a row that dims with a setting it depends on (Sound's volume). */
  className?: string;
  children: ReactNode;
}) {
  return (
    // data-slot, as the registry marks its parts: it is how a settings
    // group flattens this row into one of its own (the iOS rules in
    // settings/SettingsPage.skeleton, SettingsCard). Nothing reads it
    // elsewhere, and it draws nothing by itself.
    <div
      data-slot="setting-row"
      className={cn(
        'border-card-ring bg-muted flex gap-3 rounded-md border px-3 py-2.5',
        'items-center justify-between',
        control === 'full' && 'max-md:flex-col max-md:items-stretch max-md:gap-2',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="type-row font-medium">{title}</div>
        {blurb !== undefined && <div className="text-muted-foreground type-row-sub">{blurb}</div>}
      </div>
      {/* The control keeps its own width and the words give way, not the
          other way round. A row is a label and a control competing for one
          phone-width line: with both able to shrink, the flex algorithm
          took it out of the CONTROL — artificial latency's 86px menu was
          handed 74px — and a control too narrow to say what it is set to
          is worse than a blurb that wraps one line further. Every control
          used in a row is compact (a switch, a small button, a menu), so
          none of them can take the row past the card by refusing. */}
      <div
        className={cn(
          'shrink-0',
          control === 'wide' && 'w-40 sm:w-56',
          control === 'full' && 'max-md:w-full md:w-56',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The row while its setting is not known: the real row, with its own
 * title and blurb, and a Switch on the right that is the real one, off
 * and inert, since its box is the registry's whatever the setting turns
 * out to be (components/ui/switch). The words are constants, so drawing
 * them is what makes the height right by construction: a pair of bars
 * with a `blurbLines` guess stood here before, and "File and rank labels
 * on the board edge." wraps to two lines at 375px where the guess said
 * one, so the Appearance card landed 20px taller than its placeholder
 * (measured on the demo). What the answer brings is only whether the
 * switch is on.
 */
export function SkeletonSettingRow({ title, blurb }: { title: string; blurb: string }) {
  return (
    <SettingRow title={t(title)} blurb={t(blurb)}>
      <Switch disabled checked={false} tabIndex={-1} aria-hidden />
    </SettingRow>
  );
}
