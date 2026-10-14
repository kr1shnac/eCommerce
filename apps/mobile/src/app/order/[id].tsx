import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallShop } from '@/components/call-shop';
import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { CancelOrderRejected, useCancelOrder, useOrder } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { orderStatusStyle } from '@/lib/order-status';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cart-store';
import type { OrderStatus } from '@/types/database';

/**
 * One order: what was bought, what it cost, where it is going, and how to stop
 * it. Every number here comes from the snapshot the database wrote, so it cannot
 * change under the customer's feet if the shop edits a price later.
 *
 * The status is the headline: a badge at the top (icon + colour + word) and then
 * the same four stops drawn as a tracker, so a customer who reads slowly still
 * sees *how far along* the bag is without reading a sentence.
 */
export default function OrderDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; placed?: string }>();

  const orderId = typeof params.id === 'string' ? params.id : null;
  const justPlaced = params.placed === '1';

  const order = useOrder(orderId);
  const cancelOrder = useCancelOrder();
  const replaceAll = useCartStore((state) => state.replaceAll);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const data = order.data;
  const canCancel = data?.status === 'placed';
  const address = data?.delivery_address as
    | {
        full_name?: string;
        phone?: string;
        line1?: string;
        line2?: string;
        landmark?: string;
        city?: string;
        pincode?: string;
      }
    | null
    | undefined;

  const onCancel = async () => {
    if (!orderId || cancelOrder.isPending) return;
    setCancelError(null);
    try {
      await cancelOrder.mutateAsync(orderId);
    } catch (error) {
      if (error instanceof CancelOrderRejected) {
        setCancelError(`orders.cancelError.${error.result.error}`);
        return;
      }
      console.warn('[order] could not cancel', error);
      setCancelError('orders.cancelError.unknown');
    }
  };

  /**
   * Put the same things back in the basket. Prices are NOT copied — the cart
   * reads them live, and `useCart` re-checks stock, so a reorder of something
   * that has since sold out surfaces as an adjustment rather than a surprise.
   */
  const onReorder = () => {
    const items: Record<string, number> = {};
    for (const item of data?.order_items ?? []) {
      if (!item.product_id) continue;
      items[item.product_id] = (items[item.product_id] ?? 0) + item.quantity;
    }
    replaceAll(items);
    router.push('/(tabs)/cart');
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  const status = data?.status ?? 'placed';
  const statusStyle = orderStatusStyle(theme, status);

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={styles.headerRow}>
        <IconButton
          icon="arrow-back"
          label={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/orders'))}
        />
        <ThemedText type="subtitle" style={styles.flex} numberOfLines={1}>
          {data?.order_number ?? t('order.title')}
        </ThemedText>
        {data ? (
          <Badge
            label={t(`orders.status.${status}`)}
            tone={statusStyle.tone}
            icon={statusStyle.icon}
          />
        ) : null}
      </View>

      {order.isLoading ? (
        <LoadingState />
      ) : order.isError || !data ? (
        <StateMessage
          title={t('order.errorTitle')}
          hint={t('order.errorHint')}
          onRetry={order.refetch}
          tone="danger"
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
          {justPlaced ? (
            <Card tone="accent" style={styles.success}>
              <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
              <ThemedText type="smallBold" style={styles.flex}>
                {t('order.placedTitle')}
              </ThemedText>
            </Card>
          ) : null}

          <Card style={styles.section}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('order.trackTitle')}
            </ThemedText>
            <StatusRow status={data.status} />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Row label={t('order.placedAt')} value={formatDate(data.placed_at)} />
            {data.estimated_delivery_at ? (
              <Row label={t('order.estimatedAt')} value={formatDate(data.estimated_delivery_at)} />
            ) : null}
            <Row label={t('order.payment')} value={t(`order.pay.${data.payment_method}`)} />
            <Row label={t('order.paymentStatus')} value={t(`order.payStatus.${data.payment_status}`)} />
          </Card>

          <ThemedText type="heading" style={styles.sectionTitle}>
            {t('order.itemsTitle')}
          </ThemedText>
          <Card style={styles.section}>
            {data.order_items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <ThemedText type="small" numberOfLines={2} style={styles.flex}>
                  {`${item.quantity} × ${localizedItemName(item)}`}
                  <ThemedText type="small" themeColor="textSecondary">
                    {` ${item.unit}`}
                  </ThemedText>
                </ThemedText>
                <ThemedText type="small">{formatPaise(item.line_total_paise)}</ThemedText>
              </View>
            ))}

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

            <Row label={t('checkout.subtotal')} value={formatPaise(data.subtotal_paise)} />
            <Row label={t('checkout.deliveryFee')} value={formatPaise(data.delivery_fee_paise)} />
            {data.discount_paise > 0 ? (
              <Row label={t('checkout.discount')} value={`-${formatPaise(data.discount_paise)}`} />
            ) : null}
            <Row label={t('checkout.total')} value={formatPaise(data.total_paise)} strong />
            <ThemedText type="small" themeColor="textSecondary">
              {t('order.payAtDelivery', { amount: formatPaise(data.total_paise) })}
            </ThemedText>
          </Card>

          <ThemedText type="heading" style={styles.sectionTitle}>
            {t('order.deliverToTitle')}
          </ThemedText>
          <Card style={styles.section}>
            <ThemedText type="smallBold">{address?.full_name ?? ''}</ThemedText>
            {address?.phone ? (
              <ThemedText type="small" themeColor="textSecondary">
                {address.phone}
              </ThemedText>
            ) : null}
            <ThemedText type="small">
              {[
                address?.line1,
                address?.line2,
                address?.landmark ? `${t('order.near')} ${address.landmark}` : null,
                [address?.city, address?.pincode].filter(Boolean).join(' '),
              ]
                .filter(Boolean)
                .join(', ')}
            </ThemedText>
          </Card>

          {data.notes ? (
            <>
              <ThemedText type="heading" style={styles.sectionTitle}>
                {t('checkout.noteTitle')}
              </ThemedText>
              <Card style={styles.section}>
                <ThemedText type="small">{data.notes}</ThemedText>
              </Card>
            </>
          ) : null}

          <CallShop />

          {cancelError ? (
            <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
              {t(cancelError)}
            </ThemedText>
          ) : null}

          <Button
            label={t('order.reorder')}
            icon="repeat"
            size="lg"
            fullWidth
            onPress={onReorder}
            style={styles.action}
          />

          {canCancel ? (
            <Button
              label={cancelOrder.isPending ? t('common.pleaseWait') : t('order.cancel')}
              icon="close-circle-outline"
              variant="outline"
              size="lg"
              fullWidth
              busy={cancelOrder.isPending}
              onPress={() => void onCancel()}
              style={styles.action}
            />
          ) : null}

          <Button
            label={t('order.shopAgain')}
            variant="ghost"
            fullWidth
            onPress={() => router.push('/')}
          />
        </ScrollView>
      )}
    </View>
  );
}

