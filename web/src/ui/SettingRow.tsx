import type { ReactNode } from 'react';

/**
 * The settings-row shell: a titled, blurbed strip with one control on
 * the right — a Switch, usually, but the desktop card puts a Button
 * here. One component because the identical row was pasted six times
 * across Settings and the home customiser and stayed aligned only by
 * copy-discipline.
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
    <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-base font-medium">{title}</div>
        <div className="text-subtle text-sm">{blurb}</div>
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
