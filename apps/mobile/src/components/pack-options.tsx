import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { usePackOptions } from '@/hooks/use-pack-options';
import { formatPaise } from '@/lib/money';
import { packInBase, trimNumber } from '@/lib/pack';
import { unitRatePaise } from '@/lib/unit-price';
import { localizedName } from '@/lib/localized';
import type { PackUnit, ProductSoldBy } from '@/types/database';

type PackLike = {
  id: string;
  store_id: string;
  category_id: string | null;
  name_en: string;
  name_kn: string;
  price_paise: number;
  stock_qty: number;
  sold_by: ProductSoldBy;
  pack_size: number | null;
  pack_unit: PackUnit | null;
  unit: string;
};

/**
 * "Also in 1 kg" — the other pack sizes of the same thing (register M4).
 *
 * WHY THIS IS A CHIP ROW AND NOT A SIZE PICKER. Kunigal's shop sells rice by the
 * kilo and tomato by the packet, and a customer who wants the kilo wants to *see*
 * the kilo's price before deciding. A picker that swaps the price under the
 * customer's thumb hides exactly the number they came for. A row of chips shows
 * every size and its price at once, the way the shelf does.
 *
 * WHAT IT IS NOT. Tapping a chip does not change what this page sells. It pushes
 * the *other* product's own page, so that product's price, stock and the product
 * guard all apply. The alternative is never used to price this item, so a stale or
 * manipulated alternative cannot sell one thing at another's price (§9.1).
 *
 * Renders nothing at all when there are no alternatives — which is the honest
 * common case, and the case the customer already saw before this feature existed.
 */
export function PackOptions({ product }: { product: PackLike }) {
  const { t } = useTranslation();
  const router = useRouter();
  const options = usePackOptions(product.id, product);

  const rows = options.data ?? [];
  if (rows.length === 0) return null;

  const mine = packInBase(product.pack_size, product.pack_unit);

  /** "₹99.00/kg" for a chip, or null when the product has no honest rate (A2). */
  const rateText = (pricePaise: number, size: number | null, unit: PackUnit | null) => {
    const rate = unitRatePaise(pricePaise, size, unit);
    return rate
      ? t('unitPrice.perUnit', { price: formatPaise(rate.paise), unit: rate.unit })
      : null;
  };

  /** The same rate as a spoken sentence, for the accessibility label. */
  const rateSpoken = (pricePaise: number, size: number | null, unit: PackUnit | null) => {
    const rate = unitRatePaise(pricePaise, size, unit);
    return rate
      ? t('unitPrice.a11y', {
          price: formatPaise(rate.paise),
          unitName: rate.unit === 'l' ? t('unitPrice.l') : t('unitPrice.kg'),
        })
      : null;
  };

  return (
    <View style={styles.wrap}>
      <ThemedText type="caption" themeColor="textSecondary">
        {t('pack.sizesTitle')}
      </ThemedText>

      <View style={styles.row}>
        {/* The size being viewed comes first and is shown as selected, so the row
            reads as "here is where you are, and here is what else there is". */}
        <Chip
          label={packSizeLabel(product.pack_size, product.pack_unit, product.unit)}
          price={formatPaise(product.price_paise)}
          rate={rateText(product.price_paise, product.pack_size, product.pack_unit)}
          selected
          disabled={false}
          onPress={() => undefined}
        />

        {rows.map((row) => {
          const theirs = packInBase(row.pack_size, row.pack_unit);
          const soldOut = row.stock_qty <= 0;
          const size = packSizeLabel(row.pack_size, row.pack_unit, row.unit);
          const price = soldOut ? t('product.outOfStock') : formatPaise(row.price_paise);
          const rate = soldOut ? null : rateText(row.price_paise, row.pack_size, row.pack_unit);
          const spoken = soldOut
            ? null
            : rateSpoken(row.price_paise, row.pack_size, row.pack_unit);

          return (
            <Chip
              key={row.id}
              label={packSizeLabel(row.pack_size, row.pack_unit, '')}
              price={price}
              rate={rate}
              // Bigger or smaller than what is on screen, read as a direction, so
              // the customer can find the size they meant without arithmetic.
              bigger={theirs !== null && mine !== null ? theirs > mine : undefined}
              selected={false}
              disabled={soldOut}
              onPress={() => router.push(`/product/${row.id}`)}
              accessibilityLabel={
                spoken
                  ? t('pack.openSizeRate', {
                      name: localizedName(row),
                      size,
                      price,
                      rate: spoken,
                    })
                  : t('pack.openSize', { name: localizedName(row), size, price })
              }
            />
          );
        })}
      </View>
    </View>
  );
}

/**
 * The size chip.
 *
 * A 44×44 minimum tap target (§9.9) even though the chip is short, because this
 * is tapped by a thumb on a phone held in one hand while the other holds a bag.
 */
function Chip({
  label,
  price,
  rate,
  selected,
  disabled,
  bigger,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  price: string;
  /** A2: the rate line ("₹99.00/kg"), or null when the pack has no honest rate. */
  rate?: string | null;
  selected: boolean;
  disabled: boolean;
  bigger?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const bg = selected ? theme.accentSoft : theme.backgroundElement;
  const border = selected ? theme.accent : theme.border;
  const labelInk = selected ? theme.accent : theme.text;
  const priceInk = selected ? theme.accent : disabled ? theme.textTertiary : theme.textSecondary;
  const rateInk = selected ? theme.accent : theme.textTertiary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || selected}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: disabled || selected }}
      accessibilityLabel={accessibilityLabel ?? [label, price, rate].filter(Boolean).join(', ')}
      style={[styles.chip, { backgroundColor: bg, borderColor: border }, disabled && styles.chipDisabled]}>
      <View style={styles.chipTop}>
        {bigger !== undefined && !selected ? (
          <ThemedText type="caption" style={[styles.arrow, { color: theme.textTertiary }]}>
            {bigger ? '↑' : '↓'}
          </ThemedText>
        ) : null}
        <ThemedText type="smallBold" style={{ color: labelInk }} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
      <ThemedText type="caption" style={{ color: priceInk }} numberOfLines={1}>
        {price}
      </ThemedText>
      {/* The rate is the reason this row exists, so it gets its own line rather
          than being squeezed beside the price. Tertiary ink, because it is
          supporting evidence, not the thing being bought. */}
      {rate ? (
        <ThemedText type="caption" style={{ color: rateInk }} numberOfLines={1}>
          {rate}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** "1 kg" from the structured pack, or the shop's own words when there is none. */
function packSizeLabel(size: number | null, unit: PackUnit | null, fallback: string): string {
  if (size === null || unit === null) return fallback;
  return `${trimNumber(size)} ${unit}`;
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 44,
    minWidth: 76,
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Radii.md,
    borderWidth: 1.5,
  },
  chipDisabled: { opacity: 0.55 },
  chipTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  arrow: { fontSize: 11 },
});
