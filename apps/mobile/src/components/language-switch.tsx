import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LANGUAGES, type Language } from '@/i18n';
import { useLanguageStore } from '@/store/language-store';

const LABELS: Record<Language, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
};

/** The letter shown on the one-tap toggle: what tapping will take you TO. */
const TOGGLE_GLYPH: Record<Language, string> = {
  en: 'ಕ', // currently English -> tap for Kannada
  kn: 'A', // currently Kannada -> tap for English
};

type LanguageSwitchProps = {
  /** Hide the "App language" caption (for a header). */
  compact?: boolean;
  /**
   * `segmented` shows both options as one either/or control.
   * `toggle` is a single small button for a tight header — it switches to the
   * other language, and its letter names that language.
   */
  variant?: 'segmented' | 'toggle';
};

/**
 * The language control. Kannada is the default (see `i18n/index.ts`) and the
 * choice is remembered on the device. A `toggle` is offered for the home header,
 * because language is the one setting a person may need before they can read
 * anything else on the screen.
 */
export function LanguageSwitch({ compact = false, variant = 'segmented' }: LanguageSwitchProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  if (variant === 'toggle') {
    const next: Language = language === 'kn' ? 'en' : 'kn';
    return (
      <Pressable
        onPress={() => void setLanguage(next)}
        accessibilityRole="button"
        accessibilityLabel={`${t('account.languageLabel')}: ${LABELS[next]}`}
        style={({ pressed }) => [
          styles.toggle,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold" style={[styles.toggleGlyph, { color: theme.accent }]}>
          {TOGGLE_GLYPH[language]}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      {!compact ? <ThemedText type="smallBold">{t('account.languageLabel')}</ThemedText> : null}
      <View
        accessibilityRole="radiogroup"
        style={[
          styles.track,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}>
        {LANGUAGES.map((code) => {
          const isActive = code === language;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={LABELS[code]}
              onPress={() => void setLanguage(code)}
              style={({ pressed }) => [
                styles.option,
                isActive && { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: isActive ? theme.onAccent : theme.textSecondary }}>
                {LABELS[code]}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
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
    minWidth: 88,
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
  toggleGlyph: { fontSize: 18 },
  pressed: { opacity: 0.75 },
});
