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
          {items.map(({ section, param, label, icon: Icon, blurb }) => (
            <button
              key={label}
              type="button"
              onClick={() => (param ? navigate(section, param) : navigate(section))}
              className={cn(
                'bg-card flex items-center gap-3 rounded-xl ring-1 ring-card-ring p-3.5 text-left',
                'active:bg-accent transition-colors duration-100',
              )}
            >
              <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
                <Icon className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="text-base font-medium">{t(label)}</div>
                <div className="text-muted-foreground text-sm">{t(blurb)}</div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </PageShell>
  );
}
