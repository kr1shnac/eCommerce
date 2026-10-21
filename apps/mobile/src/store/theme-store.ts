import { deviceStorage } from '@/lib/storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Light or dark, and who decides.
 *
 * `system` is the default and the recommended choice: it follows the phone, so a
 * customer who has already set their handset to dark for the evening gets a dark
 * shop without hunting for a setting. The manual `light` / `dark` options exist
 * because the shop owner may want the board bright all day, and because the
 * sales counter's phone is often pinned to one mode.
 *
 * The choice lives on the device (AsyncStorage), not in the database: it is a
 * property of the phone, not of the account, so it survives sign-out.
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

type ThemeState = {
  preference: ThemePreference;
  /** False until AsyncStorage has been read, so the splash stays up one beat. */
  isReady: boolean;
  setPreference: (preference: ThemePreference) => void;
  setReady: (value: boolean) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      isReady: false,

      setPreference: (preference) =>
        set({ preference: isThemePreference(preference) ? preference : 'system' }),

      setReady: (value) => set({ isReady: value }),
    }),
    {
      name: 'kunigal.theme',
      storage: createJSONStorage(() => deviceStorage),
      partialize: (state) => ({ preference: state.preference }),
      onRehydrateStorage: () => (state) => {
        state?.setReady(true);
      },
    },
  ),
);
