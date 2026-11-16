import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useAdminAdjustOrderItem } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { dialablePhone, readSnapshotAddress } from '@/lib/order-view';
import type { Order, OrderItem, OrderStatus } from '@/types/database';

/**
 * The shop settles a shortage from the counter: the shelf came up short, so a
 * line goes DOWN to what can actually be given, or off the order entirely.
 *
 * The write is `admin_adjust_order_item()` (migration 20261112000009) and the
 * panel offers exactly what the database accepts — no more:
 *
 *   * only LESS. There is deliberately no "+" — a shortage means less, and a
 *     button that always ends in an error is a lie with a border.
 *   * "Take off the order" is refused by the RPC on the last line, so it is
 *     disabled here with the sentence that says what to do instead (cancel
 *     the order). The screen states the refusal before the tap, not after.
 *
 * Every tap is one safe call: the released packs go back on the shelf and the
 * totals are recomputed in the same transaction, so the books agree however
 * far the owner got before the signal dropped.
 */

const LIVE_STATUSES: OrderStatus[] = ['placed', 'confirmed', 'packing'];

export function OrderShortagePanel({ order, items }: { order: Order; items: OrderItem[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const adjust = useAdminAdjustOrderItem();
  const [failed, setFailed] = useState(false);

  const isLive = LIVE_STATUSES.includes(order.status);
  if (!isLive || items.length === 0) return null;

  const lastLine = items.length === 1;
  // A phone order carries its own contact; an app order's number lives in the
  // address snapshot. One number either way — the person the rider will call.
  const phone = dialablePhone(order.contact_phone ?? readSnapshotAddress(order).phone);

  const run = async (itemId: string, quantity: number) => {
    if (adjust.isPending) return;
    setFailed(false);
    try {
      await adjust.mutateAsync({ orderId: order.id, itemId, quantity });
    } catch (error) {
      console.warn('[order] shortage adjust failed', error);
      setFailed(true);
    }
  };

  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('order.shortageTitle')}
      </ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {t('order.shortageHint')}
      </ThemedText>

      {items.map((item) => {
        const busy = adjust.isPending && adjust.variables?.itemId === item.id;
        const disabled = adjust.isPending || busy;

        return (
          <View key={item.id} style={styles.line}>
            <View style={styles.lineText}>
              <ThemedText type="small" numberOfLines={2}>
                {`${item.quantity} × ${localizedItemName(item)}`}
                <ThemedText type="small" themeColor="textSecondary">
                  {` ${item.unit}`}
                </ThemedText>
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {formatPaise(item.line_total_paise)}
              </ThemedText>
            </View>

            <View style={styles.lineActions}>
              {item.quantity > 1 ? (
                <Pressable
                  onPress={() => void run(item.id, item.quantity - 1)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('order.shortageLess')}, ${localizedItemName(item)}`}
                  accessibilityState={{ disabled, busy }}
                  style={({ pressed }) => [
                    styles.pill,
                    { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                    { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 },
                  ]}>
                  <ThemedText type="smallBold">{busy ? t('common.pleaseWait') : t('order.shortageLess')}</ThemedText>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => void run(item.id, 0)}
                disabled={disabled || lastLine}
                accessibilityRole="button"
                accessibilityLabel={`${t('order.shortageRemove')}, ${localizedItemName(item)}`}
                accessibilityState={{ disabled: disabled || lastLine, busy }}
                style={({ pressed }) => [
                  styles.pill,
                  { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
                  { opacity: disabled || lastLine ? 0.55 : pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.dangerInk }}>
                  {busy ? t('common.pleaseWait') : t('order.shortageRemove')}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        );
      })}

      {lastLine ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {t('order.shortageLastLine')}
        </ThemedText>
      ) : null}

      {failed ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t('order.adminFailed')}
        </ThemedText>
      ) : null}

      {/*
        A shorter bag is a phone call the customer has to hear about: they paid
        for six and will receive four. The button is here, next to the change,
        because that is the moment the call needs making — not buried on another
        screen. Only opens the dialler, pre-filled; nothing is dialled silently.
      */}
      {phone ? (
        <Pressable
          onPress={() => {
            Linking.openURL(`tel:${phone}`).catch((error) => {
              console.warn('[order] could not open dialler', error);
            });
          }}
          accessibilityRole="button"
          accessibilityLabel={t('order.callCustomer')}
          style={({ pressed }) => [
            styles.callButton,
            { borderColor: theme.accentBorder, backgroundColor: theme.accentSoft },
            { opacity: pressed ? 0.85 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {t('order.callCustomer')}
          </ThemedText>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  lineText: {
    flex: 1,
    gap: Spacing.one,
  },
  lineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.one,
  },
  pill: {
    minHeight: 44,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  callButton: {
    minHeight: 44,
    borderRadius: Radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
