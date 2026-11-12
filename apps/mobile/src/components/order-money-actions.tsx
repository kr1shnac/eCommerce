import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useMarkCodCollected, useMarkRefundPaid } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import type { Order } from '@/types/database';

/**
 * The shop's two money actions on one order: take the cash, return the money.
 *
 * These exist because `shop_day_totals()` reports `cash_in_hand_paise` and
 * `refund_due_paise` on the owner's Today tab, and until now neither number had
 * a way to be cleared. A rider hands over a bundle of notes and the order stays
 * "pending" forever; the owner pays a refund by UPI and the shop keeps reporting
 * a liability it no longer has. Both are lies about money, and both are fixed by
 * one honest confirmation here.
 *
 * Only the owner sees this block (the order screen is shared by all three
 * faces). The buttons appear only when the database's own state says the action
 * is possible, so a button can never be shown for an action the RPC would
 * refuse. The write goes through the RPCs, never a plain update: a non-admin's
 * update is filtered to zero rows and raises nothing.
 */
export function OrderMoneyActions({ order }: { order: Order }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const collect = useMarkCodCollected();
  const refund = useMarkRefundPaid();
  const [failed, setFailed] = useState(false);

  // Exactly the states the RPCs accept. A delivered COD order whose cash is
  // still pending can be settled; a terminal-failure online order still marked
  // paid is the only refund case.
  const canCollect =
    order.payment_method === 'cod' &&
    order.status === 'delivered' &&
    order.payment_status !== 'paid';
  const canRefund = order.refund_due_paise > 0;

  if (!canCollect && !canRefund) return null;

  const busy = collect.isPending || refund.isPending;

  const run = async (action: 'collect' | 'refund') => {
    if (busy) return;
    setFailed(false);
    try {
      if (action === 'collect') {
        await collect.mutateAsync(order.id);
      } else {
        await refund.mutateAsync(order.id);
      }
    } catch (error) {
      console.warn('[order] money action failed', error);
      setFailed(true);
    }
  };

  return (
    <Card tone={canRefund ? 'warning' : 'surface'} style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('order.moneyTitle')}
      </ThemedText>

      {canCollect ? (
        <>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {t('order.moneyCollectHint', { amount: formatPaise(order.total_paise) })}
          </ThemedText>
          <Pressable
            onPress={() => void run('collect')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('order.moneyCollectAction')}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.accent, borderColor: theme.accent },
              { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="bodyStrong" style={{ color: theme.onAccent }}>
              {collect.isPending ? t('common.pleaseWait') : t('order.moneyCollectAction')}
            </ThemedText>
          </Pressable>
        </>
      ) : null}

      {canRefund ? (
        <>
          <ThemedText type="small" style={{ color: theme.warningInk }}>
            {t('order.moneyRefundHint', { amount: formatPaise(order.refund_due_paise) })}
          </ThemedText>
          <Pressable
            onPress={() => void run('refund')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('order.moneyRefundAction')}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.warningSoft, borderColor: theme.warning },
              { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="bodyStrong" style={{ color: theme.warningInk }}>
              {refund.isPending ? t('common.pleaseWait') : t('order.moneyRefundAction')}
            </ThemedText>
          </Pressable>
        </>
      ) : null}

      {failed ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t('order.moneyFailed')}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  button: {
    minHeight: 48,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
});