/** The four stops a customer actually cares about, each with its own icon. */
const TRACK_STEPS: {
  statuses: OrderStatus[];
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { statuses: ['placed', 'confirmed'], labelKey: 'order.step.placed', icon: 'receipt-outline' },
  { statuses: ['packing'], labelKey: 'order.step.packed', icon: 'bag-handle-outline' },
  { statuses: ['out_for_delivery'], labelKey: 'order.step.onTheWay', icon: 'bicycle-outline' },
  { statuses: ['delivered'], labelKey: 'order.step.delivered', icon: 'home-outline' },
];

function StatusRow({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const style = orderStatusStyle(theme, status);

  if (status === 'cancelled') {
    return (
      <View style={styles.steps}>
        <ThemedText type="smallBold" style={{ color: theme.dangerInk }}>
          {t('orders.status.cancelled')}
        </ThemedText>
      </View>
    );
  }

  const current = TRACK_STEPS.findIndex((step) => step.statuses.includes(status));

  return (
    <View
      style={styles.steps}
      accessibilityRole="progressbar"
      accessibilityLabel={t(`orders.status.${status}`)}>
      {TRACK_STEPS.map((step, index) => {
        const done = index <= current;
        const isCurrent = index === current;
        return (
          <Fragment key={step.labelKey}>
            <View style={styles.step}>
              <View
                style={[
                  styles.stepIcon,
                  {
                    backgroundColor: done ? style.color : theme.backgroundElement,
                    borderColor: done ? style.color : theme.border,
                    borderWidth: isCurrent ? 3 : 1,
                  },
                ]}>
                <Ionicons
                  name={step.icon}
                  size={15}
                  color={done ? theme.background : theme.textSecondary}
                />
              </View>
              <ThemedText
                type="caption"
                themeColor={done ? 'text' : 'textSecondary'}
                style={styles.stepLabel}
                numberOfLines={2}>
                {t(step.labelKey)}
              </ThemedText>
            </View>
            {index < TRACK_STEPS.length - 1 ? (
              <View
                style={[
                  styles.line,
                  { backgroundColor: index < current ? style.color : theme.border },
                ]}
              />
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const text = strong ? 'smallBold' : 'small';
  return (
    <View style={styles.itemRow}>
      <ThemedText type={text} style={styles.flex} themeColor={strong ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
      <ThemedText type={text}>{value}</ThemedText>
    </View>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  success: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  section: { gap: Spacing.one },
  sectionTitle: { marginTop: Spacing.three },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  steps: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, alignItems: 'center', gap: Spacing.one },
  stepIcon: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { textAlign: 'center' },
  line: { width: 18, height: 3, borderRadius: 2, marginTop: 16 },
  action: { marginTop: Spacing.two },
});
