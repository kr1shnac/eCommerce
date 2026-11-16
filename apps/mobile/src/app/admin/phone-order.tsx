import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { RiderMap } from '@/components/rider-map';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useValidateCoupon, PhoneOrderRejected, usePlacePhoneOrder } from '@/hooks/use-orders';
import { useShelfProducts } from '@/hooks/use-product-shelf';
import { useDeliveryZones, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { previewFee } from '@/lib/delivery';
import { radiusKmLabel, radiusVerdict } from '@/lib/geo';
import { makePhoneIdempotencyKey } from '@/lib/idempotency';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { useLanguageStore } from '@/store/language-store';
import type { LatLng } from '@/lib/map-tiles';
import type { OrderRefusal, Product } from '@/types/database';

/**
 * A phone order, from the counter.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * Half the shop's customers ring rather than tap: an older person who does not
 * read English, somebody whose phone is out of data, a regular who simply says
 * "send the usual". Before this screen the owner had to either refuse them or
 * write the order down and key it in later, and a written-down order is one the
 * shop's books never see.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a second checkout. It sends the typed lines and the typed door to
 * `admin_place_phone_order()`, which runs the SAME `place_order_core()` as the
 * customer app (migration 20261113000006): the price, stock, delivery fee,
 * coupon and total are the database's answers. Nothing on this screen decides
 * money — the figures shown are the same rule the database applies, so the owner
 * can read the total out loud before saving.
 *
 * THE TWO HONEST THINGS ON IT
 * ---------------------------
 *   * A phone order has no door pin, so the pincode rule decides — unless the
 *     owner drops the caller's door on the map, in which case the same distance
 *     rule as the app runs. Either way, an order outside the served area is
 *     refused until the owner records WHY it was accepted. The reason is stored
 *     on the order, so next month nobody has to guess.
 *   * The typed contact is normalised once, here and in SQL: the rider calls a
 *     ten-digit Indian mobile, never `+91 98450 12345` with a space in it.
 */
export default function AdminPhoneOrderScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useLanguageStore((state) => state.language);
  const canna = kannadaInputFont(language);

  const store = useStore();
  const settings = useStoreSettings();
  const zones = useDeliveryZones();
  const products = useShelfProducts(store.data?.id ?? null);
  const placePhoneOrder = usePlacePhoneOrder();
  const validateCoupon = useValidateCoupon();

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('Kunigal');
  const [pincode, setPincode] = useState('');
  const [pin, setPin] = useState<LatLng | null>(null);
  const [note, setNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [term, setTerm] = useState('');

  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<{
    code: string;
    discountPaise: number;
    subtotalPaise: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  // One key per phone call. Reused for every retry; replaced only after the
  // order is accepted or the form is deliberately cleared (rule 9.4).
  const [idempotencyKey, setIdempotencyKey] = useState(makePhoneIdempotencyKey);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [placed, setPlaced] = useState<{
    orderId: string;
    orderNumber: string;
    totalPaise: number;
    replayed: boolean;
  } | null>(null);

  const storeId = store.data?.id ?? null;

  const sellable = useMemo(() => {
    const all = (products.data ?? []).filter((product) => product.is_active);
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (product) =>
        product.name_en.toLowerCase().includes(needle) ||
        product.name_kn.toLowerCase().includes(needle),
    );
  }, [products.data, term]);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([productId, quantity]) => {
          const product = (products.data ?? []).find((row) => row.id === productId);
          return product && quantity > 0 ? { product, quantity } : null;
        })
        .filter((line): line is { product: Product; quantity: number } => line !== null),
    [cart, products.data],
  );

  // Integer paise, summed the way the database sums them (rule 1). This is a
  // DISPLAY total; `place_order_core()` recomputes every line from `products`.
  const subtotalPaise = lines.reduce(
    (sum, line) => sum + line.product.price_paise * line.quantity,
    0,
  );

  const couponIsStale = coupon !== null && coupon.subtotalPaise !== subtotalPaise;
  const activeCoupon = couponIsStale ? null : coupon;
  const discountPaise = activeCoupon?.discountPaise ?? 0;

  // The delivery fee, as the counter will charge it: the pincode's own fee, else
  // the shop default, free above the threshold. When the pincode is not served
  // and the owner overrides it, `place_order_core()` charges the shop default —
  // so that is what is shown, rather than "unknown".
  const feePreview = previewFee(pincode, zones.data, settings.data, subtotalPaise);
  const freeAbove = settings.data?.free_delivery_above_paise ?? null;
  const feePaise = feePreview.isServed
    ? feePreview.deliveryFeePaise
    : settings.data
      ? freeAbove !== null && subtotalPaise >= freeAbove
        ? 0
        : settings.data.delivery_fee_paise
      : null;
  const totalPaise = subtotalPaise + (feePaise ?? 0) - discountPaise;

  // ---------------------------------------------------------------------------
  // Can the shop reach that door? The same three answers as the app's checkout,
  // computed from the pins already loaded. `place_order_core()` decides; this
  // only lets the owner ask for the reason BEFORE the refusal.
  // ---------------------------------------------------------------------------
  const shopFix = { lat: store.data?.lat ?? null, lng: store.data?.lng ?? null };
  const radius = settings.data
    ? radiusVerdict(shopFix, pin, settings.data.delivery_radius_m)
    : { kind: 'unknown' as const, reason: 'no_shop_pin' as const };
  const pincodeServed = (zones.data ?? []).some(
    (zone) => zone.is_active && zone.pincode === pincode.trim(),
  );
  // Inside the measured radius the pincode is only a fee lookup, so an unserved
  // pincode needs no reason there. Everywhere else it does.
  const needsReason = radius.kind === 'outside' || (radius.kind !== 'inside' && !pincodeServed);

  const phoneDigits = contactPhone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const phoneValid = /^[6-9][0-9]{9}$/.test(phoneDigits);
  const pincodeValid = /^[0-9]{6}$/.test(pincode.trim());
  const nameValid = contactName.trim().length >= 2;
  const line1Valid = line1.trim().length >= 3;
  const reasonValid = !needsReason || overrideReason.trim().length >= 3;

  const canPlace =
    storeId !== null &&
    lines.length > 0 &&
    nameValid &&
    phoneValid &&
    line1Valid &&
    pincodeValid &&
    reasonValid &&
    settings.isSuccess &&
    zones.isSuccess &&
    !placePhoneOrder.isPending;

  const setQuantity = (product: Product, quantity: number) => {
    const capped = Math.max(0, Math.min(quantity, product.stock_qty));
    setCart((current) => {
      const next = { ...current };
      if (capped === 0) delete next[product.id];
      else next[product.id] = capped;
      return next;
    });
  };

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    setCouponError(null);
    if (!code) return;

    try {
      const result = await validateCoupon.mutateAsync({
        storeId: storeId as string,
        code,
        subtotalPaise,
      });
      if (result.ok) {
        setCoupon({ code: result.code, discountPaise: result.discount_paise, subtotalPaise });
        return;
      }
      // The database's own sentence, translated. Anything unexpected falls back
      // to the generic line rather than showing a Postgres code (rule 9.2).
      setCoupon(null);
      setCouponError(
        result.error === 'coupon_min_order' && result.min_order_paise
          ? t('checkout.couponError.coupon_min_order', {
              amount: formatPaise(result.min_order_paise),
            })
          : t(`checkout.couponError.${result.error}`, {
              defaultValue: t('admin.phoneErrorGeneric'),
            }),
      );
    } catch (error) {
      console.warn('[phone-order] could not check the coupon', error);
      setCoupon(null);
      setCouponError(t('admin.phoneErrorGeneric'));
    }
  };

  const resetForm = () => {
    setContactName('');
    setContactPhone('');
    setLine1('');
    setLine2('');
    setLandmark('');
    setCity('Kunigal');
    setPincode('');
    setPin(null);
    setNote('');
    setOverrideReason('');
    setCart({});
    setTerm('');
    setCouponInput('');
    setCoupon(null);
    setCouponError(null);
    setErrorKey(null);
    setUnavailable([]);
    // A new call is a new order: a fresh key, or a retry of the next call could
    // replay this one.
    setIdempotencyKey(makePhoneIdempotencyKey());
  };

  const save = async () => {
    if (!canPlace || storeId === null) return;

    setErrorKey(null);
    setUnavailable([]);

    try {
      const result = await placePhoneOrder.mutateAsync({
        storeId,
        items: lines.map((line) => ({
          product_id: line.product.id,
          quantity: line.quantity,
        })),
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        addressLine1: line1.trim(),
        addressLine2: line2.trim() || null,
        landmark: landmark.trim() || null,
        city: city.trim() || 'Kunigal',
        pincode: pincode.trim(),
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        note: note.trim() || null,
        couponCode: activeCoupon?.code ?? null,
        // The counter takes cash. Online methods are refused by the database
        // while no gateway is connected, and a button that always refuses is a
        // lie with a border.
        paymentMethod: 'cod',
        overrideReason: overrideReason.trim() || null,
        idempotencyKey,
      });

      setPlaced({
        orderId: result.order_id,
        orderNumber: result.order_number,
        totalPaise: result.total_paise,
        replayed: result.replayed,
      });
      resetForm();
    } catch (error) {
      if (error instanceof PhoneOrderRejected) {
        setErrorKey(phoneErrorKey(error.code));
        if (error.items.length > 0) {
          setUnavailable(
            error.items.map((item) =>
              localizedName({ name_en: item.name_en ?? '', name_kn: item.name_kn ?? null }),
            ),
          );
        }
        return;
      }
      console.warn('[phone-order] could not save the order', error);
      setErrorKey('admin.phoneErrorGeneric');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <OfflineBanner />

      <View style={styles.header}>
        <IconButton icon="arrow-back" label={t('common.back')} onPress={() => router.back()} />
        <View style={styles.flex}>
          <ThemedText type="title">{t('admin.phoneTitle')}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {t('admin.phoneSubtitle')}
          </ThemedText>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
          keyboardShouldPersistTaps="handled">
          {placed ? (
            <Card tone="accent">
              <View style={styles.successHead}>
                <Ionicons name="checkmark-circle" size={22} color={theme.accent} />
                <ThemedText type="smallBold" style={[styles.flex, { color: theme.accent }]}>
                  {placed.replayed ? t('admin.phoneSavedReplay') : t('admin.phoneSaved')}
                </ThemedText>
              </View>
              <ThemedText type="code">{placed.orderNumber}</ThemedText>
              <ThemedText type="subtitle">{formatPaise(placed.totalPaise)}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.accent }}>
                {t('admin.phoneSavedHint')}
              </ThemedText>
              <Button
                label={t('admin.phoneOpenOrder')}
                icon="receipt-outline"
                variant="outline"
                fullWidth
                onPress={() => router.push(`/order/${placed.orderId}`)}
              />
            </Card>
          ) : null}

          {/* 1. Who rang. The number is the order's identity on the counter. */}
          <Card style={styles.card}>
            <SectionTitle icon="call-outline" title={t('admin.phoneContactTitle')} />
            <Field label={t('admin.phoneName')}>
              <TextInput
                value={contactName}
                onChangeText={setContactName}
                placeholder={t('admin.phoneNamePlaceholder')}
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="words"
                style={[styles.input, canna, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneName')}
              />
            </Field>
            <Field label={t('admin.phoneNumber')} hint={t('admin.phoneNumberHint')}>
              <TextInput
                value={contactPhone}
                onChangeText={setContactPhone}
                placeholder="98450 12345"
                placeholderTextColor={theme.textTertiary}
                keyboardType="phone-pad"
                maxLength={15}
                style={[styles.input, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneNumber')}
              />
            </Field>
          </Card>

          {/* 2. Where it goes. A typed door is still a door. */}
          <Card style={styles.card}>
            <SectionTitle icon="location-outline" title={t('admin.phoneAddressTitle')} />
            <Field label={t('admin.phoneLine1')}>
              <TextInput
                value={line1}
                onChangeText={setLine1}
                placeholder={t('admin.phoneLine1Placeholder')}
                placeholderTextColor={theme.textTertiary}
                style={[styles.input, canna, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneLine1')}
              />
            </Field>
            <Field label={t('admin.phoneLine2')}>
              <TextInput
                value={line2}
                onChangeText={setLine2}
                placeholder={t('admin.phoneOptional')}
                placeholderTextColor={theme.textTertiary}
                style={[styles.input, canna, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneLine2')}
              />
            </Field>
            <Field label={t('admin.phoneLandmark')} hint={t('admin.phoneLandmarkHint')}>
              <TextInput
                value={landmark}
                onChangeText={setLandmark}
                placeholder={t('admin.phoneOptional')}
                placeholderTextColor={theme.textTertiary}
                style={[styles.input, canna, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneLandmark')}
              />
            </Field>
            <View style={styles.pairRow}>
              <View style={styles.flex}>
                <Field label={t('admin.phoneCity')}>
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    style={[styles.input, canna, themedInput(theme)]}
                    accessibilityLabel={t('admin.phoneCity')}
                  />
                </Field>
              </View>
              <View style={styles.flex}>
                <Field label={t('admin.phonePincode')}>
                  <TextInput
                    value={pincode}
                    onChangeText={(text) => setPincode(text.replace(/\D/g, '').slice(0, 6))}
                    placeholder="572130"
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.input, themedInput(theme)]}
                    accessibilityLabel={t('admin.phonePincode')}
                  />
                </Field>
              </View>
            </View>

            {/*
              The door, if the caller could describe it. Optional, because most
              callers cannot — and a pin invented from a vague description would
              send a rider to the wrong house. `is_usable_fix()` decides on the
              server, so a tap on the null island is refused like any bad fix.
            */}
            <Field label={t('admin.phonePin')} hint={t('admin.phonePinHint')}>
              <RiderMap
                placeable
                pin={pin}
                onPinChange={setPin}
                initialZoom={14}
                height={200}
              />
              <View style={styles.pinRow}>
                <ThemedText type="caption" style={[styles.flex, { color: theme.textSecondary }]}>
                  {pin ? t('admin.phonePinSet') : t('admin.phonePinMissing')}
                </ThemedText>
                {pin ? (
                  <Button
                    label={t('admin.phonePinClear')}
                    variant="ghost"
                    onPress={() => setPin(null)}
                  />
                ) : null}
              </View>
            </Field>

            {/* The measured verdict, in the same words the app uses. */}
            {radius.kind === 'outside' ? (
              <View style={styles.noteRow}>
                <Ionicons name="alert-circle-outline" size={16} color={theme.warningInk} />
                <ThemedText type="small" style={[styles.flex, { color: theme.warningInk }]}>
                  {t('admin.phoneFar', {
                    distance: radiusKmLabel(radius.distanceM),
                    radius: radiusKmLabel(radius.radiusM),
                  })}
                </ThemedText>
              </View>
            ) : null}
            {radius.kind !== 'inside' && !pincodeServed && pincode.trim().length === 6 ? (
              <View style={styles.noteRow}>
                <Ionicons name="alert-circle-outline" size={16} color={theme.warningInk} />
                <ThemedText type="small" style={[styles.flex, { color: theme.warningInk }]}>
                  {t('admin.phoneUnserved')}
                </ThemedText>
              </View>
            ) : null}

            {needsReason ? (
              <Field label={t('admin.phoneReason')} hint={t('admin.phoneReasonHint')}>
                <TextInput
                  value={overrideReason}
                  onChangeText={setOverrideReason}
                  placeholder={t('admin.phoneReasonPlaceholder')}
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  style={[styles.input, styles.multiline, canna, themedInput(theme)]}
                  accessibilityLabel={t('admin.phoneReason')}
                />
              </Field>
            ) : null}
          </Card>

          {/* 3. What they want. The shelf, filtered as the owner types. */}
          <Card style={styles.card}>
            <SectionTitle icon="basket-outline" title={t('admin.phoneItemsTitle')} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder={t('admin.shelfSearch')}
              placeholderTextColor={theme.textTertiary}
              style={[styles.input, canna, themedInput(theme)]}
              accessibilityLabel={t('admin.shelfSearch')}
            />

            {products.isLoading ? (
              <LoadingState />
            ) : products.isError ? (
              <StateMessage
                title={t('admin.shelfError')}
                hint={t('admin.shelfErrorHint')}
                onRetry={products.refetch}
                tone="danger"
              />
            ) : sellable.length === 0 ? (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {term.trim() ? t('admin.shelfNoMatch') : t('admin.shelfEmpty')}
              </ThemedText>
            ) : (
              <View style={styles.productList}>
                {sellable.map((product) => (
                  <ProductLine
                    key={product.id}
                    product={product}
                    quantity={cart[product.id] ?? 0}
                    onChange={(quantity) => setQuantity(product, quantity)}
                    disabled={placePhoneOrder.isPending}
                  />
                ))}
              </View>
            )}
          </Card>

          {/* 4. The bill, as the owner will read it out. */}
          <Card style={styles.card}>
            <SectionTitle icon="receipt-outline" title={t('admin.phoneBillTitle')} />
            {lines.length === 0 ? (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {t('admin.phoneBillEmpty')}
              </ThemedText>
            ) : (
              <>
                {lines.map((line) => (
                  <View key={line.product.id} style={styles.billRow}>
                    <ThemedText type="small" style={styles.flex} numberOfLines={2}>
                      {`${line.quantity} × ${localizedName(line.product)}`}
                    </ThemedText>
                    <ThemedText type="small">
                      {formatPaise(line.product.price_paise * line.quantity)}
                    </ThemedText>
                  </View>
                ))}

                <View style={[styles.billRow, styles.billDivider, { borderTopColor: theme.border }]}>
                  <ThemedText type="small" style={[styles.flex, { color: theme.textSecondary }]}>
                    {t('admin.phoneSubtotal')}
                  </ThemedText>
                  <ThemedText type="small">{formatPaise(subtotalPaise)}</ThemedText>
                </View>
                <View style={styles.billRow}>
                  <ThemedText type="small" style={[styles.flex, { color: theme.textSecondary }]}>
                    {t('admin.phoneDelivery')}
                  </ThemedText>
                  <ThemedText type="small">
                    {feePaise === null ? '—' : feePaise === 0 ? t('admin.phoneFree') : formatPaise(feePaise)}
                  </ThemedText>
                </View>
                {activeCoupon ? (
                  <View style={styles.billRow}>
                    <ThemedText type="small" style={[styles.flex, { color: theme.textSecondary }]}>
                      {t('admin.phoneDiscount', { code: activeCoupon.code })}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      −{formatPaise(discountPaise)}
                    </ThemedText>
                  </View>
                ) : null}
                <View style={[styles.billRow, styles.billDivider, { borderTopColor: theme.border }]}>
                  <ThemedText type="smallBold" style={styles.flex}>
                    {t('admin.phoneTotal')}
                  </ThemedText>
                  <ThemedText type="subtitle">{formatPaise(totalPaise)}</ThemedText>
                </View>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {t('admin.phoneCodNote')}
                </ThemedText>
              </>
            )}
          </Card>

          {/* 5. The code, if the customer has one. */}
          <Card style={styles.card}>
            <SectionTitle icon="pricetag-outline" title={t('admin.phoneCouponTitle')} />
            <View style={styles.pairRow}>
              <TextInput
                value={couponInput}
                onChangeText={(text) => {
                  setCouponInput(text);
                  setCouponError(null);
                }}
                placeholder={t('checkout.couponPlaceholder')}
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="characters"
                style={[styles.input, styles.flex, themedInput(theme)]}
                accessibilityLabel={t('checkout.couponTitle')}
              />
              <Button
                label={t('checkout.couponApply')}
                variant="outline"
                busy={validateCoupon.isPending}
                onPress={() => void applyCoupon()}
              />
            </View>
            {activeCoupon ? (
              <View style={styles.noteRow}>
                <Ionicons name="checkmark-circle" size={16} color={theme.successInk} />
                <ThemedText type="small" style={[styles.flex, { color: theme.successInk }]}>
                  {t('admin.phoneCouponApplied', { amount: formatPaise(discountPaise) })}
                </ThemedText>
                <Button
                  label={t('checkout.couponRemove')}
                  variant="ghost"
                  onPress={() => {
                    setCoupon(null);
                    setCouponInput('');
                  }}
                />
              </View>
            ) : null}
            {couponIsStale ? (
              <ThemedText type="caption" style={{ color: theme.warningInk }}>
                {t('admin.phoneCouponStale')}
              </ThemedText>
            ) : null}
            {couponError ? (
              <ThemedText type="caption" style={{ color: theme.dangerInk }}>
                {couponError}
              </ThemedText>
            ) : null}
          </Card>

          {/* 6. A note for the rider. */}
          <Card style={styles.card}>
            <Field label={t('admin.phoneNote')}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('admin.phoneNotePlaceholder')}
                placeholderTextColor={theme.textTertiary}
                multiline
                style={[styles.input, styles.multiline, canna, themedInput(theme)]}
                accessibilityLabel={t('admin.phoneNote')}
              />
            </Field>
          </Card>

          {errorKey ? (
            <Card tone="danger">
              <View style={styles.noteRow}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.dangerInk} />
                <ThemedText type="small" style={[styles.flex, { color: theme.dangerInk }]}>
                  {t(errorKey)}
                </ThemedText>
              </View>
              {unavailable.length > 0 ? (
                <ThemedText type="small" style={{ color: theme.dangerInk }}>
                  {unavailable.join(', ')}
                </ThemedText>
              ) : null}
            </Card>
          ) : null}

          <Button
            label={placePhoneOrder.isPending ? t('common.pleaseWait') : t('admin.phoneSave')}
            icon="checkmark"
            size="lg"
            fullWidth
            busy={placePhoneOrder.isPending}
            disabled={!canPlace}
            onPress={() => void save()}
          />
          <Button
            label={t('admin.phoneClear')}
            variant="ghost"
            fullWidth
            disabled={placePhoneOrder.isPending}
            onPress={resetForm}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * One shelf row with a counter stepper. `+` stops at the stock the database
 * knows about, so the refusal is not the first thing the owner meets — the
 * database still checks again at write time.
 */
function ProductLine({
  product,
  quantity,
  onChange,
  disabled,
}: {
  product: Product;
  quantity: number;
  onChange: (quantity: number) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const outOfStock = product.stock_qty < 1;

  return (
    <View style={[styles.productRow, { borderTopColor: theme.border }]}>
      <View style={styles.flex}>
        <ThemedText type="small" numberOfLines={2}>
          {localizedName(product)}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {product.unit} · {formatPaise(product.price_paise)} ·{' '}
          {outOfStock ? t('admin.phoneOutOfStock') : t('admin.phoneInStock', { count: product.stock_qty })}
        </ThemedText>
      </View>

      <View style={styles.stepper}>
        <Pressable
          onPress={() => onChange(quantity - 1)}
          disabled={disabled || quantity === 0}
          accessibilityRole="button"
          accessibilityLabel={t('admin.phoneLess', { name: localizedName(product) })}
          accessibilityState={{ disabled: disabled || quantity === 0 }}
          style={({ pressed }) => [
            styles.step,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            (disabled || quantity === 0) && styles.blocked,
            pressed && styles.pressed,
          ]}>
          <Ionicons name="remove" size={18} color={theme.text} />
        </Pressable>

        <ThemedText type="smallBold" style={styles.quantity}>
          {quantity}
        </ThemedText>

        <Pressable
          onPress={() => onChange(quantity + 1)}
          disabled={disabled || outOfStock || quantity >= product.stock_qty}
          accessibilityRole="button"
          accessibilityLabel={t('admin.phoneMore', { name: localizedName(product) })}
          accessibilityState={{
            disabled: disabled || outOfStock || quantity >= product.stock_qty,
          }}
          style={({ pressed }) => [
            styles.step,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            (disabled || outOfStock || quantity >= product.stock_qty) && styles.blocked,
            pressed && styles.pressed,
          ]}>
          <Ionicons name="add" size={18} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={18} color={theme.accent} />
      <ThemedText type="smallBold" style={styles.flex}>
        {title}
      </ThemedText>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

function themedInput(theme: ReturnType<typeof useTheme>) {
  return {
    color: theme.text,
    borderColor: theme.border,
    backgroundColor: theme.backgroundElement,
  };
}

/**
 * The counter's refusal in the owner's words. Anything not listed — a coupon
 * that was spent a second earlier, a store closed mid-call — still lands on a
 * sentence rather than a Postgres code (rule 9.2).
 */
function phoneErrorKey(code: OrderRefusal): string {
  switch (code) {
    case 'contact_name_required':
      return 'admin.phoneErrorName';
    case 'contact_phone_invalid':
      return 'admin.phoneErrorPhone';
    case 'address_line1_required':
      return 'admin.phoneErrorLine1';
    case 'address_pincode_invalid':
      return 'admin.phoneErrorPincode';
    case 'override_reason_required':
      return 'admin.phoneErrorReason';
    case 'zone_not_served':
      return 'admin.phoneErrorZone';
    case 'outside_delivery_radius':
      return 'admin.phoneErrorFar';
    case 'below_minimum':
      return 'admin.phoneErrorMinimum';
    case 'items_unavailable':
      return 'admin.phoneErrorItems';
    case 'store_closed':
      return 'admin.phoneErrorClosed';
    case 'empty_cart':
      return 'admin.phoneErrorEmpty';
    default:
      return 'admin.phoneErrorGeneric';
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  card: { gap: Spacing.two },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: { gap: Spacing.one },
  pairRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 15,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  successHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  productList: { gap: 0 },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  step: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantity: { minWidth: 24, textAlign: 'center' },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  billDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  blocked: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
