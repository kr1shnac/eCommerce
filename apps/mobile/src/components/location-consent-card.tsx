import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The rider's one-time location consent (register M3 — consent before tracking).
 *
 * Shown on the rider screen until the rider agrees. One language at a time,
 * matching the rest of the app: the screen renders whichever language is
 * chosen, never both side by side.
 *
 * The Kannada wording here is a first draft in the shop-helper voice. It is
 * flagged for Kunigal local sign-off (KUNIGAL.md / PRODUCTION.md M7): changing
 * it is a one-key edit in the locales, no code change.
 */
export function LocationConsentCard({ onAgree, onSkip }: { onAgree: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card
      style={[
        styles.card,
        { backgroundColor: theme.warningSoft, borderColor: theme.warning },
      ]}>
      <ThemedText type="smallBold" style={[styles.title, { color: theme.warningInk }]}>
        {t('rider.locationTitle')}
      </ThemedText>
      <ThemedText type="caption" themeColor="warningInk" numberOfLines={4} style={styles.body}>
        {t('rider.locationBody')}
      </ThemedText>
      <View style={styles.actions}>
        <Button
          label={t('rider.locationAgree')}
          variant="primary"
          onPress={onAgree}
          fullWidth
          style={styles.button}
        />
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={t('rider.locationSkip')}
          style={styles.skip}>
          <ThemedText type="caption" themeColor="warningInk">
            {t('rider.locationSkip')}
          </ThemedText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.three,
  },
  title: { marginBottom: Spacing.one + 2 },
  body: { lineHeight: Spacing.five + 2 },
  actions: { gap: Spacing.two, marginTop: Spacing.one + 2 },
  button: { minHeight: 44 },
  skip: { alignSelf: 'flex-end' },
});
