import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallShop } from '@/components/call-shop';
import { OfflineBanner } from '@/components/offline-banner';
import { OrderSkeleton } from '@/components/screen-skeletons';
import { StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { CancelOrderRejected, useCancelOrder, useOrder } from '@/hooks/use-orders';
import { useRider } from '@/hooks/use-profile';
import { useRiderPosition } from '@/hooks/use-rider-position';
import { useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { formatSnapshotAddress, readSnapshotAddress } from '@/lib/order-view';
import { orderStatusStyle } from '@/lib/order-status';
import { etaMinutesFor, hasArrived, positionAgeSeconds } from '@/lib/tracking-rules';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cart-store';
import type { OrderRiderPosition, OrderStatus } from '@/types/database';

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

  // The rider's position for this order, only while it is out for delivery.
  // Polled every 30 s — Realtime cannot reach `rider_positions` (no read
  // policy), and the age stamp keeps a poll honest (SCALE-AND-TRACKING.md §6.3).
  const position = useRiderPosition(
    data?.status === 'out_for_delivery' ? orderId : null,
  );
  // Shared with the rider and owner screens (`src/lib/order-view.ts`) — the same
  // jsonb column read the same way in all three places, so a rider and a customer
  // can never be shown two different versions of one address.
  const address = readSnapshotAddress(data ?? { delivery_address: null });

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
        <OrderSkeleton />
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
              {t(TRACK_TITLE_KEY[data.status])}
            </ThemedText>
            <StatusRow status={data.status} pickedUpAt={data.picked_up_at} />
            {data.status === 'out_for_delivery' && (
              <RiderPositionBlock position={position.data ?? null} />
            )}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <Row label={t('order.placedAt')} value={formatDate(data.placed_at)} />
            {data.estimated_delivery_at ? (
              <Row label={t('order.estimatedAt')} value={formatDate(data.estimated_delivery_at)} />
            ) : null}
            <Row label={t('order.payment')} value={t(`order.pay.${data.payment_method}`)} />
            <Row label={t('order.paymentStatus')} value={t(`order.payStatus.${data.payment_status}`)} />
          </Card>

          {/*
            A delivery that did not happen is neither delivered nor cancelled.
            It gets the honest reason the rider chose, in words, plus a way to
            ask for another attempt. This is the state the register (M3) said had
            nowhere honest to go — and it must never look like a failure the
            customer caused.
          */}
          {data.status === 'failed' || data.status === 'returned' ? (
            <Card tone="warning" style={styles.section}>
              <View style={styles.failureHead}>
                <Ionicons name="alert-circle-outline" size={20} color={theme.warningInk} />
                <ThemedText type="smallBold" style={[styles.flex, { color: theme.warningInk }]}>
                  {t('orders.failureTitle')}
                </ThemedText>
              </View>
              {data.failure_reason ? (
                <ThemedText type="small">{t(`orders.failure.${data.failure_reason}`)}</ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {data.status === 'returned'
                  ? t('orders.returnedHint')
                  : t('orders.failureHint')}
              </ThemedText>
            </Card>
          ) : null}

          <RiderCard riderId={data.assigned_to} status={data.status} />

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
              {formatSnapshotAddress(address, t('order.near'))}
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

          {/*
            The shop's own identity, on the order — which IS the e-commerce
            transaction document the FSSAI and Legal Metrology rules talk about.
            The name, the street and the licence are the parts a customer or an
            inspector actually checks. Each line appears only when the shop has
            recorded it: an invented licence number is a false statutory claim
            and worse than a missing one (register H6/H7, migration
            20261020000002).
          */}
          <ShopIdentityFooter />
        </ScrollView>
      )}
    </View>
  );
}

function ShopIdentityFooter() {
  const { t } = useTranslation();
  const store = useStore();
  const settings = useStoreSettings();
  const theme = useTheme();

  const shop = store.data;
  if (!shop) return null;

  const phone = shop.grievance_phone ?? shop.phone;

  return (
    <Card style={styles.footer}>
      <ThemedText type="small" themeColor="textSecondary">
        {shop.name}
        {shop.address_line ? `, ${shop.address_line}` : ''}
        {shop.city ? `, ${shop.city}` : ''}
      </ThemedText>
      {shop.fssai_number ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('privacy.fssaiLabel')}: {shop.fssai_number}
        </ThemedText>
      ) : null}
      {shop.gstin ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('privacy.gstinLabel')}: {shop.gstin}
        </ThemedText>
      ) : null}
      {phone ? (
        <View style={styles.footerRow}>
          <Ionicons name="call-outline" size={16} color={theme.accent} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('privacy.grievanceLabel')}: {phone}
          </ThemedText>
        </View>
      ) : null}
      {settings.data?.receipt_footer ? (
        <ThemedText type="small" themeColor="textSecondary">
          {settings.data.receipt_footer}
        </ThemedText>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t('privacy.receiptFooterDefault')}
        </ThemedText>
      )}
    </Card>
  );
}

