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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useCart, type CartLineView } from '@/hooks/use-cart';
import { useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cart-store';

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
            <ThemedText type="price">{formatPaise(cart.subtotalPaise)}</ThemedText>
          </View>

          {belowMinimum ? (
            <Badge
              tone="warning"
              icon="alert-circle-outline"
              label={t('cart.belowMinimum', { amount: formatPaise(minOrder - cart.subtotalPaise) })}
              style={styles.minBadge}
            />
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

/** Title + optional count, in one place so every tab screen's head matches. */
function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
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
  minBadge: { alignSelf: 'flex-start' },
  checkoutButton: { marginTop: Spacing.two },
});
