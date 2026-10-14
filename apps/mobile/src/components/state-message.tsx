import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The three states every data screen must have (rule 9.2): loading, empty, and
 * an error with a Retry button. Written once here so no screen can forget one.
 *
 * Notice there is no place to put a raw error message. The caller passes a
 * TRANSLATED hint, because `error.message` from PostgREST is for the console,
 * not for a customer in Kunigal. Each state gets a big friendly picture, so the
 * screen still says something to a reader who cannot read the words.
 */

type StateMessageProps = {
  title: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: 'neutral' | 'danger';
  /** Overrides the default picture for the tone. */
  art?: string;
};

export function StateMessage({
  title,
  hint,
  onRetry,
  retryLabel,
  tone = 'neutral',
  art,
}: StateMessageProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const picture = art ?? (tone === 'danger' ? '📡' : '🧺');

  return (
    <View style={styles.container}>
      <View style={[styles.artWrap, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.art}>{picture}</ThemedText>
      </View>
      <ThemedText
        type="bodyStrong"
        style={[styles.title, tone === 'danger' ? { color: theme.danger } : undefined]}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
      {onRetry ? (
        <Button
          label={retryLabel ?? t('common.retry')}
          icon="refresh"
          variant="outline"
          onPress={onRetry}
          style={styles.retry}
        />
      ) : null}
    </View>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ActivityIndicator color={theme.accent} size="large" />
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
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  artWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  art: { fontSize: 42, lineHeight: 52 },
  title: { textAlign: 'center' },
  hint: { textAlign: 'center' },
  retry: { marginTop: Spacing.two, minWidth: 140 },
});
