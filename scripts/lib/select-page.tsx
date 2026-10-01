/**
 * The page `check:select` builds and drives (scripts/check-select.ts):
 * the app's own Select, web/src/components/ui/select.tsx, compiled the
 * way the app compiles it, in the shapes its guard against Base UI's
 * fallback is about. Nothing in the app imports this file.
 *
 * One shape per load, named by ?shape=:
 *
 *   swap      two lists, each with its own state, drawn in one unkeyed
 *             slot, so React hands one Select instance from the first
 *             list to the second and back: the Databases hunt's Motif
 *             and Material lists before they were keyed. The button
 *             swaps them from a click (a discrete update, and focus
 *             leaves the trigger); `swap()` swaps them from outside any
 *             event (a default update, with the trigger still focused).
 *   raw-swap  the same slot drawn with Base's bare Root, no wrapper. The
 *             control: it shows the shape still reaches Base's fallback,
 *             so a quiet `swap` means the guard held, not that nothing
 *             happened. It also keeps Base's eventDetails, which the
 *             wrapper drops.
 *   leaves    one Select whose options lose the value it holds, as the
 *             editor's en passant square does when the side to move
 *             flips.
 *   picks     one Select picked by a click, by the keyboard and by
 *             typeahead on the closed trigger.
 *
 * Every onValueChange lands in `window.__select.reports`, the callers'
 * values in `window.__select.state`. The labels start with distinct
 * letters so one typed key is one typeahead match.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Select } from '@/components/ui/select';

export interface Report {
  who: string;
  value: string | null;
  /** Base's eventDetails, on the bare Root only. */
  reason?: string;
  event?: string;
  trusted?: boolean;
}

export interface SelectProbe {
  reports: Report[];
  state: Record<string, string | null>;
  swap: () => void;
}

declare global {
  interface Window {
    __select: SelectProbe;
  }
}

const LIST_A = ['Alpha', 'Bravo', 'Charlie'];
const LIST_B = ['Delta', 'Echo', 'Foxtrot'];
const PICKS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

const probe: SelectProbe = { reports: [], state: {}, swap: () => {} };
window.__select = probe;

const groups = (values: readonly string[]) => [{ options: values.map((v) => ({ value: v, label: v })) }];

/** A Select through the app's wrapper, logging every report. */
function Field({ who, value, set, values }: { who: string; value: string | null; set: (v: string | null) => void; values: readonly string[] }) {
  return (
    <Select
      ariaLabel={`List ${who}`}
      value={value as string}
      onValueChange={(v) => {
        probe.reports.push({ who, value: v as string | null });
        set(v);
      }}
      groups={groups(values)}
    />
  );
}

/** The same through Base's bare Root, keeping what eventDetails says. */
function Raw({ who, value, set, values }: { who: string; value: string | null; set: (v: string | null) => void; values: readonly string[] }) {
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v, details) => {
        const event = details.event as Event | undefined;
        probe.reports.push({ who, value: v, reason: details.reason, event: event?.type, trusted: event?.isTrusted });
        set(v);
      }}
    >
      <SelectPrimitive.Trigger aria-label={`List ${who}`}>
        <span>{value ?? '-'}</span>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner alignItemWithTrigger={false}>
          <SelectPrimitive.Popup>
            <SelectPrimitive.List>
              {values.map((v) => (
                <SelectPrimitive.Item key={v} value={v}>
                  <SelectPrimitive.ItemText>{v}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Two lists in one unkeyed slot: React reuses one instance for both. */
function Swap({ raw }: { raw: boolean }) {
  const [kind, setKind] = React.useState<'a' | 'b'>('a');
  const [a, setA] = React.useState<string | null>('Alpha');
  const [b, setB] = React.useState<string | null>('Delta');
  const flip = (): void => setKind((k) => (k === 'a' ? 'b' : 'a'));
  React.useLayoutEffect(() => {
    probe.state = { kind, a, b };
    probe.swap = flip;
  });
  const Control = raw ? Raw : Field;
  return (
    <div>
      <button type="button" onClick={flip}>
        Swap lists
      </button>
      {/* Deliberately unkeyed: this is the shape under test. */}
      {kind === 'a' ? (
        <>
          <Control who="A" value={a} set={setA} values={LIST_A} />
        </>
      ) : (
        <>
          <Control who="B" value={b} set={setB} values={LIST_B} />
        </>
      )}
    </div>
  );
}

/** One Select whose list drops the value it holds. */
function Leaves() {
  const [values, setValues] = React.useState<readonly string[]>(LIST_A);
  const [a, setA] = React.useState<string | null>('Alpha');
  React.useLayoutEffect(() => {
    probe.state = { a, options: values.join(',') };
  });
  return (
    <div>
      <button type="button" onClick={() => setValues((v) => v.slice(0, -1))}>
        Drop the last option
      </button>
      <Field who="A" value={a} set={setA} values={values} />
    </div>
  );
}

function Picks() {
  const [a, setA] = React.useState<string | null>('Alpha');
  React.useLayoutEffect(() => {
    probe.state = { a };
  });
  return <Field who="A" value={a} set={setA} values={PICKS} />;
}

const shape = new URLSearchParams(location.search).get('shape');
createRoot(document.getElementById('root')!).render(
  shape === 'swap' ? (
    <Swap raw={false} />
  ) : shape === 'raw-swap' ? (
    <Swap raw />
  ) : shape === 'leaves' ? (
    <Leaves />
  ) : (
    <Picks />
  ),
);
