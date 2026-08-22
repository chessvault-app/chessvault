import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { dialogOpen } from './dialogFocus';
import { Modal } from './Modal';
import { t } from '@/lib/i18n';

/**
 * The keyboard reference, on ?.
 *
 * The shortcuts existed only in the README — an app is not supposed to
 * need its repository read. One overlay, opened the way every keyboard
 * user will guess first, listing the handful of keys the boards answer.
 */

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '← →', what: 'Previous / next move' },
  { keys: '↑ / Home', what: 'Go to the start' },
  { keys: '↓ / End', what: 'Go to the end' },
  { keys: 'f', what: 'Flip the board' },
  { keys: 'Enter', what: 'Play the typed move (in the move box)' },
  { keys: 'Ctrl/⌘ S', what: 'Save the open document' },
  { keys: 'Esc', what: 'Close the open window' },
  { keys: '?', what: 'This list' },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // An open window owns the keyboard, this one included.
      if (dialogOpen()) return;
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" icon={Keyboard} onClose={() => setOpen(false)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {SHORTCUTS.map(({ keys, what }) => (
          <span key={keys} className="contents">
            <dt className="bg-surface-2 border-line justify-self-start rounded-sm border px-1.5 py-0.5 font-mono">
              {keys}
            </dt>
            <dd className="text-muted self-center">{t(what)}</dd>
          </span>
        ))}
      </dl>
    </Modal>
  );
}
