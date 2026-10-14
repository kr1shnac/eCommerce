import type { TextStyle } from 'react-native';

import type { Language } from '@/i18n';

/**
 * Noto Sans Kannada, bundled with the app (`assets/fonts`, loaded by
 * `useFonts` in `app/_layout.tsx`).
 *
 * WHY IT IS BUNDLED
 * Android and iOS each ship a *different* Kannada face, so the same screen is
 * shaped differently from one phone to the next — and Kannada glyphs are tall,
 * which is what the `Type` scale's line heights were cut for. Shipping one face
 * makes Kannada look the same everywhere, which is the language the shop
 * actually speaks (see `KUNIGAL.md`).
 *
 * Only Kannada switches to this font. Latin stays on the system face so English
 * keeps the platform's own typography.
 *
 * The four files are exactly the weights `Type` uses (400/600/700/800); `OFL.txt`
 * beside them is the SIL Open Font License they came under.
 */
export const KannadaFonts = {
  regular: 'NotoSansKannada-Regular',
  semiBold: 'NotoSansKannada-SemiBold',
  bold: 'NotoSansKannada-Bold',
  extraBold: 'NotoSansKannada-ExtraBold',
} as const;

/**
 * The Noto Sans Kannada face for a CSS-ish font weight.
 *
 * Each weight is a separate file, so the caller must NOT also set `fontWeight`:
 * handing a weight to a single face makes Android fake-bold it and iOS pick a
 * different face, which is worse than not bundling at all. Screens select the
 * weight by choosing the right `ThemedText type` instead.
 */
export function kannadaFontForWeight(weight: TextStyle['fontWeight'] | undefined): string {
  switch (String(weight ?? '400')) {
    case '600':
      return KannadaFonts.semiBold;
    case '700':
    case 'bold':
      return KannadaFonts.bold;
    case '800':
    case '900':
      return KannadaFonts.extraBold;
    default:
      return KannadaFonts.regular;
  }
}

/**
 * Font override for a `TextInput`. Inputs are not `ThemedText`, so they need the
 * family explicitly; this keeps a Kannada placeholder and the Kannada the
 * customer types in the same face as the label above it.
 */
export function kannadaInputFont(language: Language): TextStyle {
  return language === 'kn' ? { fontFamily: KannadaFonts.regular } : {};
}
