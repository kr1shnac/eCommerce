import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Screen-shaped loading skeletons (register UX-5).
 *
 * Why these exist at all: `LoadingState` is a spinner, and on a 2G connection a
 * spinner for six seconds reads as "broken" — it says *something is happening*
 * but not *what will appear*. A skeleton of the real layout says "a shelf of
 * products is coming", which is the same information the spinner carries plus
 * the reassurance that the screen is not stuck.
 *
 * **These must mirror the real screens.** A skeleton whose shapes do not match
 * the content it replaces is worse than a spinner: it promises one layout and
 * delivers another, and the content visibly jumps. If the card on a screen
 * changes, the skeleton here changes in the same commit.
 */

/** One product card's shape: square picture, two name lines, price, add pill. */
export function ProductCardSkeleton() {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        Elevation.card,
        { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow },
      ]}>
      {/* aspectRatio, not a fixed height: the real card's picture is square at
          whatever width the column happens to be, so the skeleton tracks it. */}
      <Skeleton radius={0} style={styles.picture} />
      <View style={styles.cardBody}>
        <Skeleton height={11} width="92%" />
        <Skeleton height={11} width="64%" />
        <View style={styles.priceRow}>
          <Skeleton height={16} width={64} />
          <Skeleton height={11} width={36} />
        </View>
        <View style={styles.cardFoot}>
          <Skeleton height={30} width={72} radius={Radii.pill} />
        </View>
      </View>
    </View>
  );
}

/**
 * The Home shelf while the catalogue is in flight. Two rows of two matches the
 * `numColumns={2}` grid, so the first real products land where the bones were.
 *
 * The hero above it is NOT skeletonised: it is real content that needs no
 * network (the greeting, the shop's promise), so replacing it with grey boxes
 * would hide information the app already has.
 */
export function HomeShelfSkeleton({ rows = 2 }: { rows?: number }) {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      style={styles.grid}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.gridRow}>
          <View style={styles.cardSlot}>
            <ProductCardSkeleton />
          </View>
          <View style={styles.cardSlot}>
            <ProductCardSkeleton />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The category chip rail while `categories` is in flight. The "All" chip is real
 * and renders immediately, so these sit after it rather than replacing the row.
 */
export function CategoryChipsSkeleton({ count = 3 }: { count?: number }) {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityLabel={t('common.loading')}
      style={styles.chipRow}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} height={36} width={104} radius={Radii.pill} />
      ))}
    </View>
  );
}

/**
 * The order screen while the order is in flight: the status card (title, the
 * four-stop ladder, the timestamp rows), the rider card, then the items card.
 * The same three blocks, in the same order, as the real screen.
 */
export function OrderSkeleton() {
  const { t } = useTranslation();

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      style={styles.stack}>
      <Card style={styles.block}>
        <Skeleton height={11} width="42%" />
        <View style={styles.ladder}>
          {Array.from({ length: 4 }, (_, index) => (
            <View key={index} style={styles.ladderStop}>
              <Skeleton height={26} width={26} radius={Radii.pill} />
              <Skeleton height={9} width="80%" />
            </View>
          ))}
        </View>
        <Skeleton height={11} width="70%" />
        <Skeleton height={11} width="52%" />
        <Skeleton height={11} width="46%" />
      </Card>

      <Card style={styles.block}>
        <Skeleton height={11} width="34%" />
        <View style={styles.riderRow}>
          <Skeleton height={44} width={44} radius={Radii.pill} />
          <View style={styles.riderLines}>
            <Skeleton height={12} width="55%" />
            <Skeleton height={10} width="38%" />
          </View>
        </View>
      </Card>

      <Card style={styles.block}>
        <Skeleton height={11} width="26%" />
        <Skeleton height={12} width="86%" />
        <Skeleton height={12} width="72%" />
        <Skeleton height={12} width="78%" />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: Spacing.three },
  gridRow: { flexDirection: 'row', gap: Spacing.three },
  cardSlot: { flex: 1 },
  card: {
    flex: 1,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  picture: { width: '100%', aspectRatio: 1 },
  cardBody: { padding: Spacing.two + 2, gap: Spacing.one + 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  cardFoot: { alignItems: 'flex-end', marginTop: Spacing.one },
  chipRow: { flexDirection: 'row', gap: Spacing.two },
  stack: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.three },
  block: { gap: Spacing.two },
  ladder: { flexDirection: 'row', gap: Spacing.two, marginVertical: Spacing.two },
  ladderStop: { flex: 1, alignItems: 'center', gap: Spacing.one },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  riderLines: { flex: 1, gap: Spacing.one },
});
