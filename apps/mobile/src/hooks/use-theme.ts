import { Colors, type Theme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeStore } from '@/store/theme-store';

/**
 * Which palette is active: the customer's explicit choice, or the phone's.
 *
 * This is the single source of the answer for the whole app, including the
 * navigation container's own theme and the status bar in `app/_layout.tsx`, so a
 * screen never disagrees with the tab bar about light or dark.
 */

export type ResolvedScheme = 'light' | 'dark';

export function useResolvedScheme(): ResolvedScheme {
  const preference = useThemeStore((state) => state.preference);
  const system = useColorScheme();

  if (preference === 'system') return system === 'dark' ? 'dark' : 'light';
  return preference;
}

export function useTheme(): Theme {
  return Colors[useResolvedScheme()];
}
