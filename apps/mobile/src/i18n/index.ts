import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { deviceStorage } from '@/lib/storage';
import en from './locales/en.json';
import kn from './locales/kn.json';

export const LANGUAGES = ['en', 'kn'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Kunigal-first: a fresh install starts in **Kannada**, because Kannada is what
 * nearly every customer in this town reads. English is one tap away in Account
 * and the choice is remembered (see `loadStoredLanguage`).
 *
 * The device language is deliberately **not** used to pick English. Most phones
 * here are left on the factory English default even though the person holding
 * the phone reads Kannada, so trusting the device locale would hand exactly the
 * wrong language to the people this app is for. See `KUNIGAL.md` §2.
 */
export const DEFAULT_LANGUAGE: Language = 'kn';
export const LANGUAGE_STORAGE_KEY = 'kunigal.language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

// createInstance() gives us our own i18next object instead of mutating the
// library's global default, which keeps the app self-contained.
const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    kn: { translation: kn },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  // Placeholders in this project are single-brace: "{count} items", "{amount}".
  // i18next's default is double-brace ("{{count}}"), so without this line every
  // placeholder would be shown to the customer verbatim. Declaring the
  // delimiters here (rather than rewriting every key to "{{...}}") keeps the
  // locale files readable. Enforced by scripts/check-i18n.mjs. See AGENTS.md 9.5.
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
});

export async function loadStoredLanguage(): Promise<Language | null> {
  try {
    const stored = await deviceStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function saveLanguage(language: Language): Promise<void> {
  try {
    await deviceStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persistence is a nice-to-have; never let it break the switch.
  }
}

export default i18n;