import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CategoryChipProps = {
  /** Already localized by the caller (see lib/localized.ts). */
  label: string;
  icon?: string | null;
  isSelected: boolean;
  onPress: () => void;
};

export function CategoryChip({ label, icon, isSelected, onPress }: CategoryChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: isSelected ? theme.accent : theme.backgroundElement,
          borderColor: isSelected ? theme.accent : theme.border,
        },
        pressed && styles.pressed,
      ]}>
      {icon ? <ThemedText style={styles.icon}>{icon}</ThemedText> : null}
      <ThemedText
        type="smallBold"
        style={[styles.label, { color: isSelected ? '#ffffff' : theme.text }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    fontSize: 15,
  },
  label: {
    fontSize: 14,
  },
});