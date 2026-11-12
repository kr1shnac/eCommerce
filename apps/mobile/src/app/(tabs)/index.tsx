import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToCart } from '@/components/add-to-cart';
import { CallShop } from '@/components/call-shop';
import { CategoryChip } from '@/components/category-chip';
import { HomeSearch } from '@/components/home-search';
import { LanguageSwitch } from '@/components/language-switch';
import { OfflineBanner } from '@/components/offline-banner';
import { ProductCard } from '@/components/product-card';
import { CategoryChipsSkeleton, HomeShelfSkeleton } from '@/components/screen-skeletons';
import { StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
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
import type { ActiveOffer, Product } from '@/types/database';

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

  // The bar's "you saved" number. Same rule as the cart screen: MRP minus shelf
  // price, on the units in the basket, integer paise, never negative. It is
  // deliberately not the coupon discount — that is only known at checkout.
  const basketSavingsPaise = useMemo(() => {
    let sum = 0;
    for (const [productId, quantity] of Object.entries(cartItems)) {
      const product = (products.data ?? []).find((candidate) => candidate.id === productId);
      const mrp = product?.mrp_paise ?? null;
      if (product && mrp !== null && mrp > product.price_paise) {
        sum += (mrp - product.price_paise) * quantity;
      }
    }
    return sum;
  }, [cartItems, products.data]);

  /**
 * The scope sentence for an offer card, or null when the code has no cap worth
 * naming. One line, in the customer's language, stating the shape of the limit
 * so the refusal at checkout is never a surprise (A15, COMPETITOR-TEARDOWN §11.5).
 *
 * The per-person cap wins when both exist: it is the one a single customer will
 * hit first, and it is the one that feels arbitrary when it arrives unannounced.
 */
function offerScope(
  offer: ActiveOffer,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string | null {
  const per = offer.per_customer_limit;
  if (per !== null && per > 0) return t('home.offerPerCustomer', { count: per });
  const total = offer.usage_limit;
  if (total !== null && total > 0) return t('home.offerFirst', { count: total });
  return null;
}

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

  // The words the search placeholder rotates through (register B4). Real names
  // from the shelf this customer is looking at, in their own language, short
  // enough to fit one line on a small phone, and de-duplicated. In-stock only:
  // an example that finds nothing is worse than no example at all.
  const searchWords = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];

    for (const product of products.data ?? []) {
      if (product.stock_qty <= 0) continue;
      const name = localizedName(product, language).trim();
      if (name.length === 0 || name.length > 18 || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }

    // Shortest first: the first example is the one most likely to be seen, and a
    // placeholder is a single line that must not be clipped.
    return names.sort((a, b) => a.length - b.length).slice(0, 6);
  }, [products.data, language]);

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

  const renderProduct = ({ item, index }: { item: Product; index: number }) => (
    <View style={styles.cardSlot}>
      <ProductCard
        product={item}
        fallbackEmoji={item.category_id ? emojiByCategory.get(item.category_id) : undefined}
        // Two columns, so the first four cards are the first two rows — the
        // only ones visible before a thumb moves. A8.
        priority={index < 4}
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
      {/*
        The promise, not the greeting. The one fact a customer opens this app for
        is "will it come, and when" — so that is the largest line on the screen,
        and the greeting is a caption above it (register UX-1). When the shop is
        shut the same line says so instead of promising a delivery, which is why
        the separate "closed" card below is gone: two blocks saying the shop is
        closed is one block too many, and the hero is the one people actually
        read.
      */}
      <View style={[styles.hero, { backgroundColor: theme.accentSoft, borderColor: theme.accentBorder }]}>
        <View style={styles.heroTop}>
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
            {greeting}
          </ThemedText>
          <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.accentBorder }]}>
            <Ionicons name="location" size={14} color={theme.accent} />
            <ThemedText type="caption" style={{ color: theme.text }} numberOfLines={1}>
              {defaultAddress
                ? `${zoneAreaName(zone, language) ?? defaultAddress.city} ${defaultAddress.pincode}`
                : t('home.deliveringTo')}
            </ThemedText>

            {/* A19 (COMPETITOR-TEARDOWN §11.5). Blinkit's `LocationBar__EtaContainer`
                keeps the ETA *in the location bar* `[MEASURED]`, so the number is
                visible the whole time the customer is browsing, not only on the
                checkout screen. It appears only when the zone really carries an
                ETA — same rule the hero below uses, for the same reason. */}
            {!isClosed && zone?.eta_minutes ? (
              <ThemedText type="caption" style={{ color: theme.accent }}>
                {t('home.pillEta', { minutes: zone.eta_minutes })}
              </ThemedText>
            ) : null}
          </View>
        </View>

        {/* One claim, big. No address yet means no zone, so no ETA is invented —
            the shop's standing line is shown instead. */}
        <ThemedText type="title" numberOfLines={2}>
          {isClosed
            ? t('home.closedTitle')
            : zone?.eta_minutes
              ? t('home.promise', { minutes: zone.eta_minutes })
              : t('home.subtitle')}
        </ThemedText>

        <ThemedText type="small" style={[styles.ask, { color: theme.accent }]}>
          {isClosed ? t('home.closedHint') : t('home.ask')}
        </ThemedText>
      </View>

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

                {/* A15 (COMPETITOR-TEARDOWN §11.5). Blinkit's rail says
                    "On first 10 orders" / "Get free delivery on your first
                    order!" `[MEASURED]` — the offer states its own scope. Without
                    this line a customer reasonably assumes a code works every
                    time, and finds out otherwise only when the basket they have
                    just built is refused at checkout.

                    Only the cap that exists is named, and the per-person number
                    wins when there is both: it is the one the customer will hit
                    first. No count of "uses left" — that is a different number
                    and it makes a shop look like it is running out. */}
                {offerScope(offer, t) ? (
                  <ThemedText type="caption" style={{ color: theme.successInk }}>
                    {offerScope(offer, t)}
                  </ThemedText>
                ) : null}
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
        {/* Chips arrive after the shelf's own bones do, because they are one
            query behind. Bones keep the rail from jumping when they land. */}
        {categories.isLoading ? <CategoryChipsSkeleton /> : null}
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

        <HomeSearch value={term} onChangeText={setTerm} words={searchWords} />
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
            // Grey cards in the shape of the shelf, not a spinner: on a 2G
            // connection a spinner for six seconds reads as "broken" (UX-5).
            <HomeShelfSkeleton />
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
            <>
              <StateMessage title={t('home.noResults')} hint={t('home.clearSearch')} art="🔍" />

              {/* A14 (COMPETITOR-TEARDOWN §11.5). Blinkit puts `CantFindText`,
                  `RaiseRequestText` and `Tell us what you need` on the search screen
                  itself — the door to "ask for it" is two taps from the search the
                  customer just typed `[MEASURED]`. A one-shop catalogue in a small
                  town will *always* be missing something; the difference between a
                  shop that listens and one that doesn't is whether asking is one tap
                  or three.

                  The honest version for us: no request table, no promise of
                  delivery. It is the shop's phone number — which the shop already
                  publishes — framed as the answer to "you don't have it". The shop
                  learns what people wanted, and the customer gets a real person
                  rather than a webhook. `CallShop` renders nothing when the shop has
                  left `support_phone` empty, so this degrades to the sentence. */}
              <View style={styles.cantFind}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {t('home.cantFindTitle', { query })}
                </ThemedText>
                <CallShop />
              </View>
            </>
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
            accessibilityLabel={[
              t('cart.basketSummary', {
                count: basketCount,
                amount: formatPaise(basketPaise),
              }),
              basketSavingsPaise > 0
                ? t('cart.savedOnMrp', { amount: formatPaise(basketSavingsPaise) })
                : '',
              t('cart.viewBasket'),
            ]
              .filter(Boolean)
              .join(' — ')}
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
              <View style={styles.basketText}>
                <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                  {t('cart.basketSummary', { count: basketCount, amount: formatPaise(basketPaise) })}
                </ThemedText>
                {basketSavingsPaise > 0 ? (
                  <ThemedText
                    type="caption"
                    style={{ color: theme.onAccent, opacity: 0.9 }}>
                    {t('cart.savedOnMrp', { amount: formatPaise(basketSavingsPaise) })}
                  </ThemedText>
                ) : null}
              </View>
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
        {products.map((product, index) => (
          <View key={product.id} style={styles.railCard}>
            <ProductCard
              product={product}
              // A horizontal rail peeks two cards; the third is already offscreen.
              priority={index < 2}
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
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
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
  sectionTitle: { marginTop: Spacing.four, marginBottom: Spacing.two },
  cantFind: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
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
  row: { gap: Spacing.twoHalf },
  columnGap: { height: Spacing.twoHalf },
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
  basketText: { gap: 1 },
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
