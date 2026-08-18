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
      {children}
    </div>
  );
}
