import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { hasLandmark, splitSnapshotAddress, type SnapshotAddress } from '@/lib/order-view';

/**
 * The delivery address, as a rider needs it.
 *
 * A customer reading their own address knows where they live; the sentence is a
 * reminder. A rider is trying to FIND a house, on a bike, in a town with no
 * reliable street numbering. For them the landmark is the instruction — "the big
 * banyan tree" is how you say a place here — and the house number is the part
 * that may well not exist.
 *
 * So the landmark leads, at a readable size, and the rest is the supporting
 * detail underneath. When the customer gave no landmark (the field is optional
 * and often blank) this falls back to the plain sentence rather than rendering an
 * empty heading with a stray icon.
 *
 * Used by both the waiting pool and "my deliveries" so the two cards cannot drift
 * apart, which is what happened before this existed.
 */
export function RiderAddressBlock({ address }: { address: SnapshotAddress }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const { landmark, rest } = splitSnapshotAddress(address);
  const lede = hasLandmark(address) ? landmark : rest;
  const detail = hasLandmark(address) ? rest : null;

  // Nothing at all to show: an order whose snapshot is empty. Say so plainly
  // rather than rendering a lone icon — a rider needs to know to call the shop.
  if (!lede) {
    return (
      <View style={styles.row}>
        <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
          {t('rider.noAddress')}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Ionicons
        name={hasLandmark(address) ? 'flag' : 'location-outline'}
        size={16}
        color={hasLandmark(address) ? theme.accent : theme.textSecondary}
        style={styles.icon}
      />
      <View style={styles.flex}>
        {/* The landmark is the instruction, so it is the biggest thing here. */}
        <ThemedText type="smallBold" numberOfLines={2}>
          {lede}
        </ThemedText>
        {detail ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={3}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  // Nudge the icon down so it lines up with the first line of text, not the
  // top of a two-line block.
  icon: { marginTop: 1 },
  flex: { flex: 1 },
});
