import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
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
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="border-card-ring bg-muted flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="type-row font-medium">{title}</div>
        <div className="text-muted-foreground type-row-sub">{blurb}</div>
      </div>
      {/* The control keeps its own width and the words give way, not the
          other way round. A row is a label and a control competing for one
          phone-width line: with both able to shrink, the flex algorithm
          took it out of the CONTROL — artificial latency's 86px menu was
          handed 74px — and a control too narrow to say what it is set to
          is worse than a blurb that wraps one line further. Every control
          used in a row is compact (a switch, a small button, a menu), so
          none of them can take the row past the card by refusing. */}
      <div className="shrink-0">{children}</div>
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
