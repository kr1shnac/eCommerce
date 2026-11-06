import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';

/**
 * "Money to come back to you" — the customer's half of a refund.
 *
 * The shop's Today tab has reported this liability since migration
 * 20261021000002, but the person owed the money was the last to know. The
 * amount comes from `orders.refund_due_paise`, a GENERATED column (migration
 * 20261106000002), so this card cannot disagree with the books: it renders the
 * database's own answer or it renders nothing.
 *
 * It states only what is true — money was taken online, the order is not being
 * delivered, the shop is holding it. No deadline, no "3–5 working days", no
 * promise about *how* it is returned: none of that is known here, and inventing
 * it would turn a fact into a complaint. The CallShop button already further
 * down the screen is the way to arrange it.
 */
export function RefundDueCard({
  amountPaise,
  isOwner,
}: {
  /** `orders.refund_due_paise`. 0 (or less) hides the card entirely. */
  amountPaise: number;
  /** Staff open this screen too; only the customer who paid sees this. */
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!isOwner || amountPaise <= 0) return null;

  return (
    <Card tone="warning" style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="arrow-undo-outline" size={20} color={theme.warningInk} />
        <ThemedText type="smallBold" style={[styles.flex, { color: theme.warningInk }]}>
          {t('refund.title')}
        </ThemedText>
      </View>
      <ThemedText type="subtitle" style={{ color: theme.warningInk }}>
        {t('refund.amountLine', { amount: formatPaise(amountPaise) })}
      </ThemedText>
      <ThemedText type="small" style={{ color: theme.warningInk }}>
        {t('refund.hint')}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
});
