import { Ionicons } from '@expo/vector-icons';
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

/**
 * The short chip shown in a header. It names the language you are IN, not the one
 * you would switch to: a compact button that read "ಕ" while the app was in
 * English looked like a stray Kannada letter rather than a control, which is how
 * the header ended up feeling half-translated.
 */
const SHORT_LABELS: Record<Language, string> = {
  en: 'EN',
  kn: 'ಕನ',
};

type LanguageSwitchProps = {
  /** Hide the "App language" caption (for a header). */
  compact?: boolean;
  /**
   * `segmented` shows both options as one either/or control.
   * `toggle` is a single small pill for a tight header: it shows a globe and the
   * language you are in (EN / ಕನ), and tapping it moves you to the other one.
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
        <Ionicons name="globe-outline" size={16} color={theme.accent} />
        <ThemedText type="smallBold" style={{ color: theme.text }}>
          {SHORT_LABELS[language]}
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.75 },
});
