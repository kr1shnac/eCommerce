import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { useFavourites, useToggleFavourite } from '@/hooks/use-favourites';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import { Radii } from '@/constants/theme';

type FavouriteButtonProps = {
  productId: string;
  /** Announced to a screen reader: "Save rice" / "Remove rice from saved". */
  productName: string;
  /**
   * `overlay` draws it as a light disc for sitting on top of a product image;
   * `plain` is a bare heart for a screen header.
   */
  variant?: 'overlay' | 'plain';
  style?: ViewStyle;
};

/**
 * The heart. One tap saves or un-saves a product for THIS customer.
 *
 * Signed out, it is a doorway to sign-in rather than a dead button — a person
 * who taps a heart expects something to happen, and the useful something is to
 * ask for the phone number. The count is never shown ("12 people saved this"),
 * because that is nobody's business and it is not true yet.
 */
export function FavouriteButton({
  productId,
  productName,
  variant = 'overlay',
  style,
}: FavouriteButtonProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const session = useAuthStore((state) => state.session);

  const favourites = useFavourites();
  const toggle = useToggleFavourite();
  const isFavourite = (favourites.data ?? []).includes(productId);

  const onPress = () => {
    if (!session) {
      router.push('/login?returnTo=/(tabs)');
      return;
    }
    toggle.mutate({ productId, isFavourite });
  };

  const iconColor = isFavourite ? theme.danger : variant === 'overlay' ? theme.textSecondary : theme.text;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isFavourite }}
      accessibilityLabel={
        isFavourite
          ? t('favourite.remove', { name: productName })
          : t('favourite.add', { name: productName })
      }
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        variant === 'overlay' && {
          backgroundColor: theme.card,
          borderColor: theme.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
        pressed && styles.pressed,
        style,
      ]}>
      <Ionicons
        name={isFavourite ? 'heart' : 'heart-outline'}
        size={20}
        color={isFavourite ? theme.danger : iconColor}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
