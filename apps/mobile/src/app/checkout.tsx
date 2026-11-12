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
import { OnlinePaymentFailed, useOnlinePayment } from '@/hooks/use-online-payment';
import { isOnlinePaymentMethod } from '@/lib/payments';
import { previewFee } from '@/lib/delivery';
import { useDeliveryZones, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { expressVerdict, radiusKmLabel, radiusVerdict } from '@/lib/geo';
import { makeIdempotencyKey } from '@/lib/idempotency';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isStoreOpen } from '@/lib/store-hours';
import { formatDistance } from '@/lib/tracking-rules';
import { currentLanguage } from '@/store/language-store';
import type {
  ExpressRefusalReason,
  PaymentMethod,
  PlaceOrderError as PlaceOrderErrorCode,
} from '@/types/database';

/** The methods the checkout offers, in the order a customer in Kunigal thinks of them. */
const PAYMENT_METHODS: {
  method: PaymentMethod;
  labelKey: string;
  hintKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Online money needs a way to collect it; cash never does. */
  online: boolean;
}[] = [
  {
    method: 'cod',
    labelKey: 'checkout.method.cod',
    hintKey: 'checkout.method.codHint',
    icon: 'cash-outline',
    online: false,
  },
  {
    method: 'upi',
    labelKey: 'checkout.method.upi',
    hintKey: 'checkout.method.upiHint',
    icon: 'phone-portrait-outline',
    online: true,
  },
  {
    method: 'card',
    labelKey: 'checkout.method.card',
    hintKey: 'checkout.method.cardHint',
    icon: 'card-outline',
    online: true,
  },
  {
    method: 'netbanking',
    labelKey: 'checkout.method.netbanking',
    hintKey: 'checkout.method.netbankingHint',
    icon: 'business-outline',
    online: true,
  },
  {
    method: 'wallet',
    labelKey: 'checkout.method.wallet',
    hintKey: 'checkout.method.walletHint',
    icon: 'wallet-outline',
    online: true,
  },
];