/** The four stops a customer actually cares about, each with its own icon. */
const TRACK_STEPS: {
  statuses: OrderStatus[];
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Extra condition for a step that is a timestamp, not a status. */
  visible?: (pickedUpAt: string | null) => boolean;
}[] = [
  { statuses: ['placed', 'confirmed'], labelKey: 'order.step.placed', icon: 'receipt-outline' },
  { statuses: ['packing'], labelKey: 'order.step.packed', icon: 'bag-handle-outline' },
  {
    statuses: ['packing', 'out_for_delivery'],
    labelKey: 'order.step.pickedUp',
    icon: 'checkmark-circle-outline',
    visible: (pickedUpAt) => Boolean(pickedUpAt),
  },
  { statuses: ['out_for_delivery'], labelKey: 'order.step.onTheWay', icon: 'bicycle-outline' },
  { statuses: ['delivered'], labelKey: 'order.step.delivered', icon: 'home-outline' },
];

/**
 * The tracking card's heading (register UX-2).
 *
 * A live order is a *status*, and the ladder under this title is going to move —
 * so "Delivery status" is true. A terminal order will never move again, and a
 * failed delivery sitting under a heading that promises tracking is the kind of
 * small lie this project refuses: the heading must be the fact, not the promise.
 */
const TRACK_TITLE_KEY: Record<OrderStatus, string> = {
  placed: 'order.trackTitle',
  confirmed: 'order.trackTitle',
  packing: 'order.trackTitle',
  out_for_delivery: 'order.trackTitle',
  delivered: 'order.trackTitleDelivered',
  cancelled: 'order.trackTitleCancelled',
  failed: 'order.trackTitleFailed',
  returned: 'order.trackTitleReturned',
};

/**
 * The rider carrying this order: a face, a name, and one tap to call them.
 *
 * This is the highest-trust detail in the app (PRODUCTION.md §10) and it stays
 * hidden until the shop has actually put somebody on the order. `assigned_to`
 * is a plain uuid on the order row, so it costs nothing to read; the name and
 * photo come from `rider_directory`, which exposes exactly four columns and no
 * other profile data (migration 20261021000001).
 */
