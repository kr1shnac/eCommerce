import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SkeletonProps = {
  /** Defaults to full width. */
  width?: DimensionValue;
  /**
   * A bone with no height and no `aspectRatio` collapses, so every caller gives
   * one of them. That is deliberate: a silently invisible skeleton is worse than
   * a spinner.
   */
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * One grey placeholder shape, for the loading skeleton (register UX-5).
 *
 * **It does not animate, on purpose.** A pulsing skeleton is the web convention,
 * but every animation here is a frame the phone has to draw, and the target
 * device is a cheap Android on a slow connection — the exact conditions where a
 * dropped frame makes the app feel *slower*, which is the opposite of the point
 * of a skeleton (SCALE-AND-TRACKING.md §3.2). A static grey block that becomes
 * real content in 300 ms reads as speed; a shimmer at 12 fps reads as broken.
 *
 * The colour is `backgroundElement` — the same inset fill the real image tiles,
 * chips and search field use — so the skeleton is the layout's own grey, not an
 * invented one, and it is correct in both themes without a new token.
 */
export function Skeleton({ width = '100%', height, radius = Radii.sm, style }: SkeletonProps) {
  const theme = useTheme();

  return (
    <View
      // Placeholders are not content. A screen reader should hear "Loading" once
      // from the enclosing container, not a dozen meaningless boxes.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.bone,
        { width, height, borderRadius: radius, backgroundColor: theme.backgroundElement },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  bone: { overflow: 'hidden' },
});
