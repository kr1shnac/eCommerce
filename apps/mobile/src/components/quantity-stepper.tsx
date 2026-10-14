import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The "- 2 +" control used on a product card and on a cart line.
 *
 * It is one filled pill, not three loose buttons: the green block is itself the
 * signal that "this is already in your basket", which a reader who cannot read
 * the quantity still understands (KUNIGAL.md §2). Both the product name and the
 * quantity are spelled out for screen readers, because a plus button next to a
 * plus button means nothing when you cannot see them (rule 9.9).
 */
type QuantityStepperProps = {
  productName: string;
  quantity: number;
  max: number;
  onChange: (quantity: number) => void;
  compact?: boolean;
};

export function QuantityStepper({
  productName,
  quantity,
  max,
  onChange,
  compact = false,
}: QuantityStepperProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const canAdd = quantity < max;
  const size = compact ? 16 : 18;

  const button = (
    icon: keyof typeof Ionicons.glyphMap,
    delta: number,
    enabled: boolean,
    label: string,
  ) => (
    <Pressable
      onPress={() => onChange(Math.max(0, Math.min(max, quantity + delta)))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={`${label} ${productName}`}
      hitSlop={8}
      style={({ pressed }) => [styles.button, !enabled && styles.buttonDisabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={size} color={theme.onAccent} />
    </Pressable>
  );

  return (
    <View style={styles.row}>
      <View style={[styles.pill, { backgroundColor: theme.accent }]}>
        {button('remove', -1, quantity > 0, t('cart.removeOne'))}
        <ThemedText
          type="smallBold"
          style={[styles.count, { color: theme.onAccent }]}
          accessibilityLabel={t('cart.quantityOf', { name: productName, count: quantity })}>
          {quantity}
        </ThemedText>
        {button('add', 1, canAdd, t('cart.addOne'))}
      </View>
      {max === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.stockNote}>
          {t('cart.outOfStock')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.one,
    minHeight: 44,
  },
  button: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
  count: { minWidth: 22, textAlign: 'center', fontSize: 15 },
  stockNote: { marginLeft: Spacing.one },
});
