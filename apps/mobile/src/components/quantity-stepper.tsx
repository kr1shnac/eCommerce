import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The "- 2 +" control used on a product card and on a cart line.
 *
 * Both the product name and the quantity are spelled out for screen readers,
 * because a plus button next to a plus button means nothing when you cannot see
 * them (rule 9.9).
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
  const button = (icon: keyof typeof Ionicons.glyphMap, delta: number, enabled: boolean, label: string) => (
    <Pressable
      onPress={() => onChange(Math.max(0, Math.min(max, quantity + delta)))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={`${label} ${productName}`}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : styles.buttonLarge,
        { borderColor: theme.border, backgroundColor: theme.background },
        !enabled && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}>
      <Ionicons name={icon} size={compact ? 16 : 18} color={enabled ? theme.accent : theme.textSecondary} />
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {button('remove', -1, quantity > 0, t('cart.removeOne'))}
      <ThemedText
        type={compact ? 'smallBold' : 'default'}
        style={[styles.count, compact && styles.countCompact]}
        accessibilityLabel={t('cart.quantityOf', { name: productName, count: quantity })}>
        {quantity}
      </ThemedText>
      {button('add', 1, canAdd, t('cart.addOne'))}
      {max === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.stockNote}>
          {t('cart.outOfStock')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
  },
  buttonLarge: {
    width: 44,
    height: 44,
  },
  buttonCompact: {
    width: 44,
    height: 44,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.6,
  },
  count: {
    minWidth: 28,
    textAlign: 'center',
  },
  countCompact: {
    minWidth: 24,
  },
  stockNote: {
    marginLeft: Spacing.one,
  },
});