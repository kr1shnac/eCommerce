import { StyleSheet, Text, type TextProps } from 'react-native';

import { Type, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
 * Every piece of text in the app. Colour comes from the theme (never a hex), and
 * size comes from the `Type` scale so Kannada's taller line heights are applied
 * everywhere at once. See `constants/theme.ts`.
 */
export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

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
        type === 'subtitle' && styles.subtitle,
        type === 'caption' && styles.caption,
        type === 'price' && styles.price,
        type === 'priceLarge' && styles.priceLarge,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: { ...Type.body },
  display: { ...Type.display },
  title: { ...Type.title },
  heading: { ...Type.heading },
  subtitle: {
    ...Type.body,
  },
  bodyStrong: { ...Type.bodyStrong },
  small: { ...Type.small },
  smallBold: { ...Type.smallStrong },
  caption: { ...Type.caption },
  price: { ...Type.price },
  priceLarge: { ...Type.priceLarge },
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
