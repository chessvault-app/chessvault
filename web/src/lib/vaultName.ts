import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';

/**
 * What this vault is called, and where it lives.
 *
 * One fetch for the app's life: the folder does not move while it runs,
 * and the name changes only from the Settings page, which tells this store
 * directly rather than asking the server again. It rides the settings
 * answer the sidebar foot was already waiting for, so a name adds no
 * request and no loading state of its own: the foot shows nothing until
 * that answer lands, exactly as it did for the folder name, and then the
 * name if one is set or the folder's own name if none is.
 */
export interface VaultInfo {
  /** The folder on the server; null while unknown, or on the demo. */
  path: string | null;
  /** The name somebody gave it, or null when the folder name stands in. */
  name: string | null;
}

let info: VaultInfo = { path: null, name: null };
let once: Promise<VaultInfo> | null = null;
const listeners = new Set<() => void>();

const publish = (next: VaultInfo): void => {
  info = next;
  for (const fn of listeners) fn();
};

/** Starts the fetch on first use; resolves to whatever the server said. */
export const vaultInfo = (): Promise<VaultInfo> =>
  (once ??= api<{ vaultPath?: string; name?: string | null }>('/api/settings')
    .then((s) => {
      publish({ path: s.vaultPath ?? null, name: s.name ?? null });
      return info;
    })
    .catch(() => info));

/** The Settings page just saved a name (or cleared it): no refetch. */
export const setVaultName = (name: string | null): void => {
  publish({ ...info, name });
};

/** The name to show for this vault: the given one, else the folder's. */
export const displayName = (v: VaultInfo): string | null =>
  v.name ?? (v.path ? (v.path.split(/[\\/]/).filter(Boolean).pop() ?? v.path) : null);

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  void vaultInfo();
  return () => {
    listeners.delete(fn);
  };
};

export const useVaultInfo = (): VaultInfo => useSyncExternalStore(subscribe, () => info, () => info);
