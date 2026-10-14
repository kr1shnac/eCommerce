import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = keyof typeof Ionicons.glyphMap;

export type BadgeTone = 'neutral' | 'accent' | 'secondary' | 'success' | 'warning' | 'danger';

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  /** Solid fill (offers, "out of stock") vs the default pale wash. */
  solid?: boolean;
  style?: ViewStyle;
};

/**
 * A small pill. Used for order status, discounts, "default address". It pairs a
 * colour with an icon and a word, so the meaning survives for a reader who
 * cannot read the word (one in three adults here — KUNIGAL.md §1).
 */
export function Badge({ label, tone = 'neutral', icon, solid = false, style }: BadgeProps) {
  const theme = useTheme();

  // Text on a pale wash uses the `*Ink` token, never the bright fill colour:
  // marigold-on-marigold-soft is only ~2.3:1, which a customer in the sun
  // cannot read. See the note on `*Ink` in constants/theme.ts.
  const soft: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: theme.backgroundElement, fg: theme.textSecondary },
    accent: { bg: theme.accentSoft, fg: theme.accent },
    secondary: { bg: theme.secondarySoft, fg: theme.secondaryInk },
    success: { bg: theme.successSoft, fg: theme.successInk },
    warning: { bg: theme.warningSoft, fg: theme.warningInk },
    danger: { bg: theme.dangerSoft, fg: theme.dangerInk },
  };

  // Solid fills keep readable text: success/warning use their darker ink tone so
  // cream-on-green still clears 4.5:1 at caption size.
  const filled: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: theme.textSecondary, fg: theme.background },
    accent: { bg: theme.accent, fg: theme.onAccent },
    secondary: { bg: theme.secondary, fg: theme.onSecondary },
    success: { bg: theme.successInk, fg: theme.background },
    warning: { bg: theme.warningInk, fg: theme.background },
    danger: { bg: theme.danger, fg: theme.background },
  };

  const c = solid ? filled[tone] : soft[tone];

  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, style]}>
      {icon ? <Ionicons name={icon} size={12} color={c.fg} /> : null}
      <ThemedText type="caption" style={[styles.label, { color: c.fg }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  label: { fontSize: 12.5, lineHeight: 16 },
});
