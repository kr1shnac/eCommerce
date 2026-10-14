import { create } from 'zustand';

import i18n, {
  DEFAULT_LANGUAGE,
  isLanguage,
  loadStoredLanguage,
  saveLanguage,
  type Language,
} from '@/i18n';

type LanguageState = {
  language: Language;
  /** False until we have read the saved preference. */
  isReady: boolean;
  setLanguage: (language: Language) => Promise<void>;
  hydrate: () => Promise<void>;
};

/**
 * The one place the app's current language lives.
 *
 * i18next is kept in step with it, but it is NOT the source of truth. Before,
 * two things claimed to know the language — this store (used by the Kannada font
 * and the tab bar) and `i18n.language` (used by `t()` and the DB-name helpers) —
 * and they were updated in two steps, so for a moment the app could paint English
 * labels over Kannada names. Everything now reads from `current`, and switching
 * updates i18next first, so no frame is half in each language.
 */
let current: Language = DEFAULT_LANGUAGE;

export const useLanguageStore = create<LanguageState>((set) => ({
  language: current,
  isReady: false,

  setLanguage: async (language) => {
    if (!isLanguage(language) || language === current) return;
    // Our value, i18next and the store all change inside ONE tick. With bundled
    // resources `changeLanguage` updates synchronously, so React batches the
    // i18next event and the store write into a single render — no frame can be
    // half English labels and half Kannada names.
    current = language;
    void i18n.changeLanguage(language);
    set({ language });
    await saveLanguage(language);
  },

  hydrate: async () => {
    const stored = await loadStoredLanguage();
    const language = isLanguage(stored) ? stored : current;
    current = language;
    if (language !== i18n.language) void i18n.changeLanguage(language);
    set({ language, isReady: true });
  },
}));

/** Current language, for places outside React (e.g. picking name_en vs name_kn). */
export function currentLanguage(): Language {
  return current;
}