import { useSyncExternalStore } from 'react';
import { ko } from './ko.ts';

/**
 * Translation, keyed by the English sentence itself.
 *
 * There are no invented key names — `t('Cancel')` rather than
 * `t('common.cancel')`. Three reasons, all of which cost something the
 * other way round: a call site reads as the sentence it renders, so nothing
 * has to be looked up to know what a screen says; a string with no entry
 * falls back to the English it already was, so a half-finished language is
 * a partly translated app rather than a wall of `common.cancel`; and adding
 * a language is adding one file, touching no component.
 *
 * The cost is that editing English copy orphans its translation. That is
 * the right trade here — the alternative silently keeps a stale Korean
 * sentence attached to changed English, which is worse than falling back.
 */

export type Lang = 'en' | 'ko';

export const LANGS: { id: Lang; label: string }[] = [
  // Each named in its own language: someone looking for Korean is looking
  // for 한국어, and may not read the English word for it.
  { id: 'en', label: 'English' },
  { id: 'ko', label: '한국어' },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, ko };

const STORAGE_KEY = 'chess-vault:lang';

function initial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ko') return saved;
  } catch {
    // Private mode, or storage disabled — the browser's own language will do.
  }
  // No choice made yet: follow the browser rather than assume English.
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

/**
 * Deliberately NOT the zustand prefs store, which is where every other
 * display preference lives. `t()` has to be callable from module scope —
 * the option lists, the theme labels, the nav — and a hook is not. This is
 * the same shape zustand would build underneath anyway.
 */
export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not persisting is survivable; refusing to switch is not.
  }
  document.documentElement.lang = lang;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translate. Interpolates `{name}` placeholders, so a sentence stays one
 * string in the dictionary instead of being concatenated from fragments —
 * word order differs between English and Korean and fragments cannot be
 * reordered.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let out = dict[text] ?? text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${key}}`, String(value));
    }
  }
  return out;
}

/**
 * Is this name still the placeholder it was created with?
 *
 * Creation deliberately never asks for a name — "Untitled study 3" is the
 * cost of a zero-friction New button — but the shelves fill with them
 * because nothing ever asked again. This is how the views that CAN ask
 * (a nudge beside the title, the importer's suggestion) recognise a name
 * nobody chose. Checked against the English base and every translation
 * of it, because the placeholder was minted in whatever language was
 * active at the time and may be read in another.
 */
export function isUntitled(name: string, base: string): boolean {
  const bases = new Set([base]);
  for (const dict of Object.values(DICTS)) {
    if (dict[base]) bases.add(dict[base]);
  }
  return [...bases].some((b) => name === b || (name.startsWith(b) && /^ \d+$/.test(name.slice(b.length))));
}

/**
 * Subscribe a component to the language.
 *
 * Call sites use the plain `t()` — it reads module state, so it is correct
 * in a list constant or a helper as much as in a component, which a hook
 * could never be. This is only for the one component that has to re-render
 * when the language changes: the shell keys itself on it.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Set `<html lang>` once at startup so screen readers get it right. */
export function initLang(): void {
  document.documentElement.lang = current;
}
