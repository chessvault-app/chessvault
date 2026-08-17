import { useSyncExternalStore } from 'react';
import {
  isDifficultyId,
  normaliseTraining,
  type DifficultyId,
  type DrillPick,
} from '@shared/training';
import { api } from '@/lib/api';

/**
 * The vault's training state, on this device.
 *
 * The VAULT is the authority — difficulty and the drilled study live in
 * config.json so they follow you from the desktop to the phone (see
 * shared/training.ts). What is kept in localStorage here is an ECHO of the
 * last answer this device saw, and never the authority: it exists only so
 * the first paint shows the setting you actually have instead of the
 * default, because the hub and the home page read the difficulty word
 * while rendering and a fetch cannot answer in time. The same bargain the
 * home page's layout echo makes.
 *
 * hydrate() overwrites the echoes with whatever the vault says. Until it
 * lands — and on a device that is offline, or gated behind the lock screen
 * — the echo is what you get, which is the setting this device last used.
 */

const DIFFICULTY_ECHO = 'vault:puzzle-difficulty';
const DRILL_ECHO = 'vault:repertoire-drill';

const listeners = new Set<() => void>();
const emit = (): void => {
  for (const fn of listeners) fn();
};

const readRaw = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeRaw = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* full or blocked storage loses the echo, nothing else — the vault still has it */
  }
};

// --- difficulty --------------------------------------------------------------

/** The setting, or `any` when nothing valid has been chosen. */
export function storedDifficulty(): DifficultyId {
  const echo = readRaw(DIFFICULTY_ECHO);
  return isDifficultyId(echo) ? echo : 'any';
}

/** Choose it: echo for the next first paint, then tell the vault. */
export function setDifficulty(id: DifficultyId): void {
  writeRaw(DIFFICULTY_ECHO, id);
  emit();
  void patch({ difficulty: id });
}

// --- the drilled study -------------------------------------------------------

/** The study and chapter a drill was last started on, if any. */
export function rememberedDrill(): DrillPick | null {
  try {
    return normaliseTraining({ drill: JSON.parse(readRaw(DRILL_ECHO) ?? 'null') }).drill ?? null;
  } catch {
    return null;
  }
}

/** Written when a drill STARTS, not when one is browsed to. */
export function rememberDrill(study: string, chapter: string): void {
  const drill = normaliseTraining({ drill: { study, chapter } }).drill;
  if (!drill) return;
  writeRaw(DRILL_ECHO, JSON.stringify(drill));
  void patch({ drill });
}

// --- subscription ------------------------------------------------------------

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The difficulty, re-rendering when the vault's answer arrives.
 *
 * Needed because hydrate() can land after a page has already drawn the
 * echo — on a device opening this vault for the first time, the two differ
 * and the word would otherwise sit wrong until the page happened to
 * remount.
 */
export function useDifficulty(): DifficultyId {
  return useSyncExternalStore(subscribe, storedDifficulty, storedDifficulty);
}

// --- talking to the vault ----------------------------------------------------

/** Fire and forget: a memo that fails to save is not worth interrupting
    anyone over, and the echo means this device still behaves correctly. */
async function patch(body: Partial<{ difficulty: DifficultyId; drill: DrillPick }>): Promise<void> {
  try {
    await api('/api/settings/training', { method: 'PUT', json: body });
  } catch {
    /* offline — the echo already holds it, and the next change tries again */
  }
}

/**
 * Take the vault's answer, and hand it this device's if it has none.
 *
 * The second half is the upgrade path: everyone who set a difficulty
 * before it lived in the vault has it only in this browser, and a silent
 * reset to "Any" on the release that moved it would be a bug rather than a
 * migration. Read once, pushed up, and from then on the vault is asked.
 *
 * Quiet on failure by design — a gated vault answers 401 until the lock
 * screen is passed, and being offline is normal for a self-hosted app.
 * Both leave the echo in charge for the session, which is what this device
 * was doing before anyway.
 */
export async function hydrateTraining(): Promise<void> {
  let training;
  try {
    // Runs at boot, before PasswordGate has registered api()'s 401
    // handler — so a gated vault's 401 stays a quiet throw here, exactly
    // the silence this function promises.
    const body = await api<{ training?: unknown }>('/api/settings');
    training = normaliseTraining(body.training);
  } catch {
    return;
  }

  const localDifficulty = storedDifficulty();
  const localDrill = rememberedDrill();

  if (training.difficulty !== undefined) {
    writeRaw(DIFFICULTY_ECHO, training.difficulty);
  } else if (localDifficulty !== 'any') {
    void patch({ difficulty: localDifficulty });
  }

  if (training.drill) {
    writeRaw(DRILL_ECHO, JSON.stringify(training.drill));
  } else if (localDrill) {
    void patch({ drill: localDrill });
  }

  emit();
}
