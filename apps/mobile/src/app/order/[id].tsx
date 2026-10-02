import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { CancelOrderRejected, useCancelOrder, useOrder } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { OrderStatus } from '@/types/database';

/**
 * One order: what was bought, what it cost, where it is going, and how to stop
 * it. Every number here comes from the snapshot the database wrote, so it cannot
 * change under the customer's feet if the shop edits a price later.
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
  const [cancelError, setCancelError] = useState<string | null>(null);

  const data = order.data;
  const canCancel = data?.status === 'placed';
  const address = data?.delivery_address as
    | { full_name?: string; phone?: string; line1?: string; line2?: string; landmark?: string; city?: string; pincode?: string }
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

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <OfflineBanner />

      <View style={styles.headerRow}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/orders'))}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <ThemedText style={styles.header}>{data?.order_number ?? t('order.title')}</ThemedText>
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
            <View style={[styles.success, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="checkmark-circle" size={24} color={theme.accent} />
              <ThemedText type="smallBold" style={styles.flex}>
                {t('order.placedTitle')}
              </ThemedText>
            </View>
          ) : null}

          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <StatusRow status={data.status} />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Row label={t('order.placedAt')} value={formatDate(data.placed_at)} />
            {data.estimated_delivery_at ? (
              <Row label={t('order.estimatedAt')} value={formatDate(data.estimated_delivery_at)} />
            ) : null}
            <Row label={t('order.payment')} value={t(`order.pay.${data.payment_method}`)} />
            <Row label={t('order.paymentStatus')} value={t(`order.payStatus.${data.payment_status}`)} />
          </View>

          <ThemedText style={styles.sectionTitle}>{t('order.itemsTitle')}</ThemedText>
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
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
          </View>

          <ThemedText style={styles.sectionTitle}>{t('order.deliverToTitle')}</ThemedText>
          <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
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
          </View>

          {data.notes ? (
            <>
              <ThemedText style={styles.sectionTitle}>{t('checkout.noteTitle')}</ThemedText>
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <ThemedText type="small">{data.notes}</ThemedText>
              </View>
            </>
          ) : null}

          {cancelError ? (
            <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
              {t(cancelError)}
            </ThemedText>
          ) : null}

          {canCancel ? (
            <Pressable
              onPress={onCancel}
              disabled={cancelOrder.isPending}
              accessibilityRole="button"
              accessibilityState={{ busy: cancelOrder.isPending }}
              accessibilityLabel={t('order.cancel')}
              style={({ pressed }) => [
                styles.cancel,
                { borderColor: theme.danger },
                cancelOrder.isPending && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <Ionicons name="close-circle-outline" size={20} color={theme.danger} />
              <ThemedText type="smallBold" style={{ color: theme.danger }}>
                {cancelOrder.isPending ? t('common.pleaseWait') : t('order.cancel')}
              </ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => router.push('/')}
            accessibilityRole="button"
            accessibilityLabel={t('order.shopAgain')}
            style={styles.shopAgain}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {t('order.shopAgain')}
            </ThemedText>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

/** The three steps a customer actually cares about, in plain words. */
function StatusRow({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const steps: { key: OrderStatus; labelKey: string }[] = [
    { key: 'placed', labelKey: 'orders.status.placed' },
    { key: 'out_for_delivery', labelKey: 'orders.status.out_for_delivery' },
    { key: 'delivered', labelKey: 'orders.status.delivered' },
  ];

  const terminal = status === 'cancelled';
  const currentIndex = steps.findIndex((step) => step.key === status);

  if (terminal) {
    return (
      <ThemedText type="smallBold" style={{ color: theme.danger }}>
        {t(`orders.status.${status}`)}
      </ThemedText>
    );
  }

  return (
    <View style={styles.steps}>
      {steps.map((step, index) => {
        const done = index <= currentIndex;
        return (
          <View key={step.key} style={styles.step}>
            <View
              style={[
                styles.dot,
                { borderColor: done ? theme.accent : theme.border, backgroundColor: done ? theme.accent : 'transparent' },
              ]}
            />
            <ThemedText type="small" style={styles.stepLabel} themeColor={done ? 'text' : 'textSecondary'}>
              {t(step.labelKey)}
            </ThemedText>
            {index < steps.length - 1 ? (
              <View style={[styles.connector, { backgroundColor: index < currentIndex ? theme.accent : theme.border }]} />
            ) : null}
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  success: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  sectionTitle: { marginTop: Spacing.three, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, alignItems: 'flex-start' },
  flex: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  steps: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { flex: 1, alignItems: 'center', gap: Spacing.one },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  stepLabel: { textAlign: 'center', fontSize: 12, lineHeight: 16 },
  connector: { position: 'absolute', top: 6, left: '50%', width: '100%', height: 2 },
  cancel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    marginTop: Spacing.two,
  },
  shopAgain: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});