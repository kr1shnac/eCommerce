import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type SectionHeaderProps = {
  title: string;
  /**
   * A small emoji before the title. The shelf is read by picture first
   * (KUNIGAL.md §2), so each section carries its own face — a gift for offers, a
   * flame for deals — which tells you what is coming before you read a word.
   */
  emoji?: string;
  /** Right-aligned content, usually a count or a small "see all". */
  action?: ReactNode;
  style?: object;
};

/**
 * A section title inside a scrolling screen. Deliberately NOT uppercased —
 * `textTransform: 'uppercase'` is meaningless for Kannada and jitters Latin, so
 * the heading is set by size and weight instead.
 */
export function SectionHeader({ title, emoji, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.titleRow}>
        {emoji ? (
          <ThemedText style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">
            {emoji}
          </ThemedText>
        ) : null}
        <ThemedText type="heading">{title}</ThemedText>
      </View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    flexShrink: 1,
  },
  emoji: { fontSize: 20, lineHeight: 26 },
});
