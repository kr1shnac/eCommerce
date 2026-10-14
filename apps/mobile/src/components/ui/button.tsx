import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = keyof typeof Ionicons.glyphMap;

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  disabled?: boolean;
  /** Shows a spinner and blocks taps. Always false-y unless a write is in flight. */
  busy?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
};

/**
 * The one button in the app.
 *
 * `primary` is the single most important action on a screen (Place order, Accept
 * order); everything else is `outline` or `ghost` so a screen has exactly one
 * green thing drawing the eye. Minimum height is 48 px, above the 44 px floor
 * (KUNIGAL.md, rule 9.9) because a thumb on a bike mount is imprecise.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  disabled = false,
  busy = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const blocked = disabled || busy;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: theme.accent, fg: theme.onAccent, border: theme.accent },
    secondary: { bg: theme.secondary, fg: theme.onSecondary, border: theme.secondary },
    outline: { bg: 'transparent', fg: theme.accent, border: theme.accentBorder },
    ghost: { bg: 'transparent', fg: theme.text, border: 'transparent' },
    danger: { bg: 'transparent', fg: theme.danger, border: theme.danger },
  };
  const c = palette[variant];

  const height = size === 'lg' ? 54 : 48;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          backgroundColor: c.bg,
          borderColor: c.border,
          borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth,
        },
        fullWidth && styles.fullWidth,
        variant === 'primary' && Elevation.card,
        variant === 'primary' && { shadowColor: theme.shadow },
        blocked && styles.blocked,
        pressed && !blocked && styles.pressed,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={size === 'lg' ? 20 : 18} color={c.fg} /> : null}
          <ThemedText type="smallBold" style={[styles.label, { color: c.fg }]}>
            {label}
          </ThemedText>
          {iconRight ? <Ionicons name={iconRight} size={size === 'lg' ? 20 : 18} color={c.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  fullWidth: { alignSelf: 'stretch' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  label: { fontSize: 15 },
  blocked: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
