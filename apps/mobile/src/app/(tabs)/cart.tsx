// eslint-disable react-hooks/set-state-in-effect
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { QuantityStepper } from '@/components/quantity-stepper';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCart, type CartLineView } from '@/hooks/use-cart';
import { useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cart-store';
import type { Product } from '@/types/database';

/**
 * The basket.
 *
 * Prices come from the live `products` rows, so this screen reconciles first:
 * anything sold out or pulled from the shelf is reported to the customer in
 * their language and only then changed in the basket (rule 9.5 and the
 * "never silently drop items" requirement).
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

  // Told about here, shown on the screen the customer came from.
  const [adjustments, setAdjustments] = useState<ReturnType<typeof useCart>['adjustments']>([]);
  const [dismissed, setDismissed] = useState<string>('');

  const signature = useMemo(
    () => cart.adjustments.map((item) => `${item.productId}:${item.to}`).join(','),
    [cart.adjustments],
  );

  useEffect(() => {
    if (signature.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdjustments(cart.adjustments);
    } else {
       
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdjustments([]);
    }
  }, [signature, cart.adjustments]);

  const onRefresh = () => {
    cart.refetch();
    setDismissed('');
  };

  const onApplyAdjustments = () => {
    cart.applyAdjustments();
    setAdjustments([]);
    setDismissed('');
  };

  const renderLine = ({ item }: { item: CartLineView }) => {
    const product = item.product;
    const name = product ? localizedName(product) : t('cart.unavailableItem');
    const max = product && product.is_active ? product.stock_qty : 0;

    return (
      <View style={[styles.line, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={() => router.push('/(tabs)')}>
          <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
            {product?.image_url ? (
              <Image source={{ uri: product.image_url }} style={styles.thumbImage} resizeMode="contain" />
            ) : (
              <ThemedText style={styles.thumbEmoji}>🛒</ThemedText>
            )}
          </View>
        </Pressable>

        <View style={styles.lineBody}>
          <ThemedText numberOfLines={2} style={styles.lineName}>
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
            <ThemedText type="smallBold" style={styles.lineTotal}>
              {formatPaise(item.lineTotalPaise)}
            </ThemedText>
          </View>

          <Pressable
            onPress={() => removeLine(item.productId)}
            accessibilityRole="button"
            accessibilityLabel={t('cart.removeItem', { name })}
            hitSlop={8}
            style={styles.removeButton}>
            <Ionicons name="trash-outline" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger }}>
              {t('cart.remove')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <ThemedText style={styles.header}>{t('cart.title')}</ThemedText>
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  const minOrder = settings.data?.min_order_value_paise ?? 0;
  const belowMinimum = cart.subtotalPaise < minOrder;
  const showAdjustments = adjustments.length > 0 && dismissed !== signature;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <OfflineBanner />

      <View style={styles.headerRow}>
        <ThemedText style={styles.header}>{t('cart.title')}</ThemedText>
        {cart.lineCount > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('cart.itemCount', { count: cart.unitCount })}
          </ThemedText>
        ) : null}
      </View>

      {!hasHydrated || cart.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={cart.lines}
          keyExtractor={(item) => item.productId}
          renderItem={renderLine}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 140 }]}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={theme.accent} />
          }
          ListHeaderComponent={
            showAdjustments ? (
              <View style={[styles.notice, { backgroundColor: theme.accentSoft }]}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {t('cart.adjustedTitle')}
                </ThemedText>
                {adjustments.map((adjustment) => (
                  <ThemedText key={adjustment.productId} type="small" style={styles.noticeLine}>
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
                  <Pressable
                    onPress={onApplyAdjustments}
                    accessibilityRole="button"
                    accessibilityLabel={t('cart.applyAdjustments')}
                    style={styles.noticeButton}>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      {t('cart.applyAdjustments')}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setDismissed(signature)}
                    accessibilityRole="button"
                    accessibilityLabel={t('cart.keepForNow')}
                    style={styles.noticeButton}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('cart.keepForNow')}
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
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
              <StateMessage title={t('cart.emptyTitle')} hint={t('cart.emptyHint')} />
            )
          }
        />
      )}

      {cart.lineCount > 0 ? (
        <View style={[styles.footer, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={styles.totalRow}>
            <ThemedText type="smallBold">{t('cart.subtotal')}</ThemedText>
            <ThemedText type="smallBold">{formatPaise(cart.subtotalPaise)}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t('cart.deliveryAtCheckout')}
          </ThemedText>

          {belowMinimum ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {t('cart.belowMinimum', { amount: formatPaise(minOrder - cart.subtotalPaise) })}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={() => router.push('/checkout')}
            disabled={belowMinimum || store.isLoading}
            accessibilityRole="button"
            accessibilityState={{ disabled: belowMinimum }}
            accessibilityLabel={t('cart.checkout')}
            style={({ pressed }) => [
              styles.checkout,
              { backgroundColor: theme.accent },
              (belowMinimum || store.isLoading) && styles.checkoutDisabled,
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" style={styles.checkoutLabel}>
              {t('cart.checkout')}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  header: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  line: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '80%', height: '80%' },
  thumbEmoji: { fontSize: 26 },
  lineBody: { flex: 1, gap: 2 },
  lineName: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  lineControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  lineTotal: { marginLeft: Spacing.two },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.one,
    minHeight: 28,
  },
  notice: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  noticeLine: { color: '#1B1B1F' },
  noticeActions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  noticeButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.one,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  checkout: {
    marginTop: Spacing.two,
    minHeight: 52,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutDisabled: { opacity: 0.5 },
  checkoutLabel: { color: '#ffffff' },
  pressed: { opacity: 0.8 },
});