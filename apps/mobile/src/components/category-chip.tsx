import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CategoryChipProps = {
  /** Already localized by the caller (see lib/localized.ts). */
  label: string;
  icon?: string | null;
  isSelected: boolean;
  onPress: () => void;
};

/**
 * A category is a picture with a word under it, not a pill of text.
 *
 * In a town where one in three adults struggles to read a sentence, the emoji
 * has to be the primary signal and the word the confirmation (KUNIGAL.md §2).
 * Selection is shown by a tint, a border AND a heavier label, never colour alone.
 */
export function CategoryChip({ label, icon, isSelected, onPress }: CategoryChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        Elevation.card,
        {
          backgroundColor: isSelected ? theme.accentSoft : theme.card,
          borderColor: isSelected ? theme.accentBorder : theme.border,
          shadowColor: theme.shadow,
        },
        pressed && styles.pressed,
      ]}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: isSelected ? theme.card : theme.backgroundElement },
        ]}>
        <ThemedText style={styles.icon}>{icon ?? '🛒'}</ThemedText>
      </View>
      <ThemedText
        type={isSelected ? 'smallBold' : 'small'}
        numberOfLines={2}
        style={[styles.label, isSelected ? { color: theme.accent } : undefined]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 88,
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 24, lineHeight: 30 },
  label: { textAlign: 'center', fontSize: 12.5, lineHeight: 17 },
  pressed: { opacity: 0.75 },
});
