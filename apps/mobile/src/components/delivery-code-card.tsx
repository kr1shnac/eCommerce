import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useDeliveryCode } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';

/**
 * The four digits the customer reads to the rider at the door.
 *
 * This is the customer's half of the handover (migration 20261106000003). The
 * code only exists while the bag is out for delivery, so the card is rendered
 * by the order screen for that state only, and the database answers
 * `not_available` the moment it is spent.
 *
 * Why a code at all: without it the rider's only honest options at a locked
 * gate are "lie and press delivered" or leave the order hanging all evening.
 * The code makes the handover a fact both people agree on.
 *
 * Rule 9.2: loading says so, a failure offers Retry, and a dead code is never
 * left on screen — the server is asked each time rather than trusted from a
 * cache.
 */
export function DeliveryCodeCard({
  orderId,
  isOwner,
}: {
  orderId: string;
  /** Staff open this order screen too; only the customer who ordered sees this. */
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const code = useDeliveryCode(isOwner ? orderId : null);

  if (!isOwner) return null;

  const head = (
    <View style={styles.head}>
      <Ionicons name="keypad-outline" size={20} color={theme.accent} />
      <ThemedText type="smallBold" style={[styles.flex, { color: theme.accent }]}>
        {t('order.codeTitle')}
      </ThemedText>
    </View>
  );

  if (code.isLoading) {
    return (
      <Card tone="accent" style={styles.card}>
        {head}
        <ThemedText type="small" themeColor="textSecondary">
          {t('common.loading')}
        </ThemedText>
      </Card>
    );
  }

  if (code.isError) {
    return (
      <Card style={styles.card}>
        {head}
        <ThemedText type="small" themeColor="textSecondary">
          {t('order.codeError')}
        </ThemedText>
        <Button
          label={t('common.retry')}
          icon="refresh"
          variant="outline"
          fullWidth
          onPress={() => void code.refetch()}
        />
      </Card>
    );
  }

  // Not available: the order is not out for delivery any more, or the code has
  // already been used. Say the true thing rather than a red error.
  if (!code.data?.ok) {
    return (
      <Card style={styles.card}>
        {head}
        <ThemedText type="small" themeColor="textSecondary">
          {t('order.codeNotAvailable')}
        </ThemedText>
      </Card>
    );
  }

  const digits = code.data.code.split('');
  // Spoken one digit at a time. Without the spaces a screen reader may read
  // "1234" as a single number, which is not how a person says a code.
  const spoken = digits.join(' ');

  return (
    <Card tone="accent" style={styles.card}>
      {head}

      <View
        style={styles.digits}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('order.codeA11y', { code: spoken })}>
        {digits.map((digit, index) => (
          <View
            key={`${digit}-${index}`}
            style={[
              styles.digitBox,
              { backgroundColor: theme.card, borderColor: theme.accentBorder },
            ]}>
            <ThemedText type="display" style={styles.digit}>
              {digit}
            </ThemedText>
          </View>
        ))}
      </View>

      <ThemedText type="bodyStrong" style={{ color: theme.accent }}>
        {t('order.codeHint')}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {t('order.codePrivacy')}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  digits: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.two,
    marginVertical: Spacing.one,
  },
  digitBox: {
    width: 56,
    height: 64,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Monospaced so the four digits sit on one grid, whatever the system face.
  digit: { fontFamily: 'monospace', letterSpacing: 0 },
});
