import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type SectionHeaderProps = {
  title: string;
  /** Right-aligned content, usually a count or a small "see all". */
  action?: ReactNode;
  style?: object;
};

/**
 * A section title inside a scrolling screen. Deliberately NOT uppercased —
 * `textTransform: 'uppercase'` is meaningless for Kannada and jitters Latin, so
 * the heading is set by size and weight instead.
 */
export function SectionHeader({ title, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <ThemedText type="heading">{title}</ThemedText>
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
});
