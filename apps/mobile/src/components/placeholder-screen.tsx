import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type PlaceholderScreenProps = {
  emoji: string;
  titleKey: 'cart.title' | 'orders.title' | 'account.title';
  textKey: 'cart.placeholder' | 'orders.placeholder' | 'account.placeholder';
  children?: React.ReactNode;
};

/**
 * Shared shell for the screens that are not built yet, so they all look the
 * same and are obvious placeholders rather than broken screens.
 */
export function PlaceholderScreen({ emoji, titleKey, textKey, children }: PlaceholderScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + Spacing.three }]}>
      <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      <ThemedText style={styles.title}>{t(titleKey)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {t(textKey)}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emoji: {
    fontSize: 44,
    marginTop: Spacing.four,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  text: {
    textAlign: 'center',
    lineHeight: 20,
  },
});