function RiderCard({ riderId, status }: { riderId: string | null; status: OrderStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rider = useRider(riderId);
  const [imageFailed, setImageFailed] = useState(false);

  // Nobody yet, or the bag is already finished. A delivered order does not need
  // a rider card, and neither does a failed one.
  if (!riderId) return null;
  if (status === 'delivered' || status === 'cancelled') return null;

  const person = rider.data;
  const showPhoto = Boolean(person?.avatar_url) && !imageFailed;

  return (
    <Card style={styles.riderCard}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {t('order.riderTitle')}
      </ThemedText>
      <View style={styles.riderRow}>
        <View style={[styles.riderPhoto, { backgroundColor: theme.accentSoft }]}>
          {showPhoto ? (
            <Image
              source={{ uri: person?.avatar_url ?? '' }}
              style={styles.riderPhotoImage}
              contentFit="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Ionicons name="person" size={22} color={theme.accent} />
          )}
        </View>
        <View style={styles.flex}>
          <ThemedText type="bodyStrong" numberOfLines={1}>
            {person?.full_name ?? t('order.riderName')}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {status === 'out_for_delivery' ? t('order.riderComing') : t('order.riderNote')}
          </ThemedText>
        </View>
      </View>
      {person?.phone ? (
        <Button
          label={t('order.callRider')}
          icon="call-outline"
          variant="outline"
          fullWidth
          onPress={() => {
            // Only opens the dialler pre-filled; nothing is dialled silently.
            Linking.openURL(`tel:${person.phone}`).catch((error) => {
              console.warn('[order] could not open dialler', error);
            });
          }}
        />
      ) : null}
    </Card>
  );
}

function StatusRow({
  status,
  pickedUpAt,
}: {
  status: OrderStatus;
  pickedUpAt: string | null;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const style = orderStatusStyle(theme, status);

  // The two honest end states where no happy step was reached. Drawn as a plain
  // statement rather than a half-filled tracker, so they cannot read as
  // "partially delivered".
  if (status === 'cancelled' || status === 'failed' || status === 'returned') {
    return (
      <View style={styles.steps}>
        <ThemedText type="smallBold" style={{ color: style.ink }}>
          {t(`orders.status.${status}`)}
        </ThemedText>
      </View>
    );
  }

  const current = TRACK_STEPS.reduce((last, step, index) => {
    const relevant = step.statuses.includes(status);
    const visible = step.visible ? step.visible(pickedUpAt) : true;
    return relevant && visible ? index : last;
  }, -1);

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

/**
 * The clock, read once as a lazy state initial value and then on a timer.
 * Kept outside the component so the render body stays pure: `Date.now()` in
 * render is what makes a screen render a different string on every pass.
 */
function clockNow() {
  return Date.now();
}

/**
 * The rider's position for an out-for-delivery order: age, distance and ETA.
 *
 * Text-first by design (SCALE-AND-TRACKING.md §6.2): a dot needs a map, a map
 * needs data and a vendor decision the owner has not made yet. Age, distance
 * and ETA fit on the smallest phone and work on 2G. Every number comes from
 * `tracking-rules.ts`, so the UI cannot disagree with the database about how
 * old a fix is or how far away the rider is.
 */
function RiderPositionBlock({ position }: { position: OrderRiderPosition | null }) {
  const { t } = useTranslation();
  const theme = useTheme();

  /*
   * "Updated 40 seconds ago" has to keep counting, so the clock is state, not a
   * `Date.now()` read during render — reading the clock while rendering is what
   * makes a screen render differently on every pass. `clockNow` is the one
   * impure read, and it happens exactly twice per mount: as the lazy initial
   * value and on each 30 s tick. It ticks on the same beat as the position
   * query, so the age can be up to 30 s stale and the sentence is still true.
   */
  const [nowMs, setNowMs] = useState(clockNow);
  useEffect(() => {
    const id = setInterval(() => setNowMs(clockNow()), 30_000);
    return () => clearInterval(id);
  }, []);

  const distance = position?.distance_m ?? null;
  const arrived = hasArrived(distance);
  const eta = distance === null ? null : etaMinutesFor(distance);

  const age = position && nowMs > 0
    ? positionAgeSeconds(new Date(position.recorded_at).getTime(), nowMs)
    : null;

  let distanceText: string | null = null;
  if (distance !== null) {
    distanceText = distance < 1000
      ? t('order.distanceMeters', { value: Math.round(distance) })
      : t('order.distanceKilometers', { value: Math.round(distance / 100) / 10 });
  }

  if (!position) {
    return (
      <View style={styles.positionEmpty}>
        <ThemedText type="smallBold">{t('order.positionNotAvailable')}</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.positionBlock}>
      <View style={styles.positionRow}>
        {age !== null ? (
          <ThemedText type="smallBold">{t('order.positionUpdated', { age })}</ThemedText>
        ) : null}
        {arrived ? (
          <ThemedText type="smallBold" style={{ color: theme.successInk }}>
            {t('order.arrived')}
          </ThemedText>
        ) : null}
      </View>
      {distanceText ? (
        <ThemedText type="small">{distanceText}</ThemedText>
      ) : null}
      {eta !== null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('order.eta', { minutes: eta })}
        </ThemedText>
      ) : null}
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
  footer: { gap: Spacing.one, marginTop: Spacing.three },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
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
  failureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  riderCard: { gap: Spacing.two, marginTop: Spacing.three },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  riderPhoto: {
    width: 48,
    height: 48,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Clip the photo inside the circle rather than overflowing it.
    overflow: 'hidden',
  },
  riderPhotoImage: { width: 48, height: 48 },
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
  positionBlock: { gap: Spacing.one + 2 },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  positionEmpty: { paddingVertical: Spacing.two },
  line: { width: 18, height: 3, borderRadius: 2, marginTop: 16 },
  action: { marginTop: Spacing.two },
});
