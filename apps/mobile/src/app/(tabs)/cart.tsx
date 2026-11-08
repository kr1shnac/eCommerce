import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { QuantityStepper } from '@/components/quantity-stepper';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { SpeakButton } from '@/components/speak-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useCart, type CartLineView } from '@/hooks/use-cart';import { useAddresses } from '@/hooks/use-orders';
import { useDeliveryZones, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { freeDeliveryHint, previewFee } from '@/lib/delivery';
import { localizedName } from '@/lib/localized';
import { formatPaiseForSpeech, formatPaise } from '@/lib/money';
import { spokenProductLine } from '@/lib/speech';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';
import { useSavedStore } from '@/store/saved-store';

/**
 * The basket.
 *
 * Prices come from the live `products` rows, so this screen reconciles first:
 * anything sold out or pulled from the shelf is reported to the customer in
 * their language and only then changed in the basket (rule 9.5 and the
 * "never silently drop items" requirement).
 *
 * Each line keeps the product's emoji where a photo is missing, so a customer
 * who reads slowly still sees *what* is in the basket at a glance, and the one
 * green thing on the screen is the button that spends the money.
 */
export default function CartScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const cart = useCart();
  const store = useStore();
  const settings = useStoreSettings();
  const zones = useDeliveryZones();
  const session = useAuthStore((state) => state.session);
  const addresses = useAddresses({ enabled: Boolean(session) });
  const setQuantity = useCartStore((state) => state.setQuantity);
  const removeLine = useCartStore((state) => state.remove);
  const hasHydrated = useCartStore((state) => state.hasHydrated);

  // A signature of the adjustments currently in the cart, so "Keep for now"
  // hides exactly the set the customer dismissed, and a new change shows again.
  const [dismissed, setDismissed] = useState<string>('');

  const signature = useMemo(
    () => cart.adjustments.map((item) => `${item.productId}:${item.to}`).join(','),
    [cart.adjustments],
  );

  const onRefresh = () => {
    cart.refetch();
    setDismissed('');
  };

  const onApplyAdjustments = () => {
    cart.applyAdjustments();
    setDismissed('');
  };

  const renderLine = ({ item }: { item: CartLineView }) => {
    const product = item.product;
    const name = product ? localizedName(product) : t('cart.unavailableItem');
    const max = product && product.is_active ? product.stock_qty : 0;
    const emoji = product?.emoji ?? '🛒';
    const showImage = Boolean(product?.image_url);

    return (
      <View
        style={[
          styles.line,
          { borderColor: theme.border, backgroundColor: theme.card },
        ]}>
        <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
          {showImage ? (
            <Image source={{ uri: product?.image_url ?? '' }} style={styles.thumbImage} contentFit="contain" />
          ) : (
            <ThemedText style={styles.thumbEmoji}>{emoji}</ThemedText>
          )}
        </View>

        <View style={styles.lineBody}>
          <ThemedText type="bodyStrong" numberOfLines={2}>
            {name}
          </ThemedText>
          {product ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`${formatPaise(product.price_paise)} · ${product.unit}`}
            </ThemedText>
          ) : (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {t('cart.noLongerAvailable')}
            </ThemedText>
          )}

          <View style={styles.lineControls}>
            <QuantityStepper
              productName={name}
              quantity={item.quantity}
              max={max}
              onChange={(next) => setQuantity(item.productId, next)}
              compact
            />
            <ThemedText type="price" style={styles.lineTotal}>
              {formatPaise(item.lineTotalPaise)}
            </ThemedText>
          </View>

          {/*
            Two exits per line, the way Flipkart's measured cart has it
            (COMPETITOR-TEARDOWN.md §10.5, A13). A hesitant customer should not
            have to choose between keeping an item and re-searching for it, and
            this tap is what stops a basket being rebuilt from memory.
          */}
          <Pressable
            onPress={() => cart.saveForLater(item.productId)}
            accessibilityRole="button"
            accessibilityLabel={t('cart.saveForLater', { name })}
            hitSlop={8}
            style={styles.lineAction}>
            <Ionicons name="bookmark-outline" size={15} color={theme.accent} />
            <ThemedText type="caption" style={[styles.lineActionText, { color: theme.accent }]}>
              {t('cart.saveForLater')}
            </ThemedText>
          </Pressable>
        </View>

        <Pressable
          onPress={() => removeLine(item.productId)}
          accessibilityRole="button"
          accessibilityLabel={t('cart.removeItem', { name })}
          hitSlop={8}
          style={styles.removeButton}>
          <Ionicons name="trash-outline" size={18} color={theme.danger} />
        </Pressable>
      </View>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <Header title={t('cart.title')} />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  const minOrder = settings.data?.min_order_value_paise ?? 0;
  const belowMinimum = cart.subtotalPaise < minOrder;
  const showAdjustments = cart.adjustments.length > 0 && dismissed !== signature;

  /**
   * The free-delivery line under the total.
   *
   * It is worked out for the customer's DEFAULT address, because that is where
   * the shop will send the bag unless they change it at checkout — and the fee
   * depends on the pincode (`delivery_zones`), not on the basket alone. A
   * customer with no address yet gets the old neutral line: no promise can be
   * made about a place the shop has not been told about.
   *
   * Both numbers are for display only. `place_order()` works the fee out again
   * from the same rows when the order is actually placed (rule 9.1).
   */
  const defaultAddress =
    addresses.data?.find((address) => address.is_default) ?? addresses.data?.[0] ?? null;
  const fee = previewFee(
    defaultAddress?.pincode ?? null,
    zones.data,
    settings.data,
    cart.subtotalPaise,
  );
  const freeHint = freeDeliveryHint(
    cart.subtotalPaise,
    settings.data?.free_delivery_above_paise ?? null,
    fee.deliveryFeePaise,
  );

  /**
   * The basket, as one spoken Kannada sentence: each item and how many, then the
   * total. Built here rather than inline in the JSX because it is real logic, and
   * because a list comprehension inside a JSX attribute is unreadable. The item
   * names are `name_kn` from the database, so the spoken words and the printed
   * words cannot drift (Rule 2).
   */
  const basketSpeech = [
    ...cart.lines.map(
      (line) => `${line.product ? line.product.name_kn : ''} ${line.quantity}`,
    ),
    spokenProductLine(
      '',
      '',
      formatPaiseForSpeech(cart.subtotalPaise, t('speech.rupees'), t('speech.paise')),
      t('speech.basketTotal'),
    ),
  ]
    .filter((part) => part.trim().length > 0)
    .join('. ');

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <Header
        title={t('cart.title')}
        subtitle={cart.lineCount > 0 ? t('cart.itemCount', { count: cart.unitCount }) : undefined}
      />

      {!hasHydrated || cart.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={cart.lines}
          keyExtractor={(item) => item.productId}
          renderItem={renderLine}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: cart.lineCount > 0 ? insets.bottom + 200 : insets.bottom + Spacing.five },
          ]}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          ListHeaderComponent={
            showAdjustments ? (
              <Card tone="accent" style={styles.notice}>
                <View style={styles.noticeTitle}>
                  <Ionicons name="information-circle" size={18} color={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    {t('cart.adjustedTitle')}
                  </ThemedText>
                </View>
                {cart.adjustments.map((adjustment) => (
                  <ThemedText key={adjustment.productId} type="small" themeColor="textSecondary">
                    {adjustment.to > 0
                      ? t('cart.adjustedReduced', {
                          name: adjustment.name || t('cart.unavailableItem'),
                          from: adjustment.from,
                          to: adjustment.to,
                        })
                      : t('cart.adjustedRemoved', {
                          name: adjustment.name || t('cart.unavailableItem'),
                        })}
                  </ThemedText>
                ))}
                <View style={styles.noticeActions}>
                  <Button
                    label={t('cart.applyAdjustments')}
                    variant="outline"
                    size="md"
                    onPress={onApplyAdjustments}
                  />
                  <Button
                    label={t('cart.keepForNow')}
                    variant="ghost"
                    size="md"
                    onPress={() => setDismissed(signature)}
                  />
                </View>
              </Card>
            ) : null
          }
          ListEmptyComponent={
            cart.isError ? (
              <StateMessage
                title={t('cart.errorTitle')}
                hint={t('cart.errorHint')}
                tone="danger"
                onRetry={cart.refetch}
              />
            ) : (
              <View>
                <StateMessage title={t('cart.emptyTitle')} hint={t('cart.emptyHint')} art="🧺" />
                <View style={styles.emptyAction}>
                  <Button
                    label={t('cart.emptyAction')}
                    icon="storefront-outline"
                    variant="primary"
                    onPress={() => router.push('/(tabs)')}
                  />
                </View>
              </View>
            )
          }
          ListFooterComponent={<SavedForLater />}
        />
      )}

      {cart.lineCount > 0 ? (
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
          <View style={styles.totalRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('cart.subtotal')}
            </ThemedText>
            <View style={styles.totalRight}>
              <ThemedText type="price">{formatPaise(cart.subtotalPaise)}</ThemedText>
              {/* Reads the whole basket aloud: every line, then the total. This is
                  the "what am I about to pay" question, and for a customer who
                  cannot read the screen it is the only way to answer it. */}
              <SpeakButton compact text={basketSpeech} label={t('cart.subtotal')} />
            </View>
          </View>

          {/* Less than MRP, said plainly. This is the printed packet price against
              the shelf price on the units we can actually deliver — the same
              number the product cards show as a percentage. A coupon is a
              checkout thing and is not counted here. */}
          {cart.mrpSavingsPaise > 0 ? (
            <ThemedText type="caption" style={{ color: theme.successInk }}>
              {t('cart.savedOnMrp', { amount: formatPaise(cart.mrpSavingsPaise) })}
            </ThemedText>
          ) : null}

          {belowMinimum ? (
            <Badge
              tone="warning"
              icon="alert-circle-outline"
              label={t('cart.belowMinimum', { amount: formatPaise(minOrder - cart.subtotalPaise) })}
              style={styles.minBadge}
            />
          ) : freeHint.kind === 'add-more' ? (
            // The one nudge on this screen, and it is arithmetic the customer
            // could do themselves: threshold minus what is in the basket.
            <View style={styles.hintRow}>
              <Ionicons name="bicycle-outline" size={14} color={theme.accent} />
              <ThemedText type="caption" style={[styles.hintText, { color: theme.accent }]}>
                {t('cart.freeDeliveryNudge', { amount: formatPaise(freeHint.remainingPaise) })}
              </ThemedText>
            </View>
          ) : freeHint.kind === 'free' ? (
            <View style={styles.hintRow}>
              <Ionicons name="bicycle-outline" size={14} color={theme.successInk} />
              <ThemedText type="caption" style={[styles.hintText, { color: theme.successInk }]}>
                {t('cart.freeDeliveryFree')}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="caption" themeColor="textSecondary">
              {t('cart.deliveryAtCheckout')}
            </ThemedText>
          )}

          <Button
            label={t('cart.checkout')}
            iconRight="arrow-forward"
            size="lg"
            fullWidth
            disabled={belowMinimum || store.isLoading}
            onPress={() => router.push('/checkout')}
            style={styles.checkoutButton}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The saved shelf, under the bag.
 *
 * WHY IT SITS ON THIS SCREEN AND NOT A SCREEN OF ITS OWN
 * ----------------------------------------------------
 * A customer sets an aside because they hesitate **while they are looking at
 * their basket**. Putting the saved list one tap further away — a tab, a
 * drawer — turns "keep it for later" into an act of housekeeping they will
 * never do, and the items will simply be removed. So it is the last thing on
 * the screen they are already on, and it is empty and unremarkable when there
 * is nothing on it.
 *
 * It is on the DEVICE, not the server: a village with one bar of signal is
 * where this feature matters, and a shelf that needs a round trip to write to
 * is a shelf that fails exactly then. Prices come from the same live product
 * rows as the bag (`useCart`), so a saved line that has sold out is reported
 * as unavailable rather than kept as if it could still be bought.
 */
function SavedForLater() {
  const { t } = useTranslation();
  const theme = useTheme();
  const cart = useCart();
  const hydrated = useSavedStore((state) => state.hasHydrated);

  // Nothing on the shelf: don't render the section at all. A permanently empty
  // heading is noise, and this screen is read by people scanning, not reading.
  if (!hydrated || cart.saved.length === 0) return null;

  // The shelf's product rows come from the same query as the bag's. Until it
  // answers, a saved line has no product — which is not the same thing as a
  // line that has sold out, so it gets the loading state rather than the
  // warning (rule 9.2: loading, empty, and error-with-Retry, never a wrong
  // guess).
  if (cart.isLoading && cart.saved.every((line) => line.product === null)) {
    return (
      <View style={styles.savedSection}>
        <View style={styles.savedHead}>
          <Ionicons name="bookmark" size={16} color={theme.textSecondary} />
          <ThemedText type="smallBold" style={styles.flex}>
            {t('cart.savedTitle')}
          </ThemedText>
        </View>
        <LoadingState />
      </View>
    );
  }

  return (
    <View style={styles.savedSection}>
      <View style={styles.savedHead}>
        <Ionicons name="bookmark" size={16} color={theme.textSecondary} />
        <ThemedText type="smallBold" style={styles.flex}>
          {t('cart.savedTitle')}
        </ThemedText>
        {cart.saved.length > 1 ? (
          <Button
            label={t('cart.moveAllToCart')}
            variant="ghost"
            size="md"
            onPress={cart.moveAllToCart}
          />
        ) : null}
      </View>

      <ThemedText type="caption" themeColor="textSecondary">
        {t('cart.savedHint')}
      </ThemedText>

      {cart.saved.map((line) => {
        const name = line.product ? localizedName(line.product) : t('cart.unavailableItem');
        return (
          <View
            key={line.productId}
            style={[styles.savedLine, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <View style={[styles.savedThumb, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.thumbEmoji}>{line.product?.emoji ?? '🛒'}</ThemedText>
            </View>

            <View style={styles.flex}>
              <ThemedText type="bodyStrong" numberOfLines={1}>
                {name}
              </ThemedText>
              {line.product ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {`${formatPaise(line.product.price_paise)} · ${line.product.unit}`}{' '}
                  {`× ${line.quantity}`}
                </ThemedText>
              ) : (
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {t('cart.savedUnavailable')}
                </ThemedText>
              )}
            </View>

            <View style={styles.savedActions}>
              <Pressable
                onPress={() => cart.moveToCart(line.productId)}
                accessibilityRole="button"
                accessibilityLabel={t('cart.moveToCart', { name })}
                hitSlop={8}
                style={styles.savedAction}>
                <ThemedText type="caption" style={{ color: theme.accent }}>
                  {t('cart.moveToCart')}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => cart.forgetSaved(line.productId)}
                accessibilityRole="button"
                accessibilityLabel={t('cart.forgetSaved', { name })}
                hitSlop={8}
                style={styles.savedAction}>
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Title + optional count, in one place so every tab screen's head matches. */
function Header({ title, subtitle }: { title: string; subtitle?: string }) {  return (
    <View style={styles.headerRow}>
      <ThemedText type="title">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  list: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.two + 2,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '80%', height: '80%' },
  thumbEmoji: { fontSize: 30, lineHeight: 36 },
  lineBody: { flex: 1, gap: 2 },
  lineControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  lineTotal: { marginLeft: Spacing.two },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    alignSelf: 'flex-start',
    paddingRight: Spacing.two,
  },
  lineActionText: { fontWeight: '600' },
  savedSection: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  savedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  savedLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  savedThumb: {
    width: 40,
    height: 40,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  savedAction: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { gap: Spacing.one, marginBottom: Spacing.two },
  noticeTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  noticeActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  emptyAction: { alignItems: 'center', marginTop: -Spacing.three },
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
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  // The total and its Listen button travel together on the right.
  totalRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  minBadge: { alignSelf: 'flex-start' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  hintText: { flex: 1 },
  checkoutButton: { marginTop: Spacing.two },
});
