import { useSyncExternalStore } from 'react';

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

/**
 * Dictionaries load on demand: the Korean file is ~1,200 sentences that
 * used to ride the LANDING chunk for every English user, directly against
 * the "landing chunk stays lean" rule the shell documents. English is the
 * keys themselves; anything else is fetched before the language flips
 * (and awaited at boot when the saved language needs it), so no frame
 * ever paints untranslated.
 */
const DICTS: Record<Lang, Record<string, string>> = { en: {}, ko: {} };

async function ensureDict(lang: Lang): Promise<void> {
  if (lang === 'en' || Object.keys(DICTS[lang]).length > 0) return;
  DICTS.ko = (await import('./ko.ts')).ko;
}

/**
 * The placeholder names, known in EVERY language even before its
 * dictionary loads: isUntitled() must recognise a shelf name minted in
 * Korean from an English session that never fetched ko.ts. The Korean
 * dictionary builds its own entries from this table, so the two cannot
 * drift.
 */
export const UNTITLED_NAMES: Record<Lang, Record<string, string>> = {
  en: {},
  ko: {
    'Untitled study': '제목 없는 스터디',
    'Untitled note': '제목 없는 노트',
    'Untitled book': '제목 없는 책',
  },
};

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
  // The dictionary arrives before the language flips, so the shell's
  // keyed remount never paints a frame of untranslated UI.
  void ensureDict(lang).then(() => {
    current = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not persisting is survivable; refusing to switch is not.
    }
    document.documentElement.lang = lang;
    for (const notify of listeners) notify();
  });
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
  // UNTITLED_NAMES, not the dictionaries: those load lazily, and the
  // recognition must work for names minted in a language this session
  // never loaded.
  for (const names of Object.values(UNTITLED_NAMES)) {
    if (names[base]) bases.add(names[base]);
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

/** Load the saved language's dictionary and set `<html lang>`. Awaited
    before the first render, so a Korean session never flashes English. */
export async function initLang(): Promise<void> {
  await ensureDict(current);
  document.documentElement.lang = current;
}
