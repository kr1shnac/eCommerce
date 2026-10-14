import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { kannadaFontForWeight } from '@/constants/fonts';
import { Type, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguageStore } from '@/store/language-store';

export type ThemedTextType =
  | 'default'
  | 'title'
  | 'display'
  | 'heading'
  | 'subtitle'
  | 'bodyStrong'
  | 'small'
  | 'smallBold'
  | 'caption'
  | 'price'
  | 'priceLarge'
  | 'link'
  | 'linkPrimary'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: ThemeColor;
};

/**
 * The weight each `type` paints with. Kept here (next to the styles it mirrors)
 * so the Kannada face can be chosen to match: each Noto Sans Kannada weight is a
 * separate file, so the family has to follow the type rather than a `fontWeight`.
 */
const TYPE_WEIGHT: Record<ThemedTextType, TextStyle['fontWeight']> = {
  default: '400',
  title: '700',
  display: '800',
  heading: '700',
  subtitle: '400',
  bodyStrong: '600',
  small: '400',
  smallBold: '700',
  caption: '600',
  price: '800',
  priceLarge: '800',
  link: '400',
  linkPrimary: '400',
  code: '400',
};

/**
 * Every piece of text in the app. Colour comes from the theme (never a hex), and
 * size comes from the `Type` scale so Kannada's taller line heights are applied
 * everywhere at once. See `constants/theme.ts`.
 *
 * In Kannada the bundled Noto Sans Kannada face replaces the system font, matched
 * to the `type`'s weight. Latin text keeps the system face, and `code`
 * (identifiers such as an order number) stays monospaced in both languages.
 */
export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);

  // Applied LAST so the family always matches its own weight: setting a
  // `fontWeight` on a single-face font makes Android fake-bold it.
  const kannada =
    language === 'kn' && type !== 'code'
      ? { fontFamily: kannadaFontForWeight(TYPE_WEIGHT[type]), fontWeight: 'normal' as const }
      : null;

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'display' && styles.display,
        type === 'heading' && styles.heading,
        type === 'bodyStrong' && styles.bodyStrong,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'caption' && styles.caption,
        type === 'price' && styles.price,
        type === 'priceLarge' && styles.priceLarge,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
        kannada,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {},
  title: {
    ...Type.title,
  },
  display: {
    ...Type.display,
  },
  heading: {
    ...Type.heading,
  },
  subtitle: {
    ...Type.body,
  },
  bodyStrong: {
    ...Type.bodyStrong,
  },
  small: {
    ...Type.small,
  },
  smallBold: {
    ...Type.smallStrong,
  },
  caption: {
    ...Type.caption,
  },
  price: {
    ...Type.price,
  },
  priceLarge: {
    ...Type.priceLarge,
  },
  link: {
    ...Type.body,
    textDecorationLine: 'underline',
  },
  linkPrimary: {
    ...Type.body,
  },
  code: {
    ...Type.small,
    fontFamily: 'monospace',
  },
});
