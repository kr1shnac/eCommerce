import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useNetworkStatus } from '@/hooks/use-network';
import { useTheme } from '@/hooks/use-theme';

/**
 * One banner, shown under the header, whenever the phone has no internet.
 * Drop it at the top of any screen that loads data.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.accentSoft, paddingTop: insets.top }]}>
      <ThemedText type="smallBold" style={[styles.text, { color: theme.accent }]}>
        {t('common.offline')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    alignItems: 'center',
  },
  text: {
    textAlign: 'center',
  },
});