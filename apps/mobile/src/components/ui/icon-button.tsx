import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Required: an icon with no visible word must still be announced (rule 9.9). */
  label: string;
  onPress: () => void;
  /** A filled tint, e.g. when it is the active state. */
  tone?: 'plain' | 'accent';
  disabled?: boolean;
  /** Defaults to the plain ink colour, or the accent when `tone="accent"`. */
  color?: string;
  style?: ViewStyle;
};

/**
 * The round icon button used in screen headers (back, sign out, switch to the
 * customer view). 44×44 is the minimum tap target, and the icon inside is
 * smaller, so a thumb on a moving bike still hits it (KUNIGAL.md, rule 9.9).
 */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'plain',
  disabled = false,
  color,
  style,
}: IconButtonProps) {
  const theme = useTheme();

  const background =
    tone === 'accent' ? theme.accentSoft : tone === 'plain' ? 'transparent' : 'transparent';
  const foreground = color ?? (tone === 'accent' ? theme.accent : theme.text);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}>
      <Ionicons name={icon} size={22} color={foreground} />
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
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
