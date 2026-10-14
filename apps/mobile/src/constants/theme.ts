/**
 * The look of the app: colour, type, spacing, corners, shadow.
 *
 * WHO THIS IS FOR
 * ---------------
 * Kunigal — one taluk town in Tumakuru district. Read `KUNIGAL.md` and
 * `DESIGN.md` for the reasoning; this file is where that reasoning becomes
 * numbers. The short version, because it decides every value below:
 *
 *  - Roughly **one in three adults cannot comfortably read a sentence**, so
 *    colour and icons carry meaning, not decoration. Big type, generous line
 *    height (Kannada needs more than Latin), and a 44 px floor on every tap.
 *  - The town's own colours are **green** (ragi, coconut, silk, the fields) and
 *    **marigold** (the flower on every shop board and temple). So the brand is a
 *    deep leaf green with a warm marigold second. **Deliberately not blue** — in
 *    India blue reads as a bank, a government form, or a courier; it is cold.
 *  - **Not pure black, not stark white.** Backgrounds are a warm paper cream in
 *    light mode and a warm charcoal in dark mode. Pure white glares under the
 *    midday sun this town has, and a warm off-white is easier on older eyes.
 *
 * RULE: every token exists in BOTH `light` and `dark`, or `ThemeColor` breaks
 * (it is the intersection of the two key sets). Money is never a colour and
 * never a float — see `src/lib/money.ts`.
 */

import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const Colors = {
  light: {
    // --- Brand: leaf green ---------------------------------------------------
    /** The one colour for "you can act here": buttons, active tab, links. */
    accent: '#0F7B3E',
    /** Pressed state of the brand colour. */
    accentPressed: '#0B5F30',
    /** A pale wash of the brand, for banners and selected rows. */
    accentSoft: '#E4F4E9',
    /** A hairline in the brand family, for outlined selected cards. */
    accentBorder: '#BFE3CC',
    /** Text/icon drawn ON a solid brand fill. */
    onAccent: '#FFFFFF',

    // --- Second: marigold ----------------------------------------------------
    /** Warm highlight: offers, discounts, "today". Never the only signal. */
    secondary: '#E8890C',
    secondarySoft: '#FDEFD9',
    /** Darker marigold for text on `secondarySoft` (bright fill fails 4.5:1). */
    secondaryInk: '#9A5A00',
    onSecondary: '#3A2405',

    // --- Surfaces ------------------------------------------------------------
    /** The warm paper the whole app sits on. */
    background: '#FFFBF3',
    /** A raised surface (card) on top of `background`. */
    card: '#FFFFFF',
    /** Inset fills: search field, image tiles, chips. */
    backgroundElement: '#F5EEE1',
    /** A selected inset (e.g. the chosen chip's quiet state). */
    backgroundSelected: '#EAE0CC',
    /** Hairlines and dividers. */
    border: '#EBE0CB',

    // --- Text ----------------------------------------------------------------
    /** Main ink. Warm near-black, not #000. */
    text: '#221B12',
    /** Support text: units, timestamps, hints. */
    textSecondary: '#6E6455',
    /** The quietest tier: placeholders, disabled labels. */
    textTertiary: '#9A8F7C',

    // --- Status --------------------------------------------------------------
    // `*` is the solid fill (badge/dot). `*Ink` is the DARKER variant used for
    // text/icon drawn ON the `*Soft` wash: the bright fill colour fails 4.5:1 on
    // its own pale background (marigold on marigold-soft is only 2.3:1), so the
    // ink is a separate, verified token rather than a guess.
    success: '#1E8A4C',
    successSoft: '#E1F3E7',
    successInk: '#0F6B3A',
    warning: '#B26A05',
    warningSoft: '#FCEFD6',
    warningInk: '#8A5200',
    danger: '#C0392B',
    dangerSoft: '#FBE7E3',
    dangerInk: '#9E2B20',
    star: '#EAB308',

    // --- Effects -------------------------------------------------------------
    /** Dim behind a sheet or image. */
    overlay: 'rgba(24,18,10,0.45)',
    /** Shadow ink (components pair this with `Elevation`). */
    shadow: '#8A7355',
    /** Shimmer base for loading skeletons. */
    skeleton: '#EFE6D6',
  },

  dark: {
    accent: '#4ED08A',
    accentPressed: '#3AB673',
    accentSoft: '#12291D',
    accentBorder: '#1E4430',
    /** Text on `secondarySoft`; the bright tone already clears 4.5:1 there. */
    secondaryInk: '#F4B24A',
    onAccent: '#06210F',

    secondary: '#F4B24A',
    secondarySoft: '#2E2412',
    onSecondary: '#2A1B03',

    // Warm charcoal, never #000: a black screen next to a lamp is harsh.
    background: '#14110C',
    card: '#1E1A13',
    backgroundElement: '#26211A',
    backgroundSelected: '#332C21',
    border: '#302A20',

    text: '#F6F0E4',
    textSecondary: '#B7AC99',
    textTertiary: '#8C8271',

    success: '#4ED08A',
    successSoft: '#12291D',
    successInk: '#4ED08A',
    warning: '#F0B657',
    warningSoft: '#2E2412',
    warningInk: '#F0B657',
    danger: '#FF6B5E',
    dangerSoft: '#33201D',
    dangerInk: '#FF8A7E',
    star: '#F5C542',

    overlay: 'rgba(0,0,0,0.6)',
    shadow: '#000000',
    skeleton: '#2B251C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
/**
 * The union of both palettes. A union (not just the light one) is what lets
 * `useTheme()` hand back whichever scheme is active without a cast, while
 * `ThemeColor`'s intersection guarantees every token exists in both.
 */
export type Theme = (typeof Colors)[keyof typeof Colors];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * 4-point spacing scale. Screens compose these; nothing uses a magic number.
 * `three` (16) is the standard screen gutter.
 */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Type scale. Kannada has taller glyphs than Latin, so line heights run ~1.5×.
 * Nothing here is below 12.5 px: KUNIGAL.md forbids shrinking text to fit.
 */
export const Type = {
  display: { fontSize: 30, lineHeight: 40, fontWeight: '800' },
  title: { fontSize: 24, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 19, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
  smallStrong: { fontSize: 14, lineHeight: 22, fontWeight: '700' },
  caption: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  price: { fontSize: 17, lineHeight: 24, fontWeight: '800' },
  priceLarge: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
} as const satisfies Record<string, TextStyle>;

/** Corner radii. Cards are `lg`, sheets are `xl`, chips/buttons are `pill`. */
export const Radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Shadow presets. Pair with `theme.shadow`:
 *   style={[Elevation.card, { shadowColor: theme.shadow }]}
 * Android only respects `elevation`; iOS only the shadow* props.
 */
export const Elevation = {
  /** Barely-there, for a large list of cards. */
  card: {
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  /** For something that floats above the page (a footer, a big feature). */
  floating: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
} as const satisfies Record<string, ViewStyle>;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
