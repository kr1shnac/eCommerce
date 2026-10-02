import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { QuantityStepper } from '@/components/quantity-stepper';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCartStore } from '@/store/cart-store';
import { useTheme } from '@/hooks/use-theme';

type AddToCartProps = {
  productId: string;
  productName: string;
  /** Never offer more than the shop actually has. */
  stock: number;
};

/**
 * "Add" until it is in the basket, then a stepper.
 *
 * This subscribes to ONE product's quantity rather than the whole cart, so
 * tapping Add on a milk packet does not re-render all 34 cards on the screen.
 */
export function AddToCart({ productId, productName, stock }: AddToCartProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const quantity = useCartStore((state) => state.items[productId] ?? 0);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);

  if (stock <= 0) return null;

  if (quantity === 0) {
    return (
      <Pressable
        onPress={() => add(productId, 1)}
        accessibilityRole="button"
        accessibilityLabel={t('cart.addItem', { name: productName })}
        style={({ pressed }) => [
          styles.add,
          { borderColor: theme.accent, backgroundColor: theme.background },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          {t('cart.add')}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <QuantityStepper
      productName={productName}
      quantity={quantity}
      max={stock}
      onChange={(next) => setQuantity(productId, next)}
      compact
    />
  );
}

const styles = StyleSheet.create({
  add: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});