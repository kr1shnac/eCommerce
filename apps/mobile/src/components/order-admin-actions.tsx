import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput } from 'react-native';

import { currentLanguage } from '@/store/language-store';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { kannadaInputFont } from '@/constants/fonts';
import { useAdminCancelOrder, useAdminForceComplete } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import type { Order } from '@/types/database';

/**
 * The shop's two status actions on somebody else's order: cancel it for them,
 * and mark it delivered when the tracker never heard back.
 *
 * WHY BOTH EXIST
 *
 *   * A customer rings the shop: "my brother already brought the milk." Today
 *     the owner has to get that person to open the app and tap cancel. If they
 *     cannot reach them, the stock stays held and the shelf lies to everyone
 *     else who opens it.
 *   * A rider's phone dies mid-delivery and the order never reaches `delivered`.
 *     The customer has the bag and the day's takings are short.
 *
 * Both go through the RPCs, never a plain update: a non-admin's update is
 * filtered to zero rows and raises nothing, so a button built on it would say
 * "Done" while nothing changed. Both refuse a terminal order, so a `failed`
 * delivery can never be quietly reopened as `delivered`, and neither one sets
 * `payment_status` — settling cash is the money desk's job, not a side effect of
 * a status change.
 *
 * Owner-only on the shared order screen. The buttons appear only in the states
 * the database accepts, so a button can never be offered for an action that
 * would be refused.
 */
export function OrderAdminActions({ order }: { order: Order }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const cancel = useAdminCancelOrder();
  const complete = useAdminForceComplete();
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);

  // Exactly the states the RPCs accept: live orders can be cancelled, live
  // orders can be completed, and neither can happen twice.
  const canCancel = !['delivered', 'cancelled', 'failed', 'returned'].includes(order.status);
  const canComplete = order.status !== 'delivered' && canCancel;

  // Nothing to offer on a finished order.
  if (!canCancel) return null;

  const busy = cancel.isPending || complete.isPending;

  const run = async (action: 'cancel' | 'complete') => {
    if (busy) return;
    setFailed(false);
    try {
      if (action === 'cancel') {
        await cancel.mutateAsync({ orderId: order.id, reason });
      } else {
        await complete.mutateAsync(order.id);
      }
      setReason('');
    } catch (error) {
      console.warn('[order] admin action failed', error);
      setFailed(true);
    }
  };

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('order.adminTitle')}
      </ThemedText>

      {canComplete ? (
        <>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {t('order.adminCompleteHint')}
          </ThemedText>
          <Pressable
            onPress={() => void run('complete')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('order.adminCompleteAction')}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.successSoft, borderColor: theme.success },
              { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText type="bodyStrong" style={{ color: theme.successInk }}>
              {complete.isPending ? t('common.pleaseWait') : t('order.adminCompleteAction')}
            </ThemedText>
          </Pressable>
        </>
      ) : null}

      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {t('order.adminCancelHint')}
      </ThemedText>

      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder={t('order.adminCancelReasonPlaceholder')}
        placeholderTextColor={theme.textTertiary}
        editable={!busy}
        maxLength={200}
        accessibilityLabel={t('order.adminCancelReason')}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
          kannadaInputFont(currentLanguage()),
        ]}
      />

      <Pressable
        onPress={() => void run('cancel')}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('order.adminCancelAction')}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
          { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
        ]}>
        <ThemedText type="bodyStrong" style={{ color: theme.dangerInk }}>
          {cancel.isPending ? t('common.pleaseWait') : t('order.adminCancelAction')}
        </ThemedText>
      </Pressable>

      {failed ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t('order.adminFailed')}
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
  input: {
    minHeight: 48,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
});