import { StyleSheet, View, type ViewProps } from 'react-native';

import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CardProps = ViewProps & {
  /** A tinted card (e.g. the COD box, a success banner) instead of the default surface. */
  tone?: 'surface' | 'accent' | 'secondary' | 'warning' | 'danger';
  /** Drop the shadow for cards nested inside another card. */
  flat?: boolean;
};

/**
 * A raised surface. Every group of things on a screen sits in one of these, so
 * the page reads as tidy blocks instead of a wall of text — important when the
 * reader may be scanning, not reading (KUNIGAL.md).
 */
export function Card({ tone = 'surface', flat = false, style, children, ...rest }: CardProps) {
  const theme = useTheme();

  const backgrounds: Record<NonNullable<CardProps['tone']>, string> = {
    surface: theme.card,
    accent: theme.accentSoft,
    secondary: theme.secondarySoft,
    warning: theme.warningSoft,
    danger: theme.dangerSoft,
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: backgrounds[tone], borderColor: theme.border },
        !flat && Elevation.card,
        !flat && { shadowColor: theme.shadow },
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
});
