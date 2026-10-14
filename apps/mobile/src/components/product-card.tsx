import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AddToCart } from '@/components/add-to-cart';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { discountPercent, formatPaise } from '@/lib/money';
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
 * Deliberately NOT wrapped in a Pressable: the only thing you can do with a
 * product is add it to the basket, and a card-shaped tap target that swallows
 * the Add button's taps is worse than no tap target at all.
 */
export function ProductCard({ product, fallbackEmoji }: ProductCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  const off = discountPercent(product.price_paise, product.mrp_paise);
  const isOutOfStock = product.stock_qty <= 0;
  const showImage = Boolean(product.image_url) && !imageFailed;
  const emoji = product.emoji ?? fallbackEmoji ?? '🛒';

  return (
    <View
      style={[
        styles.card,
        Elevation.card,
        { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow },
      ]}>
      <View style={[styles.imageBox, { backgroundColor: theme.backgroundElement }]}>
        {showImage ? (
          <Image
            source={{ uri: product.image_url ?? '' }}
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

        {isOutOfStock ? (
          <View style={[styles.soldOut, { backgroundColor: theme.overlay }]}>
            <Badge label={t('home.outOfStock')} tone="danger" solid icon="close-circle" />
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <ThemedText type="bodyStrong" numberOfLines={2} style={styles.name}>
          {localizedName(product)}
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

        {!isOutOfStock ? (
          <View style={styles.footer}>
            <AddToCart
              productId={product.id}
              productName={localizedName(product)}
              stock={product.stock_qty}
            />
          </View>
        ) : (
          <View style={styles.footerSpacer} />
        )}
      </View>
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
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '78%', height: '78%' },
  emoji: { fontSize: 54, lineHeight: 64 },
  offBadge: { position: 'absolute', top: Spacing.two, left: Spacing.two },
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
  footer: { marginTop: Spacing.two, alignItems: 'flex-start' },
  footerSpacer: { height: 44 + Spacing.two },
});
