// eslint-disable react-hooks/set-state-in-effect
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { kannadaInputFont } from '@/constants/fonts';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useCart } from '@/hooks/use-cart';
import {
  PlaceOrderRejected,
  useAddresses,
  usePlaceOrder,
  useValidateCoupon,
} from '@/hooks/use-orders';
import { previewFee, useDeliveryZones, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { makeIdempotencyKey } from '@/lib/idempotency';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isStoreOpen } from '@/lib/store-hours';
import { currentLanguage } from '@/store/language-store';
import type { PlaceOrderError as PlaceOrderErrorCode } from '@/types/database';

/**
 * Review the basket, pick an address, place the order. Cash on delivery only.
 *
 * Three things matter here:
 *  1. The money shown is a PREVIEW. Postgres decides the real total, and the
 *     confirmation screen shows what it decided (rule 9.1).
 *  2. One idempotency key per checkout attempt, made before the first tap and
 *     reused by every retry, so a flaky connection cannot place two orders
 *     (rule 9.4).
 *  3. If the shop says something is no longer available, the basket is changed,
 *     the customer is told, and they go back to the basket to confirm again.
 *     Nothing is ever dropped quietly.
 *
 * The one green button on the screen is the one that spends money; every reason
 * the order cannot be placed is shown above it, in words, so the customer is
 * never left guessing why the button is grey.
 */
