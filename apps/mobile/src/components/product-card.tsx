import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AddToCart } from '@/components/add-to-cart';
import { FavouriteButton } from '@/components/favourite-button';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { discountPercent, formatPaise } from '@/lib/money';
import { useLanguageStore } from '@/store/language-store';
import type { Product } from '@/types/database';

type ProductCardProps = {
  product: Product;
  /**
   * Emoji shown when the product has no photo and no emoji of its own. The
   * caller passes the category's icon; `products.emoji` (per item) wins over it,
   * so the grid reads as a shelf of different things rather than eight copies of
   * the same leaf.
   */
  fallbackEmoji?: string;
};

/**
 * One item on the shelf.
 *
 * The picture and the name open the product's own page; the green Add pill is a
 * separate target that only ever adds. Those two are deliberately NOT nested,
 * because a card that swallows the Add tap is worse than no card tap at all.
 * The heart in the corner is a third, equally separate target.
 */
export function ProductCard({ product, fallbackEmoji }: ProductCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  // The name is DB text, so it follows the language store directly. That way the
  // card can never settle on a stale language just because it happened to render
  // during a switch.
  const language = useLanguageStore((state) => state.language);
  const [imageFailed, setImageFailed] = useState(false);

  const off = discountPercent(product.price_paise, product.mrp_paise);
  const isOutOfStock = product.stock_qty <= 0;
  const showImage = Boolean(product.image_url) && !imageFailed;
  const emoji = product.emoji ?? fallbackEmoji ?? '🛒';
  const name = localizedName(product, language);

  const openDetail = () => router.push({ pathname: '/product/[id]', params: { id: product.id } });

  return (
    <View
      style={[
        styles.card,
        Elevation.card,
        { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow },
      ]}>
      <Pressable
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={t('product.open', { name })}
        style={styles.tapArea}>
        <View style={[styles.imageBox, { backgroundColor: theme.backgroundElement }]}>
          {showImage ? (
            <Image
              source={{ uri: product.image_url ?? '' }}
              style={styles.image}
              contentFit="cover"
              transition={150}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View
              style={[styles.emojiPlate, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <ThemedText style={styles.emoji}>{emoji}</ThemedText>
            </View>
          )}

          {off !== null && !isOutOfStock ? (
            <Badge label={`-${off}%`} tone="secondary" solid style={styles.offBadge} />
          ) : null}

          {isOutOfStock ? (
            <View style={[styles.soldOut, { backgroundColor: theme.overlay }]}>
              <Badge label={t('home.outOfStock')} tone="danger" solid icon="close-circle" />
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <ThemedText type="bodyStrong" numberOfLines={2} style={styles.name}>
            {name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {product.unit}
          </ThemedText>

          <View style={styles.priceRow}>
            <ThemedText type="price" style={{ color: theme.text }}>
              {formatPaise(product.price_paise)}
            </ThemedText>
            {off !== null && product.mrp_paise !== null ? (
              <ThemedText type="small" themeColor="textTertiary" style={styles.mrp}>
                {formatPaise(product.mrp_paise)}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </Pressable>

      {/*
        The heart is a SIBLING of the card's tap area, never a child. On web both
        render as a <button>, and a button inside a button is invalid HTML —
        React logs "button cannot contain a nested button" and the inner tap is
        unreliable. Absolutely positioned, so it sits exactly where it did when it
        was inside the picture box.
      */}
      <FavouriteButton productId={product.id} productName={name} style={styles.heart} />

      {!isOutOfStock ? (
        <View style={styles.footer}>
          <AddToCart productId={product.id} productName={name} stock={product.stock_qty} />
        </View>
      ) : (
        <View style={styles.footerSpacer} />
      )}
    </View>
  );
}

/**
 * The "out of stock" state is carried by a dim overlay, a red badge and an ✕
 * icon at once, so it does not rely on reading the word (KUNIGAL.md §2).
 */

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tapArea: { flex: 1 },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  /**
   * The no-photo-yet state, designed rather than bare: the emoji sits on a soft
   * plate with a hairline, so an unphotographed product still reads as a deliberate
   * tile rather than a blank hole on the shelf.
   */
  emojiPlate: {
    width: '72%',
    aspectRatio: 1,
    maxWidth: 112,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  emoji: { fontSize: 54, lineHeight: 64 },
  offBadge: { position: 'absolute', top: Spacing.two, left: Spacing.two },
  heart: { position: 'absolute', top: Spacing.one, right: Spacing.one },
  soldOut: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.two + 2,
    paddingBottom: 0,
    gap: 2,
  },
  name: { minHeight: 48 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one + 2,
    marginTop: Spacing.one,
  },
  mrp: { textDecorationLine: 'line-through' },
  footer: { marginTop: Spacing.two, paddingHorizontal: Spacing.two + 2, paddingBottom: Spacing.two + 2, alignItems: 'flex-start' },
  footerSpacer: { height: 44 + Spacing.three + Spacing.two },
});
