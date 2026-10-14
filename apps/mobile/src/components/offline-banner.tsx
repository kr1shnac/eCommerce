import { Ionicons } from '@expo/vector-icons';
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
 *
 * It is a calm amber strip, not a red alarm: in a town on patchy 4G, being
 * offline for a moment is ordinary, and a modal per request would train people
 * to dismiss the app (rule 9.3).
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
      accessibilityLabel={t('common.offline')}
      style={[styles.banner, { backgroundColor: theme.warningSoft, paddingTop: insets.top }]}>
      <Ionicons name="cloud-offline-outline" size={16} color={theme.warning} />
      <ThemedText type="smallBold" style={[styles.text, { color: theme.warning }]}>
        {t('common.offline')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  text: { textAlign: 'center' },
});
