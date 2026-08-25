import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { ko } from 'react-day-picker/locale';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t, useLang } from '@/lib/i18n';

/**
 * shadcn's Date Picker — a Popover with the registry's Calendar in it, the
 * trigger a Button that reads the chosen day — over the app's date
 * contract: the value is a plain `YYYY-MM-DD` string ('' for none), which
 * is what the filters and the server already speak, so nothing upstream
 * learns about Date objects or time zones. The calendar speaks the app's
 * language.
 */
export function DatePicker({
  value,
  onValueChange,
  placeholder = 'Pick a date',
  className,
  ...props
}: {
  /** `YYYY-MM-DD`, or '' for none. */
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const lang = useLang();
  const selected = parse(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            data-empty={!selected}
            className={cn('justify-start text-left font-normal data-[empty=true]:text-muted-foreground', className)}
            {...props}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {selected ? selected.toLocaleDateString(lang === 'ko' ? 'ko-KR' : undefined) : t(placeholder)}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          locale={lang === 'ko' ? ko : undefined}
          onSelect={(day) => {
            onValueChange(day ? format(day) : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Local calendar day → YYYY-MM-DD, no time zone round trip. */
function format(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parse(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
