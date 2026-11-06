import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguageStore } from '@/store/language-store';

/** How long each shelf word stays on screen. Long enough to read Kannada. */
const CYCLE_MS = 4000;

/**
 * The shelf search, whose placeholder teaches by example (register B4).
 *
 * The old placeholder was a fixed list — "Search rice, milk, oil…" — which tells
 * somebody *what* search is for but not that it works on the things they can
 * see in front of them. This one shows one **real, in-stock shelf name at a
 * time**, in the customer's own language, and rotates it. Every word shown is a
 * name the customer can type back and find, because the list is built from the
 * same rows the shelf is drawn from — no made-up examples.
 *
 * Two deliberate limits:
 *
 *   * the rotation stops while the field is focused. Text that changes under a
 *     thumb while somebody is deciding what to type is a nuisance, not a hint;
 *   * `accessibilityLabel` stays the plain "Search" label while the placeholder
 *     rotates, so a screen reader is not read a new label every four seconds.
 *
 * The placeholder is a plain swap, not a fade: a `TextInput`'s placeholder
 * cannot be animated without overlaying our own text over the input, which would
 * put a fake element over the tap target. The swap is quiet and the field never
 * moves, so nothing is lost.
 */
export function HomeSearch({
  value,
  onChangeText,
  words,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** Real, short product names in the customer's language. May be empty. */
  words: string[];
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);

  const [index, setIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);

  // Rotate only when the example is the only thing on screen: not while there
  // is text (the placeholder is hidden anyway) and not while focused.
  const canCycle = words.length > 1 && value.length === 0 && !isFocused;

  useEffect(() => {
    if (!canCycle) return;

    const timer = setInterval(() => setIndex((current) => current + 1), CYCLE_MS);
    return () => clearInterval(timer);
  }, [canCycle]);

  const word = words.length > 0 ? words[index % words.length] : null;
  const placeholder = word
    ? t('home.searchPlaceholderItem', { name: word })
    : t('home.searchPlaceholder');

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <Ionicons name="search" size={20} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        style={[styles.input, kannadaInputFont(language), { color: theme.text }]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        // Deliberately static: see the note above.
        accessibilityLabel={t('home.searchPlaceholder')}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t('home.clearSearch')}
          hitSlop={10}>
          <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
});
