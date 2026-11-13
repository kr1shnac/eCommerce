import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';

/**
 * "Some items ran out" — the customer's copy of a shortage the shop settled.
 *
 * `admin_adjust_order_item()` lowers a line and recomputes the books, and
 * until now the customer's screen simply showed a different total with no
 * sentence about why. A bag that arrives smaller than the receipt said, with
 * no word from the shop, reads as theft even when it was a shortage honestly
 * settled over the phone. `orders.shortage_adjusted_at` (migration
 * 20261113000003) is the stamp the shop writes when it corrects a bag; this
 * card renders that stamp, or nothing.
 *
 * The money line is the database's own record, not a recomputation: the shop
 * owes back `shortage_refund_paise` only when the customer had already paid
 * online for packs that will not come — cash orders are simply paid for at
 * the door. While the amount is unsettled the card says it will come back;
 * once `shortage_refund_paid_at` is stamped it says it has. No method, no
 * deadline is invented here — the Call the shop button further down is the
 * way to arrange it, exactly as the refund card does.
 */
export function ShortageNoticeCard({
  adjustedAt,
  totalPaise,
  refundPaise,
  refundPaidAt,
  isOwner,
}: {
  /** `orders.shortage_adjusted_at` — NULL means the bag was never changed. */
  adjustedAt: string | null;
  /** `orders.total_paise` — the corrected total the books now carry. */
  totalPaise: number;
  /** `orders.shortage_refund_paise` — 0 for cash, or for nothing recorded. */
  refundPaise: number;
  /** `orders.shortage_refund_paid_at` — stamped when the money went back. */
  refundPaidAt: string | null;
  /** Staff open this screen too; the notice is for the person who ordered. */
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!isOwner || adjustedAt == null) return null;

  return (
    <Card tone="warning" style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="remove-circle-outline" size={20} color={theme.warningInk} />
        <ThemedText type="smallBold" style={[styles.flex, { color: theme.warningInk }]}>
          {t('orders.shortageTitle')}
        </ThemedText>
      </View>
      <ThemedText type="small" style={{ color: theme.warningInk }}>
        {t('orders.shortageBody')}
      </ThemedText>
      <ThemedText type="small" style={{ color: theme.warningInk }}>
        {t('orders.shortageTotalLine', { amount: formatPaise(totalPaise) })}
      </ThemedText>
      {refundPaise > 0 ? (
        <ThemedText type="smallBold" style={{ color: theme.warningInk }}>
          {refundPaidAt
            ? t('orders.shortageRefundPaid', { amount: formatPaise(refundPaise) })
            : t('orders.shortageRefundDue', { amount: formatPaise(refundPaise) })}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
});
