import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LANGUAGES, type Language } from '@/i18n';
import { useLanguageStore } from '@/store/language-store';

const LABELS: Record<Language, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
};

export function LanguageSwitch() {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">{t('account.languageLabel')}</ThemedText>
      <View style={styles.row}>
        {LANGUAGES.map((code) => {
          const isActive = code === language;
          return (
            <Pressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => void setLanguage(code)}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isActive ? theme.accent : theme.background,
                  borderColor: isActive ? theme.accent : theme.border,
                },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: isActive ? '#ffffff' : theme.text }}>
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
  container: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
});