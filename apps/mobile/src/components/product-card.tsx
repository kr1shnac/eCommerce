import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AddToCart } from '@/components/add-to-cart';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { discountPercent, formatPaise } from '@/lib/money';
import type { Product } from '@/types/database';

const OFF_BADGE_BG = '#0E7C4A';

type ProductCardProps = {
  product: Product;
  /** Emoji shown when the product has no image, or the image fails to load. */
  fallbackEmoji?: string;
};

export function ProductCard({ product, fallbackEmoji = '🛒' }: ProductCardProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [imageFailed, setImageFailed] = useState(false);

  const off = discountPercent(product.price_paise, product.mrp_paise);
  const isOutOfStock = product.stock_qty <= 0;
  const showImage = Boolean(product.image_url) && !imageFailed;

  // Deliberately not wrapped in a Pressable: the only thing you can do with a
  // product is add it to the basket, and a card-shaped tap target that swallows
  // the Add button's taps is worse than no tap target at all.
  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={[styles.imageBox, { backgroundColor: theme.backgroundElement }]}>
        {showImage ? (
          <Image
            source={{ uri: product.image_url ?? '' }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <ThemedText style={styles.emoji}>{fallbackEmoji}</ThemedText>
        )}
        {off !== null && (
          <View style={styles.offBadge}>
            <ThemedText type="smallBold" style={styles.offBadgeText}>
              {`${off}%`}
            </ThemedText>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <ThemedText numberOfLines={2} style={styles.name}>
          {localizedName(product)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {product.unit}
        </ThemedText>

        <View style={styles.priceRow}>
          <ThemedText type="smallBold" style={[styles.price, { color: theme.accent }]}>
            {formatPaise(product.price_paise)}
          </ThemedText>
          {off !== null && product.mrp_paise !== null && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.mrp}>
              {formatPaise(product.mrp_paise)}
            </ThemedText>
          )}
        </View>

        {isOutOfStock ? (
          <ThemedText type="smallBold" style={[styles.outOfStock, { color: theme.danger }]}>
            {t('home.outOfStock')}
          </ThemedText>
        ) : (
          <View style={styles.footer}>
            <AddToCart
              productId={product.id}
              productName={localizedName(product)}
              stock={product.stock_qty}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  imageBox: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '70%',
    height: '70%',
  },
  emoji: {
    fontSize: 40,
  },
  offBadge: {
    position: 'absolute',
    top: Spacing.one,
    left: Spacing.one,
    backgroundColor: OFF_BADGE_BG,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  offBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    lineHeight: 15,
  },
  body: {
    padding: 10,
    gap: 2,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: Spacing.one,
  },
  price: {
    fontSize: 16,
  },
  mrp: {
    textDecorationLine: 'line-through',
  },
  outOfStock: {
    marginTop: 2,
  },
  footer: {
    marginTop: Spacing.two,
    alignItems: 'flex-start',
  },
});