export default function CheckoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ addressId?: string }>();

  const cart = useCart();
  const store = useStore();
  const settings = useStoreSettings();
  const zones = useDeliveryZones();
  const addresses = useAddresses();
  const placeOrder = usePlaceOrder();
  const validateCoupon = useValidateCoupon();

  const [addressId, setAddressId] = useState<string | null>(params.addressId ?? null);
  const [note, setNote] = useState('');
  const [idempotencyKey] = useState(makeIdempotencyKey);
  const [blockedCode, setBlockedCode] = useState<PlaceOrderErrorCode | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Coupon state. `applied` holds only what the DATABASE said the code is worth,
  // and the basket size it was checked against. Nothing is recomputed here.
  const [couponInput, setCouponInput] = useState('');
  const [applied, setApplied] = useState<{
    code: string;
    discountPaise: number;
    subtotalPaise: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const list = useMemo(() => addresses.data ?? [], [addresses.data]);

  // Pick something sensible as soon as we know what exists.
  useEffect(() => {
    if (list.length === 0 || addressId) return;
    const preferred = list.find((address) => address.is_default) ?? list[0];

    setAddressId((prev: string | null) => prev ?? preferred.id); // eslint-disable-line react-hooks/set-state-in-effect
  }, [list, addressId]);

  // "Open now" must not go stale while somebody stares at the screen.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => list.find((address) => address.id === addressId) ?? null,
    [list, addressId],
  );

  const zone = useMemo(() => {
    if (!selected || !zones.data) return null;
    return zones.data.find((candidate) => candidate.pincode === selected.pincode.trim()) ?? null;
  }, [selected, zones.data]);

  const fee = useMemo(
    () => previewFee(selected?.pincode ?? null, zones.data, settings.data, cart.subtotalPaise),
    [selected, zones.data, settings.data, cart.subtotalPaise],
  );

  const isOpen = isStoreOpen(settings.data, now);
  const minOrderPaise = settings.data?.min_order_value_paise ?? 0;
  const freeOverPaise = settings.data?.free_delivery_above_paise ?? null;

  // A code is tied to the basket it was checked against. If the basket changes,
  // the code is stale: its minimum may no longer be met or its cap may differ.
  // Rather than show a discount the database will refuse, treat it as gone and
  // say so — derived, so no effect and no cascading render (rule 9.1).
  const couponIsStale = applied !== null && applied.subtotalPaise !== cart.subtotalPaise;
  const activeCoupon = couponIsStale ? null : applied;
  const discountPaise = activeCoupon?.discountPaise ?? 0;
  const totalPaise = cart.subtotalPaise + (fee.deliveryFeePaise ?? 0) - discountPaise;
  const couponNotice = couponError ?? (couponIsStale ? t('checkout.couponRemoved') : null);

  const couponMessage = (code: string, minPaise: number | null) =>
    code === 'coupon_min_order'
      ? t('checkout.couponError.coupon_min_order', { amount: formatPaise(minPaise ?? 0) })
      : t(`checkout.couponError.${code}`);

  const onApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code || !store.data || validateCoupon.isPending) return;

    setCouponError(null);
    try {
      const result = await validateCoupon.mutateAsync({
        storeId: store.data.id,
        code,
        subtotalPaise: cart.subtotalPaise,
      });

      if (!result.ok) {
        setApplied(null);
        setCouponError(couponMessage(result.error, result.min_order_paise ?? null));
        return;
      }

      setApplied({
        code: result.code,
        discountPaise: result.discount_paise,
        subtotalPaise: cart.subtotalPaise,
      });
      setCouponInput('');
    } catch (error) {
      // A failed check is an ordinary state, never a crash and never raw text.
      console.warn('[checkout] could not check the coupon', error);
      setApplied(null);
      setCouponError(t('checkout.couponError.generic'));
    }
  };

  const onRemoveCoupon = () => {
    setApplied(null);
    setCouponError(null);
    setCouponInput('');
  };

  const reasons: string[] = [];
  if (cart.lineCount === 0) reasons.push(t('checkout.emptyCart'));
  if (selected === null) reasons.push(t('checkout.pickAddress'));
  else if (zone === null) reasons.push(t('checkout.zoneNotServed'));
  if (!isOpen) reasons.push(t('checkout.storeClosed'));
  if (minOrderPaise > 0 && cart.subtotalPaise < minOrderPaise) {
    reasons.push(t('checkout.belowMinimum', { amount: formatPaise(minOrderPaise - cart.subtotalPaise) }));
  }
  if (cart.adjustments.length > 0) reasons.push(t('checkout.cartChanged'));

  const canPlace =
    reasons.length === 0 && !placeOrder.isPending && store.isSuccess && settings.isSuccess && zones.isSuccess;

  const onPlaceOrder = async () => {
    if (!canPlace || !store.data || !selected) return;

    setBlockedCode(null);
    try {
      const result = await placeOrder.mutateAsync({
        storeId: store.data.id,
        addressId: selected.id,
        note: note.trim() || null,
        // The SAME key for every retry of this basket.
        idempotencyKey,
        // Only the CODE. The database recomputes the discount and refuses the
        // order if the code is no longer valid (rule 9.1).
        couponCode: activeCoupon?.code ?? null,
      });

      router.replace({ pathname: '/order/[id]', params: { id: result.order_id, placed: '1' } });
    } catch (error) {
      if (error instanceof PlaceOrderRejected) {
        // Stock moved under us. Fix the basket, and make the customer look at
        // it again before spending money.
        if (error.code === 'items_unavailable') {
          cart.applyUnavailable(error.items);
          router.replace('/(tabs)/cart');
          return;
        }

        // A coupon the shop refused: drop it and explain, rather than leave a
        // discount on screen the database will not honour.
        if (error.code.startsWith('coupon_')) {
          setApplied(null);
          setCouponError(couponMessage(error.code, error.couponMinOrderPaise));
          return;
        }

        setBlockedCode(error.code);
        // The basket did not change, so the same key stays correct.
        return;
      }

      // Network / permission / something unexpected: log it, show nothing raw.
      console.warn('[checkout] could not place the order', error);
      setBlockedCode('unknown' as any);
    }
  };

  const banner = (
    <View style={styles.backRow}>
      <IconButton icon="arrow-back" label={t('common.back')} onPress={() => router.back()} />
      <ThemedText type="subtitle" style={styles.flex}>
        {t('checkout.title')}
      </ThemedText>
    </View>
  );

  if (!store.isSuccess) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        {banner}
        {store.isLoading ? (
          <LoadingState />
        ) : (
          <StateMessage
            title={t('checkout.unavailableTitle')}
            hint={t('checkout.unavailableHint')}
            onRetry={store.refetch}
            tone="danger"
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />
      <View style={{ paddingTop: insets.top }}>{banner}</View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 160 }]}
        keyboardShouldPersistTaps="handled">
        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.deliverTo')}
        </ThemedText>

        {addresses.isLoading ? (
          <LoadingState />
        ) : addresses.isError ? (
          <StateMessage title={t('address.listError')} onRetry={addresses.refetch} tone="danger" />
        ) : list.length === 0 ? (
          <StateMessage title={t('address.emptyTitle')} hint={t('address.emptyHint')} art="📍" />
        ) : (
          <View style={styles.addressList}>
            {list.map((address) => {
              const active = address.id === addressId;
              const lines = addressLines(address, t('order.near'));

              return (
                <Pressable
                  key={address.id}
                  onPress={() => setAddressId(address.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={lines.join(', ')}
                  style={({ pressed }) => [
                    styles.address,
                    {
                      borderColor: active ? theme.accent : theme.border,
                      backgroundColor: active ? theme.accentSoft : theme.card,
                      borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={active ? theme.accent : theme.textSecondary}
                  />
                  <View style={styles.flexColumn}>
                    <View style={styles.addressTop}>
                      <ThemedText type="smallBold">{address.label ?? t('address.labelFallback')}</ThemedText>
                      {address.is_default ? (
                        <Badge label={t('address.defaultBadge')} tone="accent" icon="star" />
                      ) : null}
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {lines.join(', ')}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => router.push({ pathname: '/address', params: { pick: '1' } })}
              accessibilityRole="button"
              accessibilityLabel={t('address.addNew')}
              style={({ pressed }) => [styles.addAddress, pressed && styles.pressed]}>
              <Ionicons name="add-circle-outline" size={22} color={theme.accent} />
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                {t('address.addNew')}
              </ThemedText>
            </Pressable>
          </View>
        )}

        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.itemsTitle', { count: cart.unitCount })}
        </ThemedText>
        <Card style={styles.section}>
          {cart.lines.map((line) => (
            <View key={line.productId} style={styles.summaryLine}>
              <ThemedText type="small" numberOfLines={2} style={styles.flex}>
                {`${line.quantity} × ${line.product ? localizedName(line.product) : t('cart.unavailableItem')}`}
              </ThemedText>
              <ThemedText type="small">{formatPaise(line.lineTotalPaise)}</ThemedText>
            </View>
          ))}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.summaryLine}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('checkout.subtotal')}
            </ThemedText>
            <ThemedText type="small">{formatPaise(cart.subtotalPaise)}</ThemedText>
          </View>

          <View style={styles.summaryLine}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('checkout.deliveryFee')}
            </ThemedText>
            <ThemedText type="small">
              {fee.deliveryFeePaise === null ? t('checkout.notAvailable') : formatPaise(fee.deliveryFeePaise)}
            </ThemedText>
          </View>

          {activeCoupon ? (
            <View style={styles.summaryLine}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('checkout.couponDiscount', { code: activeCoupon.code })}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.successInk }}>
                {`− ${formatPaise(activeCoupon.discountPaise)}`}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.totalLine}>
            <ThemedText type="bodyStrong">{t('checkout.total')}</ThemedText>
            <ThemedText type="price">{formatPaise(totalPaise)}</ThemedText>
          </View>

          {freeOverPaise !== null && cart.subtotalPaise < freeOverPaise ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {t('checkout.freeDeliveryHint', { amount: formatPaise(freeOverPaise) })}
            </ThemedText>
          ) : null}
        </Card>

        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.couponTitle')}
        </ThemedText>
        <Card style={styles.section}>
          {activeCoupon ? (
            <View style={styles.couponApplied}>
              <Ionicons name="pricetag" size={20} color={theme.successInk} />
              <View style={styles.flexColumn}>
                <ThemedText type="smallBold" style={{ color: theme.successInk }}>
                  {activeCoupon.code}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {t('checkout.couponSaved', { amount: formatPaise(activeCoupon.discountPaise) })}
                </ThemedText>
              </View>
              <IconButton icon="close" label={t('checkout.couponRemove')} onPress={onRemoveCoupon} />
            </View>
          ) : (
            <View style={styles.couponRow}>
              <TextInput
                value={couponInput}
                onChangeText={(text) => setCouponInput(text.toUpperCase().slice(0, 20))}
                placeholder={t('checkout.couponPlaceholder')}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!validateCoupon.isPending && !placeOrder.isPending}
                accessibilityLabel={t('checkout.couponTitle')}
                style={[
                  styles.couponInput,
                  kannadaInputFont(currentLanguage()),
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              />
              <Button
                label={t('checkout.couponApply')}
                busy={validateCoupon.isPending}
                disabled={couponInput.trim().length === 0 || !store.isSuccess}
                onPress={() => void onApplyCoupon()}
              />
            </View>
          )}

          {couponNotice ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
              <ThemedText type="caption" style={[styles.flex, { color: theme.danger }]}>
                {couponNotice}
              </ThemedText>
            </View>
          ) : null}
        </Card>

        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.paymentTitle')}
        </ThemedText>
        <Card tone="accent" style={styles.cod}>
          <Ionicons name="cash-outline" size={24} color={theme.accent} />
          <View style={styles.flexColumn}>
            <ThemedText type="bodyStrong">{t('checkout.cod')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('checkout.codHint')}
            </ThemedText>
          </View>
        </Card>

        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.noteTitle')}
        </ThemedText>
        <TextInput
          value={note}
          onChangeText={(text) => setNote(text.slice(0, 120))}
          placeholder={t('checkout.notePlaceholder')}
          placeholderTextColor={theme.textSecondary}
          multiline
          editable={!placeOrder.isPending}
          accessibilityLabel={t('checkout.noteTitle')}
          style={[
            styles.note,
            kannadaInputFont(currentLanguage()),
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.card },
          ]}
        />

        {blockedCode ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
            <ThemedText type="small" style={[styles.flex, { color: theme.danger }]}>
              {t(`checkout.error.${blockedCode}`)}
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          Elevation.floating,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            shadowColor: theme.shadow,
            paddingBottom: insets.bottom + Spacing.three,
          },
        ]}>
        {reasons.length > 0 ? (
          <View style={styles.reasons}>
            {reasons.map((reason) => (
              <View key={reason} style={styles.reasonRow}>
                <Ionicons name="alert-circle" size={15} color={theme.warningInk} />
                <ThemedText type="caption" style={[styles.flex, { color: theme.warningInk }]}>
                  {reason}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.reasonRow}>
            <Ionicons name="cash-outline" size={15} color={theme.textSecondary} />
            <ThemedText type="caption" themeColor="textSecondary">
              {t('checkout.payOnDelivery')}
            </ThemedText>
          </View>
        )}

        <Button
          label={placeOrder.isPending ? t('common.pleaseWait') : t('checkout.placeOrder')}
          iconRight="checkmark-circle-outline"
          size="lg"
          fullWidth
          busy={placeOrder.isPending}
          disabled={!canPlace}
          onPress={() => void onPlaceOrder()}
          style={styles.place}
        />
      </View>
    </View>
  );
}

function addressLines(
  address: {
    full_name: string;
    line1: string;
    line2: string | null;
    landmark: string | null;
    city: string;
    pincode: string;
  },
  nearWord: string,
): string[] {
  return [
    address.line1,
    address.line2,
    address.landmark ? `${nearWord} ${address.landmark}` : null,
    `${address.city} ${address.pincode}`,
  ].filter((part): part is string => Boolean(part));
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  flexColumn: { flex: 1, gap: 2 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.three },
  section: { gap: Spacing.one },
  addressList: { gap: Spacing.two },
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 56,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  addressTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  addAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  totalLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  cod: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  couponApplied: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  couponRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  couponInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
    letterSpacing: 1,
  },
  note: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    padding: Spacing.three,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  reasons: { gap: Spacing.one, marginBottom: Spacing.two },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  place: { marginTop: Spacing.one },
  pressed: { opacity: 0.8 },
});
