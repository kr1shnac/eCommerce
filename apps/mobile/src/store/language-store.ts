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

export const useLanguageStore = create<LanguageState>((set) => ({
  language: i18n.language && isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE,
  isReady: false,

  setLanguage: async (language) => {
    if (!isLanguage(language)) return;
    set({ language });
    await i18n.changeLanguage(language);
    await saveLanguage(language);
  },

  hydrate: async () => {
    const stored = await loadStoredLanguage();
    const language = stored ?? i18n.language;
    if (isLanguage(language) && language !== i18n.language) {
      await i18n.changeLanguage(language);
    }
    set({ language: isLanguage(language) ? language : DEFAULT_LANGUAGE, isReady: true });
  },
}));

/** Current language, for places outside React (e.g. picking name_en vs name_kn). */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}