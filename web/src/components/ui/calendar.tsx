import * as React from 'react'
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from 'react-day-picker'

import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { currentPlatform } from '@/lib/platform'
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from 'lucide-react'

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant']
}) {
  const defaultClassNames = getDefaultClassNames()
  // iOS draws a month grid, not a compact table: the two things a class
  // cannot say are the shape of the labels, so they are branched here and
  // nothing else is. `currentPlatform` reads the root attribute the
  // stylesheet reads, so the variants below and this agree by
  // construction.
  const ios = currentPlatform() === 'ios'

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        'group/calendar bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent',
        // iOS: a 44px day under the thumb where there is width for it,
        // falling to no less than 36px once seven of them plus the
        // popover's padding and margins no longer fit (36.6px at a 320px
        // screen, 44px from 364px up), and every cell a circle.
        'ios:[--cell-radius:calc(infinity*1px)] ios:[--cell-size:clamp(--spacing(9),calc((100vw-3.5rem)/7),--spacing(11))] ios:p-3',
        // Plain strings, not String.raw: the React Compiler cannot lower a
        // tagged template whose cooked and raw values differ.
        'rtl:**:[.rdp-button\\_next>svg]:rotate-180',
        'rtl:**:[.rdp-button\\_previous>svg]:rotate-180',
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: ios ? 'long' : 'short' }),
        // iOS heads a column with one letter. Korean already writes one
        // (일 월 화), so `narrow` is the one call that is right in both
        // languages.
        ...(ios
          ? {
              formatWeekdayName: (date: Date) =>
                date.toLocaleString(locale?.code, { weekday: 'narrow' }),
            }
          : {}),
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn(
          'relative flex flex-col gap-4 md:flex-row',
          defaultClassNames.months
        ),
        month: cn('flex w-full flex-col gap-4', defaultClassNames.month),
        nav: cn(
          'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
          // iOS puts both chevrons together at the right, in the tint. The
          // box shrinks to them (`left-auto w-auto`) so it stops lying over
          // the title, which on iOS is the control that opens the year.
          'ios:left-auto ios:w-auto ios:gap-2',
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
          'ios:text-primary ios:size-8',
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
          'ios:text-primary ios:size-8',
          defaultClassNames.button_next
        ),
        month_caption: cn(
          'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
          'ios:h-8 ios:justify-start ios:px-0',
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium',
          // The month and the year read as one bold title. The dropdown
          // caption is kept rather than replaced: a game date can be a
          // century back, and a month-at-a-time chevron is not a way to
          // get there. Only the month's own chevron goes, so the pair
          // carries the single one iOS draws after the year.
          'ios:h-8 ios:w-auto ios:justify-start ios:gap-1 ios:text-base ios:font-semibold',
          'ios:[&>:first-child_svg]:hidden',
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          'relative rounded-(--cell-radius)',
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          'absolute inset-0 bg-popover opacity-0',
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          'font-medium select-none',
          captionLayout === 'label'
            ? 'text-sm'
            : 'flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
          'ios:rounded-md ios:text-base ios:font-semibold ios:[&>svg]:text-primary',
          defaultClassNames.caption_label
        ),
        month_grid: cn('w-full border-collapse', defaultClassNames.month_grid),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          // The small-control rung with the phone's lift, as the sm
          // Button and Toggle beside it take it: a weekday initial and a
          // week number are read, and 12.8px flat left them the one text
          // in a phone date picker that never stepped up.
          'flex-1 rounded-(--cell-radius) text-[0.8rem] max-md:type-row-sub font-normal text-muted-foreground select-none',
          // iOS heads the columns in muted small caps. The size is left
          // alone: `max-md:type-row-sub` beside it is the phone lift that
          // was measured for exactly this text.
          'ios:font-semibold ios:uppercase',
          defaultClassNames.weekday
        ),
        week: cn('mt-2 flex w-full', defaultClassNames.week),
        week_number_header: cn(
          'w-(--cell-size) select-none',
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          'text-[0.8rem] max-md:type-row-sub text-muted-foreground select-none',
          defaultClassNames.week_number
        ),
        day: cn(
          'group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)',
          props.showWeekNumber
            ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)'
            : '[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)',
          defaultClassNames.day
        ),
        range_start: cn(
          'relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted',
          defaultClassNames.range_start
        ),
        range_middle: cn('rounded-none', defaultClassNames.range_middle),
        range_end: cn(
          'relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted',
          defaultClassNames.range_end
        ),
        today: cn(
          'rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none',
          // iOS marks today by tinting the number, not by filling the
          // cell, which keeps the one filled circle the chosen day's.
          'ios:bg-transparent ios:font-semibold ios:text-primary',
          defaultClassNames.today
        ),
        outside: cn(
          'text-muted-foreground aria-selected:text-muted-foreground',
          defaultClassNames.outside
        ),
        disabled: cn(
          'text-muted-foreground opacity-50',
          defaultClassNames.disabled
        ),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot='calendar'
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === 'left') {
            return (
              <ChevronLeftIcon className={cn('size-4', className)} {...props} />
            )
          }

          if (orientation === 'right') {
            return (
              <ChevronRightIcon className={cn('size-4', className)} {...props} />
            )
          }

          return (
            <ChevronDownIcon className={cn('size-4', className)} {...props} />
          )
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className='flex size-(--cell-size) items-center justify-center text-center'>
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant='ghost'
      size='icon'
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground [&>span]:text-xs max-md:[&>span]:type-row-sub [&>span]:opacity-70',
        // iOS: the chosen day is a filled tinted circle, so the button is
        // round at every state and not only where `--cell-radius` reaches.
        'ios:rounded-full ios:data-[selected-single=true]:rounded-full',
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar }
