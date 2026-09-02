import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';

import { useTheme } from '@/store/theme';
import { t } from '@/lib/i18n';

/**
 * shadcn's Sonner toaster, owned: the registry's file with the theme read
 * from the app's own store rather than next-themes. Mounted once at the
 * root (main.tsx); the undo offer (hooks/use-undoable) is its one caller.
 *
 * Bottom-right on a desktop; on a phone bottom-centre, lifted over the tab
 * bar and the home indicator — the place the undo chip always stood.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useTheme((s) => s.resolved);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      // The region's accessible name, otherwise "Notifications" in
      // English on every page whatever language the app is in.
      containerAriaLabel={t('Notifications')}
      mobileOffset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
          // The undo offer's button measured 46x24 on a phone, under the
          // 36px coarse floor every other control keeps, for the one
          // press that has 4.5 seconds to land.
          actionButton: 'pointer-coarse:min-h-9 pointer-coarse:px-3',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
