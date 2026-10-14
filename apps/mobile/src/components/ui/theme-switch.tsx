import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import { THEME_PREFERENCES, useThemeStore, type ThemePreference } from '@/store/theme-store';

/**
 * Light / dark / follow-the-phone.
 *
 * `System` is the default and is listed first, because a phone that is already
 * dark at night should give a dark shop without anybody finding this screen.
 */

const LABEL_KEY: Record<ThemePreference, string> = {
  system: 'common.themeSystem',
  light: 'common.themeLight',
  dark: 'common.themeDark',
};

export function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useTheme();
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">{t('common.appearance')}</ThemedText>
      <View
        accessibilityRole="radiogroup"
        style={[styles.track, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {THEME_PREFERENCES.map((option) => {
          const isActive = option === preference;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t(LABEL_KEY[option])}
              onPress={() => setPreference(option)}
              style={({ pressed }) => [
                styles.option,
                isActive && { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: isActive ? theme.onAccent : theme.textSecondary }}>
                {t(LABEL_KEY[option])}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A one-tap sun/moon for a tight header. It flips to the OPPOSITE of whatever is
 * on screen right now, which is what a person expects ("it is too bright, make
 * it dark"), and it shows the icon of the current mode rather than the action.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const setPreference = useThemeStore((state) => state.setPreference);

  const isDark = scheme === 'dark';

  return (
    <Pressable
      onPress={() => setPreference(isDark ? 'light' : 'dark')}
      accessibilityRole="button"
      accessibilityLabel={t('common.appearance')}
      hitSlop={8}
      style={({ pressed }) => [
        styles.toggle,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && styles.pressed,
      ]}>
      <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  option: {
    minHeight: 40,
    minWidth: 78,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
});
