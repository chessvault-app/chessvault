import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { PageShell } from '@/components/page-shell';
import { PageHeader } from '@/components/page-header';
import { t } from '@/lib/i18n';
import { MORE_GROUPS } from '@/shell/shared';

/** A plain page, not a popover — lanph3re's call after trying the sheet. */
export function MorePage() {
  return (
    <PageShell width="narrow">
      <PageHeader title={t('More')} />
      {MORE_GROUPS.map(({ heading, items }) => (
        <div key={heading} className="flex flex-col gap-2">
          <h2 className="text-muted-foreground type-row font-medium">{t(heading)}</h2>
          {/* iOS: a grouped inset list ("Platform-specific design",
              docs/design-principles.md): the group's rows in one rounded
              card with a hairline between rows and a chevron on each,
              which is the platform's own shape for a list of places to go.
              The docked platforms keep a card per row. */}
          <div className="contents ios:bg-card ios:flex ios:flex-col ios:overflow-hidden ios:rounded-xl ios:ring-1 ios:ring-card-ring">
            {items.map(({ section, param, label, icon: Icon, blurb }) => (
              <button
                key={label}
                type="button"
                onClick={() => (param ? navigate(section, param) : navigate(section))}
                className={cn(
                  'bg-card flex items-center gap-3 rounded-xl ring-1 ring-card-ring p-3.5 text-left',
                  'active:bg-accent transition-colors duration-100',
                  // border-border, not the card ring: the ring is transparent on the
                  // light page at rest, and a grouped list with no line between its
                  // rows is one tall card.
                  'ios:rounded-none ios:ring-0 ios:border-border ios:not-first:border-t',
                )}
              >
                <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
                  <Icon className="size-5" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium">{t(label)}</div>
                  <div className="text-muted-foreground text-sm">{t(blurb)}</div>
                </div>
                <ChevronRight className="text-muted-foreground hidden size-5 shrink-0 ios:block" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </PageShell>
  );
}
