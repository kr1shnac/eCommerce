import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToCart } from '@/components/add-to-cart';
import { CategoryChip } from '@/components/category-chip';
import { LanguageSwitch } from '@/components/language-switch';
import { OfflineBanner } from '@/components/offline-banner';
import { ProductCard } from '@/components/product-card';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { kannadaInputFont } from '@/constants/fonts';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useCategories, useProducts } from '@/hooks/use-catalog';
import { useFavourites } from '@/hooks/use-favourites';
import { useAddresses, useActiveOffers, useOrders } from '@/hooks/use-orders';
import { useDeliveryZones, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedDescription, localizedName } from '@/lib/localized';
import { discountPercent, formatPaise } from '@/lib/money';
import { isStoreOpen } from '@/lib/store-hours';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';
import { useLanguageStore } from '@/store/language-store';
import type { Product } from '@/types/database';

/**
 * The shop window.
 *
 * The whole shelf is fetched ONCE and both the category tiles and the search box
 * filter it in memory. This shop has tens of products, not thousands, so tapping
 * a category is instant, search works off the cache on a weak connection, and
 * there is no round trip per tap. If the catalogue ever grows into the
 * thousands, this is the one place to move the filtering back into the query.
 *
 * The screen is built for a reader who may not read: the horse is Kunigal's own
 * nickname ("Horse town", KUNIGAL.md §1), categories are pictures, and the
 * green Add pill is the one thing to press.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Everything language-dependent on this screen reads this one value, so the
  // labels and the product/category names can never disagree.
  const language = useLanguageStore((state) => state.language);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  const session = useAuthStore((state) => state.session);
  const categories = useCategories();
  const products = useProducts(null);
  const settings = useStoreSettings();
  const store = useStore();
  const zones = useDeliveryZones();
  // Only ask for addresses when somebody is signed in; asking while signed out
  // is a wasted round trip that RLS answers with nothing.
  const addresses = useAddresses({ enabled: Boolean(session) });
  // Personal shelves. Both are gated on being signed in for the same reason.
  const favourites = useFavourites();
  const orders = useOrders({ enabled: Boolean(session) });
  // The codes on offer right now. Public on purpose: a visitor should see the
  // deal before deciding to sign in.
  const offers = useActiveOffers(store.data?.id ?? null);

  // Subscribe to the whole basket ONLY to tell FlatList to redraw. Each card
  // subscribes to its own product, so this does not re-render them all.
  const cartItems = useCartStore((state) => state.items);
  const cartRevision = useMemo(() => Object.values(cartItems).join(','), [cartItems]);

  // The sticky basket bar's numbers. Prices are read live from the products we
  // already fetched, never stored in the basket (rule 9.1).
  const basketCount = useMemo(
    () => Object.values(cartItems).reduce((sum, quantity) => sum + quantity, 0),
    [cartItems],
  );
  const basketPaise = useMemo(() => {
    let sum = 0;
    for (const [productId, quantity] of Object.entries(cartItems)) {
      const product = (products.data ?? []).find((candidate) => candidate.id === productId);
      if (product) sum += product.price_paise * quantity;
    }
    return sum;
  }, [cartItems, products.data]);

  const query = term.trim().toLowerCase();
  const isSearching = query.length > 0;

  const visibleProducts = useMemo(() => {
    const list = products.data ?? [];
    // A search covers the WHOLE shop, not just the open category, so a match is
    // never hidden because a chip happens to be selected.
    if (isSearching) {
      return list.filter((product) =>
        [product.name_en, product.name_kn ?? '', product.unit].some((text) =>
          text.toLowerCase().includes(query),
        ),
      );
    }
    return categoryId ? list.filter((product) => product.category_id === categoryId) : list;
  }, [products.data, categoryId, isSearching, query]);

  const emojiByCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories.data ?? []) {
      map.set(category.id, category.icon ?? '🛒');
    }
    return map;
  }, [categories.data]);

  // The customer's own shortlist, resolved against the catalogue we already
  // fetched. Only items the shop can actually supply today (in stock).
  const savedProducts = useMemo(() => {
    const ids = new Set(favourites.data ?? []);
    if (ids.size === 0) return [];
    return (products.data ?? []).filter((product) => ids.has(product.id) && product.stock_qty > 0);
  }, [favourites.data, products.data]);

  // "Buy again": the distinct products on the customer's most recent orders,
  // newest first, still on the shelf. Built from the order history rather than a
  // separate table, so it is always in step with what they actually bought.
  const buyAgainProducts = useMemo(() => {
    const byId = new Map((products.data ?? []).map((product) => [product.id, product]));
    const seen = new Set<string>();
    const result: Product[] = [];
    for (const order of orders.data ?? []) {
      for (const item of order.order_items ?? []) {
        if (!item.product_id || seen.has(item.product_id)) continue;
        seen.add(item.product_id);
        const product = byId.get(item.product_id);
        if (product && product.stock_qty > 0) result.push(product);
        if (result.length >= 10) return result;
      }
    }
    return result;
  }, [orders.data, products.data]);

  /** The best couple of true discounts, shown as the "market deals" rail. */
  const deals = useMemo(() => {
    return (products.data ?? [])
      .map((product) => ({ product, off: discountPercent(product.price_paise, product.mrp_paise) }))
      .filter((entry): entry is { product: Product; off: number } => entry.off !== null && entry.product.stock_qty > 0)
      .sort((a, b) => b.off - a.off)
      .slice(0, 8)
      .map((entry) => entry.product);
  }, [products.data]);

  const defaultAddress =
    addresses.data?.find((address) => address.is_default) ?? addresses.data?.[0] ?? null;
  const zone = defaultAddress
    ? zones.data?.find((candidate) => candidate.pincode === defaultAddress.pincode) ?? null
    : null;
  const isClosed = settings.isSuccess && !isStoreOpen(settings.data);

  const hour = new Date().getHours();
  const greetingKey =
    hour < 12 ? 'home.greetMorning' : hour < 17 ? 'home.greetAfternoon' : 'home.greetEvening';

  // Greet a customer we know by name. The name comes from the session, so it is
  // there the moment sign-in finishes and gone the moment it signs out; a
  // customer with no name on file simply gets the plain greeting.
  const firstName =
    (session?.user.user_metadata?.full_name as string | undefined)?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName
    ? t('home.greetNamed', { greeting: t(greetingKey), name: firstName })
    : t(greetingKey);

  const renderProduct = ({ item }: { item: Product }) => (
    <View style={styles.cardSlot}>
      <ProductCard
        product={item}
        fallbackEmoji={item.category_id ? emojiByCategory.get(item.category_id) : undefined}
      />
    </View>
  );

  const listHeader = (
    <View>
      {/*
        The welcome. A soft panel rather than three loose lines, so the top of
        the shelf reads as one designed thing: who we are talking to, what we
        are for, and where it is going — in that order.
      */}
      <View style={[styles.hero, { backgroundColor: theme.accentSoft, borderColor: theme.accentBorder }]}>
        <ThemedText type="title" numberOfLines={2}>
          {greeting}
        </ThemedText>
        <ThemedText type="small" style={[styles.ask, { color: theme.accent }]}>
          {t('home.ask')}
        </ThemedText>

        {/* Where it is going, and whether the shop is taking orders yet. */}
        <View style={styles.statusRow}>
          <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.accentBorder }]}>
            <Ionicons name="location" size={14} color={theme.accent} />
            <ThemedText type="caption" style={{ color: theme.text }} numberOfLines={1}>
              {defaultAddress
                ? `${zoneAreaName(zone, language) ?? defaultAddress.city} ${defaultAddress.pincode}`
                : t('home.deliveringTo')}
            </ThemedText>
          </View>
          {!isClosed && zone?.eta_minutes ? (
            <Badge label={t('home.deliveryIn', { minutes: zone.eta_minutes })} tone="success" icon="time-outline" />
          ) : null}
        </View>
      </View>

      {isClosed ? (
        <Card tone="warning" style={styles.notice}>
          <Ionicons name="moon-outline" size={20} color={theme.warning} />
          <View style={styles.flex}>
            <ThemedText type="smallBold">{t('home.closedTitle')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('home.closedHint')}
            </ThemedText>
          </View>
        </Card>
      ) : null}

      {/* Live offers, straight from the database. Shown before the shelves: a
          code is the reason to fill a basket. Hidden while searching, so it
          never comes between the customer and what they typed. */}
      {!isSearching && (offers.data?.length ?? 0) > 0 ? (
        <>
          <SectionHeader emoji="🎁" title={t('home.offersTitle')} style={styles.sectionTitle} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.offerRail}>
            {(offers.data ?? []).map((offer) => (
              <View
                key={offer.code}
                style={[
                  styles.offerCard,
                  { backgroundColor: theme.successSoft, borderColor: theme.border },
                ]}>
                <View style={styles.offerCodeRow}>
                  <Ionicons name="pricetag" size={16} color={theme.successInk} />
                  <ThemedText
                    type="smallBold"
                    style={[styles.offerCode, { color: theme.successInk }]}>
                    {offer.code}
                  </ThemedText>
                </View>
                <ThemedText type="caption" style={{ color: theme.successInk }} numberOfLines={2}>
                  {localizedDescription(offer, language)}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {t('home.offerMin', { amount: formatPaise(offer.min_order_paise) })}
                </ThemedText>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionHeader title={t('home.categoriesTitle')} style={styles.sectionTitle} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}>
        <CategoryChip
          icon="🛍️"
          label={t('home.allCategories')}
          isSelected={categoryId === null && !isSearching}
          onPress={() => {
            setCategoryId(null);
            setTerm('');
          }}
        />
        {(categories.data ?? []).map((category) => (
          <CategoryChip
            key={category.id}
            icon={category.icon}
            label={localizedName(category, language)}
            isSelected={categoryId === category.id && !isSearching}
            onPress={() => {
              setCategoryId(category.id);
              setTerm('');
            }}
          />
        ))}
      </ScrollView>

      {!isSearching && deals.length > 0 ? (
        <>
          <SectionHeader
            emoji="🔥"
            title={t('home.dealsTitle')}
            style={styles.sectionTitle}
            action={
              <Badge label={t('home.dealsBadge')} tone="secondary" icon="pricetag" />
            }
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dealsRow}>
            {deals.map((product) => (
              <DealCard
                key={product.id}
                product={product}
                emoji={product.emoji ?? (product.category_id ? emojiByCategory.get(product.category_id) : undefined)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      {!isSearching ? (
        <ProductRail
          emoji="🔁"
          title={t('home.buyAgainTitle')}
          products={buyAgainProducts}
          emojiByCategory={emojiByCategory}
        />
      ) : null}

      {!isSearching ? (
        <ProductRail
          emoji="💚"
          title={t('home.savedTitle')}
          products={savedProducts}
          emojiByCategory={emojiByCategory}
        />
      ) : null}

      <SectionHeader emoji="🧺" title={t('home.productsTitle')} style={styles.sectionTitle} />
    </View>
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.three }]}>
        <View style={styles.brandBar}>
          <BrandMark />
        </View>
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} art="🔧" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />
      {/* The app bar. The brand, the language chip and the bag stay put while the
          shelf scrolls; the search field lives up here instead of inside the
          scrolling list, so it is always one tap away at the top of the screen. */}
      <View
        style={[
          styles.appBar,
          Elevation.card,
          {
            paddingTop: insets.top + Spacing.two,
            backgroundColor: theme.card,
            borderBottomColor: theme.border,
            shadowColor: theme.shadow,
          },
        ]}>
        <View style={styles.appBarTop}>
          <BrandMark />
          <View style={styles.appBarActions}>
            <LanguageSwitch variant="toggle" />
            <Pressable
              onPress={() => router.push('/(tabs)/cart')}
              accessibilityRole="button"
              accessibilityLabel={t('tabs.cart')}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                pressed && styles.basketPressed,
              ]}>
              <Ionicons name="cart-outline" size={20} color={theme.text} />
              {basketCount > 0 ? (
                <View style={[styles.cartBadge, { backgroundColor: theme.secondary }]}>
                  <ThemedText type="caption" style={{ color: theme.onSecondary }}>
                    {basketCount > 99 ? '99+' : basketCount}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('home.searchPlaceholder')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.searchInput, kannadaInputFont(language), { color: theme.text }]}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t('home.searchPlaceholder')}
          />
          {term.length > 0 ? (
            <Pressable
              onPress={() => setTerm('')}
              accessibilityRole="button"
              accessibilityLabel={t('home.clearSearch')}
              hitSlop={10}>
              <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={visibleProducts}
        keyExtractor={(item) => item.id}
        renderItem={renderProduct}
        ListHeaderComponent={listHeader}
        numColumns={2}
        columnWrapperStyle={styles.row}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + (basketCount > 0 ? 104 : Spacing.four) },
        ]}
        ItemSeparatorComponent={() => <View style={styles.columnGap} />}
        // Re-render the cards when the language changes OR when any cart
        // quantity changes, so an "Add" button flips to a stepper immediately.
        extraData={[language, cartRevision]}
        refreshControl={
          <RefreshControl
            refreshing={products.isRefetching && !products.isLoading}
            onRefresh={() => void products.refetch()}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          products.isLoading ? (
            <LoadingState />
          ) : products.isError ? (
            // Never show products.error.message: it is a PostgREST string, and
            // the customer cannot act on it (rule 9.2).
            <StateMessage
              title={t('home.errorTitle')}
              hint={t('home.errorHint')}
              onRetry={() => void products.refetch()}
              tone="danger"
            />
          ) : isSearching ? (
            <StateMessage title={t('home.noResults')} hint={t('home.clearSearch')} art="🔍" />
          ) : (
            <StateMessage title={t('home.empty')} />
          )
        }
      />

      {/* The quick-shop signature: a bar that appears the moment the basket is
          not empty, so the way to pay is always one tap away from the shelf. */}
      {basketCount > 0 ? (
        <View style={styles.basketWrap} pointerEvents="box-none">
          <Pressable
            onPress={() => router.push('/(tabs)/cart')}
            accessibilityRole="button"
            accessibilityLabel={`${t('cart.basketSummary', {
              count: basketCount,
              amount: formatPaise(basketPaise),
            })} — ${t('cart.viewBasket')}`}
            style={({ pressed }) => [
              styles.basket,
              Elevation.floating,
              { backgroundColor: theme.accent, shadowColor: theme.shadow },
              pressed && styles.basketPressed,
            ]}>
            <View style={styles.basketLeft}>
              <View style={[styles.basketBadge, { backgroundColor: theme.onAccent }]}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  {basketCount}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                {t('cart.basketSummary', { count: basketCount, amount: formatPaise(basketPaise) })}
              </ThemedText>
            </View>
            <View style={styles.basketRight}>
              <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                {t('cart.viewBasket')}
              </ThemedText>
              <Ionicons name="arrow-forward" size={18} color={theme.onAccent} />
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The shop's wordmark for the app bar: name over promise, no icon.
 *
 * The horse roundel used to sit here. It earned its keep nowhere: at 44px on a
 * small-town phone it read as a sticker between two buttons, and a shop that
 * puts real photographs of its shelves on the screen does not need to draw
 * itself. Craft emotes the brand through BEHAVIOUR, not a mark.
 */
function BrandMark() {
  const { t } = useTranslation();
  return (
    <View style={styles.flex}>
      <ThemedText type="heading" numberOfLines={1}>
        {t('home.title')}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {t('home.subtitle')}
      </ThemedText>
    </View>
  );
}

/** A compact card on the "market deals" rail. */
function DealCard({ product, emoji }: { product: Product; emoji?: string }) {
  const theme = useTheme();
  // Read the language here rather than relying on a re-render: this card shows a
  // DB name, and it must follow the switch even on its own.
  const language = useLanguageStore((state) => state.language);
  const off = discountPercent(product.price_paise, product.mrp_paise);

  return (
    <Card flat style={[styles.deal, { backgroundColor: theme.card }]}>
      <View style={styles.dealTop}>
        <ThemedText style={styles.dealEmoji}>{emoji ?? '🛒'}</ThemedText>
        {off !== null ? <Badge label={`-${off}%`} tone="secondary" solid /> : null}
      </View>
      <ThemedText type="smallBold" numberOfLines={1}>
        {localizedName(product, language)}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {product.unit}
      </ThemedText>
      <View style={styles.dealPriceRow}>
        <ThemedText type="smallBold">{formatPaise(product.price_paise)}</ThemedText>
        {product.mrp_paise !== null ? (
          <ThemedText type="caption" themeColor="textTertiary" style={styles.mrp}>
            {formatPaise(product.mrp_paise)}
          </ThemedText>
        ) : null}
      </View>
      <AddToCart
        productId={product.id}
        productName={localizedName(product, language)}
        stock={product.stock_qty}
      />
    </Card>
  );
}

/** `delivery_zones` carries area names, not the `name_en`/`name_kn` shape. */
function zoneAreaName(
  zone: { area_name_en: string | null; area_name_kn: string | null } | null,
  language: string,
): string | null {
  if (!zone) return null;
  const value = language.startsWith('kn') ? zone.area_name_kn : zone.area_name_en;
  return value?.trim() || zone.area_name_en?.trim() || null;
}

/** A horizontal shelf of full product cards, used for "Buy again" / "Saved". */
function ProductRail({
  title,
  emoji,
  products,
  emojiByCategory,
}: {
  title: string;
  emoji?: string;
  products: Product[];
  emojiByCategory: Map<string, string>;
}) {
  if (products.length === 0) return null;

  return (
    <>
      <SectionHeader emoji={emoji} title={title} style={styles.sectionTitle} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}>
        {products.map((product) => (
          <View key={product.id} style={styles.railCard}>
            <ProductCard
              product={product}
              fallbackEmoji={
                product.category_id ? emojiByCategory.get(product.category_id) : undefined
              }
            />
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  appBar: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appBarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  appBarActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { paddingHorizontal: Spacing.three },
  hero: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ask: { marginTop: 2 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    maxWidth: '70%',
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  sectionTitle: { marginTop: Spacing.four, marginBottom: Spacing.two },
  chipsRow: { gap: Spacing.two, paddingRight: Spacing.three, paddingVertical: Spacing.one },
  dealsRow: { gap: Spacing.two, paddingRight: Spacing.three, paddingVertical: Spacing.one },
  rail: { gap: Spacing.two, paddingRight: Spacing.three, paddingVertical: Spacing.one },
  railCard: { width: 160 },
  offerRail: { gap: Spacing.two, paddingRight: Spacing.three, paddingVertical: Spacing.one },
  offerCard: {
    width: 220,
    gap: Spacing.one,
    padding: Spacing.two + 2,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  offerCodeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  offerCode: { letterSpacing: 1.5 },
  deal: {
    width: 156,
    gap: 2,
    padding: Spacing.two + 2,
  },
  dealTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  dealEmoji: { fontSize: 30, lineHeight: 36 },
  dealPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one, marginTop: 2 },
  mrp: { textDecorationLine: 'line-through' },
  row: { gap: Spacing.three },
  columnGap: { height: Spacing.three },
  cardSlot: { flex: 1 },
  basketWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  basket: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.lg,
  },
  basketLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  basketRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  basketBadge: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  basketPressed: { opacity: 0.92 },
});
