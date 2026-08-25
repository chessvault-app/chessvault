import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';

/**
 * A filter that is on or off: shadcn's Toggle in the app's chip face
 * (aria-pressed from Base UI; the outlined pill that fills with the accent
 * when it is on). `title` is a tooltip, as on Button.
 */
export function FilterChip({
  label,
  count,
  active,
  title,
  onClick,
}: {
  label: React.ReactNode;
  count?: number;
  active: boolean;
  title?: string;
  onClick: () => void;
}) {
  const chip = (
    <Toggle variant="chip" size="none" pressed={active} onPressedChange={() => onClick()}>
      {typeof label === 'string' ? t(label) : label}
      {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </Toggle>
  );
  if (!title) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipContent>{t(title)}</TooltipContent>
    </Tooltip>
  );
}