/** A refusal the customer has to read in words, with the numbers that explain it. */
type Blocked = {
  code: PlaceOrderErrorCode | 'unknown';
  distanceM?: number | null;
  radiusM?: number | null;
  reason?: ExpressRefusalReason | null;
};

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
  const onlinePayment = useOnlinePayment();
  const validateCoupon = useValidateCoupon();

  const [addressId, setAddressId] = useState<string | null>(params.addressId ?? null);
  const [note, setNote] = useState('');
  const [idempotencyKey] = useState(makeIdempotencyKey);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [now, setNow] = useState(() => new Date());
  /**
   * Where the customer is on the payment path. `placed` is the order row written
   * and paid; `paying` is the gateway sheet open, which is the moment the screen
   * says "do not close this" rather than letting a second order be placed.
   */
  type Stage = 'idle' | 'placing' | 'paying' | 'placed';
  const [stage, setStage] = useState<Stage>('idle');

  // How the customer wants to pay, and whether they want the 30-minute promise.
  // Both are only INTENT: the database re-checks that the shop can collect the
  // method and that express can be kept (rule 9.1).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [wantsExpress, setWantsExpress] = useState(false);

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

  // ---------------------------------------------------------------------------
  // The radius and the 30-minute promise.
  //
  // Computed HERE, from the pins the phone already has, so the answer appears
  // the moment an address is tapped — no round trip, no spinner on a 2G
  // connection. `lib/geo.ts` is the same haversine and the same comparisons as
  // `delivery_quote()` and `place_order()` in the database, pinned by
  // `npm run check:geo` against the same three points as the SQL test. The
  // database still makes the decision; this only lets the customer read it
  // before filling a basket.
  // ---------------------------------------------------------------------------
  const shop = store.data;
  const shopFix = { lat: shop?.lat ?? null, lng: shop?.lng ?? null };
  const radius = settings.data
    ? radiusVerdict(shopFix, selected, settings.data.delivery_radius_m)
    : { kind: 'unknown' as const, reason: 'no_shop_pin' as const };

  const express = settings.data
    ? expressVerdict(settings.data, shopFix, selected, cart.unitCount)
    : ({ kind: 'unavailable', reason: 'disabled' } as const);

  const expressAvailable = express.kind === 'available';
  const expressFeePaise = wantsExpress && expressAvailable ? express.feePaise : 0;
  // A basket that grows past the cap silently loses the promise rather than
  // charging for a 30-minute delivery the shop cannot make.
  const useExpress = wantsExpress && expressAvailable;

  // A method the shop cannot collect is not a choice. If the owner switches
  // online payments off while somebody is on this screen, the screen falls back
  // to cash instead of offering a button the database will refuse.
  const onlineAllowed = settings.data?.online_payments_enabled ?? false;
  const methodIsAllowed = paymentMethod === 'cod' || onlineAllowed;
  const effectivePayment: PaymentMethod = methodIsAllowed ? paymentMethod : 'cod';

  // A code is tied to the basket it was checked against. If the basket changes,
  // the code is stale: its minimum may no longer be met or its cap may differ.
  // Rather than show a discount the database will refuse, treat it as gone and
  // say so — derived, so no effect and no cascading render (rule 9.1).
  const couponIsStale = applied !== null && applied.subtotalPaise !== cart.subtotalPaise;
  const activeCoupon = couponIsStale ? null : applied;
  const discountPaise = activeCoupon?.discountPaise ?? 0;

  // The express fee sits INSIDE the delivery line, after the free-delivery
  // rule — `place_order()` adds it the same way, and the invoice prints the two
  // together as one delivery line. Adding it here keeps the total the customer
  // reads equal to the total the database writes, to the paisa.
  const totalPaise =
    cart.subtotalPaise + (fee.deliveryFeePaise ?? 0) - discountPaise + expressFeePaise;
  const couponNotice = couponError ?? (couponIsStale ? t('checkout.couponRemoved') : null);

  const couponMessage = (code: string, minPaise: number | null) =>
    code === 'coupon_min_order'
      ? t('checkout.couponError.coupon_min_order', { amount: formatPaise(minPaise ?? 0) })
      : t(`checkout.couponError.${code}`);

  /**
   * A measured distance as a sentence fragment: "14.5 km away" / "350 m away".
   * The unit word is translated, the number is rounded by `formatDistance` (a
   * GPS pin cannot honestly claim 5 m precision), and the caller never does
   * arithmetic on the result.
   */
  const distanceLabel = (metres: number | null): string | null => {
    const formatted = formatDistance(metres);
    if (!formatted) return null;
    return formatted.unit === 'km'
      ? t('order.distanceKilometers', { value: formatted.value })
      : t('order.distanceMeters', { value: formatted.value });
  };

  /**
   * Why express is not on offer, in words the customer can act on.
   *
   * Every branch says something true and useful: "come closer", "make the
   * basket smaller", "add a door pin", or "the shop is not doing this today".
   * There is no branch that simply says no.
   */
  const expressReasonText = (reason: ExpressRefusalReason | null | undefined): string => {
    switch (reason) {
      case 'too_far':
        return t('checkout.express.tooFar', {
          radius: radiusKmLabel(settings.data?.express_radius_m ?? 0),
        });
      case 'too_many_items':
        return t('checkout.express.tooManyItems', {
          count: settings.data?.express_max_units ?? 0,
        });
      case 'no_location':
        return t('checkout.express.noLocation');
      default:
        return t('checkout.express.disabled');
    }
  };

  /**
   * A refusal from the database, in words. The numbers come from the refusal
   * itself (`PlaceOrderRejected`), so the sentence names the real distance and
   * the real radius even if the owner changed the radius a moment ago.
   */
  const blockedMessage = (block: Blocked): string => {
    if (block.code === 'outside_delivery_radius') {
      const radiusM = block.radiusM ?? settings.data?.delivery_radius_m ?? null;
      // No radius known: say the honest, numberless version rather than
      // interpolating a zero into "within a 0 KM radius".
      return radiusM === null
        ? t('checkout.error.outside_delivery_radius')
        : t('checkout.outsideRadius', { radius: radiusKmLabel(radiusM) });
    }
    if (block.code === 'express_not_available') {
      return `${t('checkout.error.express_not_available')} ${expressReasonText(block.reason)}`;
    }
    return t(`checkout.error.${block.code}`);
  };

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

  // The door is outside the shop's radius. This is a REASON not to place the
  // order, shown before the tap, because `place_order()` would refuse it in
  // exactly the same words a second later (migration 20261112000004).
  //
  // `radius.kind === 'unknown'` deliberately says nothing: one of the two pins
  // is missing, the distance is not known, and the pincode rule above is still
  // the one that decides. Inventing a distance there would be worse than silence.
  if (radius.kind === 'outside') {
    reasons.push(t('checkout.outsideRadius', { radius: radiusKmLabel(radius.radiusM) }));
  }

  const canPlace =
    reasons.length === 0 &&
    stage === 'idle' &&
    !placeOrder.isPending &&
    !onlinePayment.isPending &&
    store.isSuccess &&
    settings.isSuccess &&
    zones.isSuccess;

  const onPlaceOrder = async () => {
    if (!canPlace || !store.data || !selected) return;

    setBlocked(null);
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
        // The method and the express promise are INTENT. Both are re-checked
        // against the same rows in the database, which is what actually charges
        // or refuses (rule 9.1).
        paymentMethod: effectivePayment,
        express: useExpress,
      });

      // Cash: the money arrives with the bag. Nothing else to do.
      if (!isOnlinePaymentMethod(result.payment_method ?? effectivePayment)) {
        router.replace({
          pathname: '/order/[id]',
          params: { id: result.order_id, placed: '1' },
        });
        return;
      }

      // Online money: the sheet opens BEFORE this screen is left, so a second
      // tap on the green button cannot place a second order.
      setStage('paying');
      try {
        await onlinePayment.mutateAsync({
          orderId: result.order_id,
          themeColor: theme.accent,
        });
        router.replace({
          pathname: '/order/[id]',
          params: { id: result.order_id, placed: '1', paid: '1' },
        });
      } catch (paymentError) {
        const code =
          paymentError instanceof OnlinePaymentFailed ? paymentError.code : 'unknown';

        // The order exists and is unpaid. Sending the customer to it is the
        // honest outcome: it offers "Pay now", and a payment the app never saw
        // is still settled by the webhook and shown as a refund if the order
        // is later cancelled. Nothing here cancels money on a guess.
        console.warn('[checkout] the payment did not complete', code);
        router.replace({
          pathname: '/order/[id]',
          params: { id: result.order_id, placed: '1', unpaid: '1' },
        });
      }
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

        // Express was asked for but the shop cannot keep it: drop the promise
        // rather than keep a tick on a 30-minute delivery that will not happen,
        // and say why. The customer can place the order again at the normal pace.
        if (error.code === 'express_not_available') {
          setWantsExpress(false);
        }

        // The refusal carries its own numbers so the sentence can name them:
        // "14.5 km away, we deliver to 10 km" rather than a flat no.
        setBlocked({
          code: error.code,
          distanceM: error.distanceM,
          radiusM: error.radiusM,
          reason: error.expressReason,
        });
        // The basket did not change, so the same key stays correct.
        return;
      }

      // Network / permission / something unexpected: log it, show nothing raw.
      console.warn('[checkout] could not place the order', error);
      setBlocked({ code: 'unknown' });
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

        {/*
          Delivery speed. Shown ABOVE the total because it changes it, and
          because "when will it arrive" is the second question a customer in
          Kunigal asks after "how much".

          Express is offered only when it can be kept: inside the express
          circle, under the basket cap, and switched on by the owner. When it is
          not, the card still says WHY in a sentence the customer can act on —
          never a greyed-out toggle with no explanation.
        */}
        <ThemedText type="heading" style={styles.sectionTitle}>
          {t('checkout.express.title')}
        </ThemedText>
        {expressAvailable ? (
          <Pressable
            onPress={() => setWantsExpress((previous) => !previous)}
            disabled={placeOrder.isPending}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: useExpress, disabled: placeOrder.isPending }}
            accessibilityLabel={t('checkout.express.available', { minutes: express.etaMinutes })}
            style={({ pressed }) => [
              styles.expressCard,
              {
                borderColor: useExpress ? theme.accent : theme.border,
                backgroundColor: useExpress ? theme.accentSoft : theme.card,
                borderWidth: useExpress ? 2 : StyleSheet.hairlineWidth,
              },
              pressed && styles.pressed,
            ]}>
            <Ionicons
              name={useExpress ? 'checkbox' : 'square-outline'}
              size={24}
              color={useExpress ? theme.accent : theme.textSecondary}
            />
            <View style={styles.flexColumn}>
              <ThemedText type="bodyStrong" style={useExpress ? { color: theme.accent } : undefined}>
                {t('checkout.express.available', { minutes: express.etaMinutes })}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {express.feePaise > 0
                  ? t('checkout.express.availableHint', {
                      amount: formatPaise(express.feePaise),
                      minutes: express.etaMinutes,
                    })
                  : t('checkout.express.availableFreeHint', { minutes: express.etaMinutes })}
              </ThemedText>
            </View>
          </Pressable>
        ) : (
          <Card style={styles.section}>
            <View style={styles.methodRow}>
              <Ionicons name="time-outline" size={22} color={theme.textSecondary} />
              <View style={styles.flexColumn}>
                <ThemedText type="smallBold">{t('checkout.express.normalTitle')}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {expressReasonText(express.kind === 'unavailable' ? express.reason : null)}
                </ThemedText>
              </View>
            </View>
          </Card>
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

          {/*
            The express fee, named separately so the customer can see what the
            30 minutes costs. The database puts it inside the delivery line on
            the order and on the invoice; here it is broken out because the
            customer is deciding whether to pay it right now.
          */}
          {useExpress ? (
            <View style={styles.summaryLine}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('checkout.express.fee', { minutes: express.etaMinutes })}
              </ThemedText>
              <ThemedText type="small">{formatPaise(expressFeePaise)}</ThemedText>
            </View>
          ) : null}

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
        <View style={styles.methodList}>
          {PAYMENT_METHODS.map((option) => {
            // Online money needs a way to collect it. A method the shop cannot
            // settle is shown, greyed, WITH the reason — hiding it would leave
            // the customer wondering whether the app is broken.
            const disabled = option.online && !onlineAllowed;
            const active = effectivePayment === option.method;

            return (
              <Pressable
                key={option.method}
                onPress={() => setPaymentMethod(option.method)}
                disabled={disabled || placeOrder.isPending}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: disabled || placeOrder.isPending }}
                accessibilityLabel={t(option.labelKey)}
                accessibilityHint={t(option.hintKey)}
                style={({ pressed }) => [
                  styles.method,
                  {
                    borderColor: active ? theme.accent : theme.border,
                    backgroundColor: active ? theme.accentSoft : theme.card,
                    borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                    opacity: disabled ? 0.55 : 1,
                  },
                  pressed && styles.pressed,
                ]}>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={active ? theme.accent : theme.textSecondary}
                />
                <Ionicons name={option.icon} size={20} color={active ? theme.accent : theme.textSecondary} />
                <View style={styles.flexColumn}>
                  <ThemedText type="smallBold">{t(option.labelKey)}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {t(option.hintKey)}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>

        {!onlineAllowed ? (
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={15} color={theme.textSecondary} />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
              {t('checkout.method.onlineOff')}
            </ThemedText>
          </View>
        ) : null}

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

        {blocked ? (
          <View style={styles.blocked}>
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
              <ThemedText type="small" style={[styles.flex, { color: theme.danger }]}>
                {blockedMessage(blocked)}
              </ThemedText>
            </View>
            {blocked.code === 'outside_delivery_radius' && blocked.distanceM != null ? (
              <ThemedText type="caption" themeColor="textSecondary">
                {t('checkout.measuredDistance', {
                  distance: distanceLabel(blocked.distanceM) ?? '',
                })}
              </ThemedText>
            ) : null}
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
            <Ionicons
              name={effectivePayment === 'cod' ? 'cash-outline' : 'shield-checkmark-outline'}
              size={15}
              color={theme.textSecondary}
            />
            <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
              {effectivePayment === 'cod'
                ? t('checkout.payOnDelivery')
                : t('checkout.payOnlineHint', {
                    method: t(`checkout.method.${effectivePayment}`),
                  })}
            </ThemedText>
          </View>
        )}

        <Button
          label={
            placeOrder.isPending || onlinePayment.isPending
              ? t('common.pleaseWait')
              : isOnlinePaymentMethod(effectivePayment)
                ? t('checkout.payAmount', { amount: formatPaise(totalPaise) })
                : t('checkout.placeOrder')
          }
          iconRight="checkmark-circle-outline"
          size="lg"
          fullWidth
          busy={placeOrder.isPending || onlinePayment.isPending}
          disabled={!canPlace}
          onPress={() => void onPlaceOrder()}
          style={styles.place}
        />

        {/* While the gateway sheet is open this screen must not be used again. */}
        {onlinePayment.isPending ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.paymentNote}>
            {t('pay.openingSheet')}
          </ThemedText>
        ) : null}
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
  expressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 64,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  methodList: { gap: Spacing.two },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 56,
    borderRadius: Radii.lg,
    padding: Spacing.three,
  },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  blocked: { gap: 2 },
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
  paymentNote: {
    marginTop: Spacing.one,
    textAlign: 'center',
  },
  place: { marginTop: Spacing.one },
  pressed: { opacity: 0.8 },
});
