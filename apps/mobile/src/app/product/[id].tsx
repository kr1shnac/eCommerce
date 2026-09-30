import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToCart } from '@/components/add-to-cart';
import { FavouriteButton } from '@/components/favourite-button';
import { OfflineBanner } from '@/components/offline-banner';
import { PackOptions } from '@/components/pack-options';
import { ProductCard } from '@/components/product-card';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { SpeakButton } from '@/components/speak-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SectionHeader } from '@/components/ui/section-header';
import { Radii, Spacing } from '@/constants/theme';
import { useCategories, useProduct, useProducts } from '@/hooks/use-catalog';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { packLabel } from '@/lib/pack';
import { spokenProductLine } from '@/lib/speech';
import { formatPaiseForSpeech, discountPercent, formatPaise } from '@/lib/money';

/**
 * One product, at full size.
 *
 * The shelf is built for speed — tap Add and go — so this page exists for the
 * times a person wants to look first: a bigger picture, the discount spelled
 * out, and "you may also like" from the same aisle. It is one tap from any
 * card, and it is the only place a customer can save an item to their shortlist
 * with a sentence of context around it.
 *
 * The low-literacy rules still hold here: the picture is large, the discount is
 * a badge and not a sum, and stock is a colour plus an icon plus a word.
 */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const product = useProduct(id ?? null);
  // Both of these are almost always already in cache from Home, so the detail
  // page costs no extra request in the normal flow.
  const all = useProducts(null);
  const categories = useCategories();

  const [imageFailed, setImageFailed] = useState(false);

  const header = (
    <View style={[styles.headerRow, { paddingTop: insets.top + Spacing.two }]}>
      <IconButton icon="arrow-back" label={t('common.back')} onPress={() => router.back()} />
      <View style={styles.flex} />
      {product.data ? (
        <FavouriteButton
          productId={product.data.id}
          productName={localizedName(product.data)}
          variant="plain"
        />
      ) : null}
    </View>
  );

  if (product.isLoading) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        {header}
        <LoadingState />
      </View>
    );
  }

  if (product.isError) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        {header}
        <StateMessage
          title={t('product.errorTitle')}
          hint={t('product.errorHint')}
          tone="danger"
          onRetry={() => void product.refetch()}
        />
      </View>
    );
  }

  if (!product.data) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        {header}
        <StateMessage title={t('product.notFoundTitle')} hint={t('product.notFoundHint')} art="🔍" />
        <View style={styles.goneAction}>
          <Button
            label={t('product.backToShop')}
            icon="storefront-outline"
            onPress={() => router.replace('/(tabs)')}
          />
        </View>
      </View>
    );
  }

  const item = product.data;
  const name = localizedName(item);
  const off = discountPercent(item.price_paise, item.mrp_paise);
  const isOutOfStock = item.stock_qty <= 0;
  const isLowStock = !isOutOfStock && item.stock_qty <= 5;
  const showImage = Boolean(item.image_url) && !imageFailed;

  // The size the shop declares. `packLabel` prefers the structured pack ("1 kg")
  // and falls back to the free-text `unit`, so an undescribed shelf shows exactly
  // what it showed before the pack fields existed.
  const sizeLabel = packLabel(item);

  const category = (categories.data ?? []).find((candidate) => candidate.id === item.category_id);
  const categoryIcon = category?.icon ?? '🛒';
  const emoji = item.emoji ?? categoryIcon;

  const alsoLike = (all.data ?? [])
    .filter(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.category_id === item.category_id &&
        candidate.stock_qty > 0,
    )
    .slice(0, 10);

  return (
    <View style={styles.screen}>
      <OfflineBanner />
      {header}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <View style={[styles.imageBox, { backgroundColor: theme.backgroundElement }]}>
          {showImage ? (
            <Image
              source={{ uri: item.image_url ?? '' }}
              style={styles.image}
              contentFit="contain"
              transition={150}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <ThemedText style={styles.emoji}>{emoji}</ThemedText>
          )}

          {off !== null && !isOutOfStock ? (
            <Badge label={`-${off}%`} tone="secondary" solid style={styles.offBadge} />
          ) : null}
        </View>

        {category ? (
          <View style={styles.categoryRow}>
            <ThemedText style={styles.categoryEmoji}>{categoryIcon}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {localizedName(category)}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.titleBlock}>
          <ThemedText type="title">{name}</ThemedText>
          <ThemedText themeColor="textSecondary">{sizeLabel}</ThemedText>
        </View>

        <Card style={styles.buyCard}>
          <View style={styles.priceRow}>
            <ThemedText type="priceLarge">{formatPaise(item.price_paise)}</ThemedText>
            {item.mrp_paise !== null && off !== null ? (
              <>
                <ThemedText themeColor="textTertiary" style={styles.mrp}>
                  {formatPaise(item.mrp_paise)}
                </ThemedText>
                <Badge label={t('product.save', { off })} tone="secondary" />
              </>
            ) : null}
            {/* Reading the price aloud, in Kannada. Renders only when the phone has
                a real Kannada voice — see speak-button.tsx for why. */}
            <SpeakButton
              text={spokenProductLine(
                item.name_kn,
                sizeLabel,
                formatPaiseForSpeech(item.price_paise, t('speech.rupees'), t('speech.paise')),
                t('speech.priceLine'),
              )}
              label={`${item.name_kn} ${sizeLabel}`}
            />
          </View>

          <View style={styles.stockRow}>
            {isOutOfStock ? (
              <Badge label={t('product.outOfStock')} tone="danger" icon="close-circle" solid />
            ) : isLowStock ? (
              <Badge
                label={t('product.lowStock', { count: item.stock_qty })}
                tone="warning"
                icon="alert-circle-outline"
              />
            ) : (
              <Badge label={t('product.inStock')} tone="success" icon="checkmark-circle" />
            )}
          </View>

          <View style={styles.buyAction}>
            {isOutOfStock ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('product.outOfStockHint')}
              </ThemedText>
            ) : (
              <AddToCart productId={item.id} productName={name} stock={item.stock_qty} />
            )}
          </View>
        </Card>

        {/* Other pack sizes of the same thing. Renders nothing when the shop
            sells this in one size only — the common case. */}
        <PackOptions product={item} />

        <View style={styles.assuranceRow}>
          <Assurance icon="cash-outline" label={t('product.assuranceCash')} />
          <Assurance icon="leaf-outline" label={t('product.assuranceFresh')} />
          <Assurance icon="bicycle-outline" label={t('product.assuranceFast')} />
        </View>

        {alsoLike.length > 0 ? (
          <>
            <SectionHeader title={t('product.alsoLike')} style={styles.alsoHeader} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}>
              {alsoLike.map((candidate) => (
                <View key={candidate.id} style={styles.railCard}>
                  <ProductCard product={candidate} fallbackEmoji={categoryIcon} />
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Assurance({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.assurance}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <ThemedText type="caption" themeColor="textSecondary" style={styles.assuranceLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  goneAction: { alignItems: 'center', marginTop: -Spacing.three },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '80%', height: '80%' },
  emoji: { fontSize: 120, lineHeight: 136 },
  offBadge: { position: 'absolute', top: Spacing.two, left: Spacing.two },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  categoryEmoji: { fontSize: 16, lineHeight: 22 },
  titleBlock: { gap: 2 },
  buyCard: { gap: Spacing.two },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  mrp: { textDecorationLine: 'line-through' },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  buyAction: { marginTop: Spacing.three, alignItems: 'flex-start' },
  assuranceRow: { flexDirection: 'row', gap: Spacing.two },
  assurance: { flex: 1, alignItems: 'center', gap: Spacing.one },
  assuranceLabel: { textAlign: 'center' },
  alsoHeader: { marginTop: Spacing.two },
  rail: { gap: Spacing.two, paddingRight: Spacing.three, paddingVertical: Spacing.one },
  railCard: { width: 160 },
});
