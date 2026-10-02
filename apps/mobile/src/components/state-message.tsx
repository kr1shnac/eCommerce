import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The three states every data screen must have (rule 9.2): loading, empty, and
 * an error with a Retry button. Written once here so no screen can forget one.
 *
 * Notice there is no place to put a raw error message. The caller passes a
 * TRANSLATED hint, because `error.message` from PostgREST is for the console,
 * not for a customer in Kunigal.
 */

type StateMessageProps = {
  title: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: 'neutral' | 'danger';
};

export function StateMessage({ title, hint, onRetry, retryLabel, tone = 'neutral' }: StateMessageProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ThemedText
        type="smallBold"
        style={tone === 'danger' ? { color: theme.danger, textAlign: 'center' } : { textAlign: 'center' }}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel ?? t('common.retry')}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {retryLabel ?? t('common.retry')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.accent} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {label ?? t('common.loading')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  hint: {
    textAlign: 'center',
  },
  retry: {
    // 44px minimum tap target (rule 9.9), even though the text is 14px.
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});