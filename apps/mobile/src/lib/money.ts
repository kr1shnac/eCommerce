/**
 * MONEY RULES (project-wide, see /AGENTS.md)
 *
 * Every amount in this app is stored and passed around as an INTEGER number of
 * PAISE (1 rupee = 100 paise). Never store a float, never do arithmetic on rupees.
 *
 * These helpers are the ONLY place where paise is allowed to become a string.
 */

const RUPEE_SIGN = '\u20B9';

/** 1234567 -> "12,34,567" (Indian digit grouping: last 3, then pairs). */
function groupIndianDigits(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Turn paise into a rupee string for display.
 * formatPaise(4999) === "₹49.99"
 * formatPaise(25000) === "₹250.00"
 */
export function formatPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return `${RUPEE_SIGN}0.00`;
  const rounded = Math.round(paise);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const decimals = String(remainder).padStart(2, '0');
  return `${sign}${RUPEE_SIGN}${groupIndianDigits(String(rupees))}.${decimals}`;
}

/** Whole rupees only, for places where paise are noise (e.g. delivery fee "₹25"). */
export function formatPaiseShort(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) return `${RUPEE_SIGN}0`;
  const rupees = Math.round(paise / 100);
  const sign = rupees < 0 ? '-' : '';
  return `${sign}${RUPEE_SIGN}${groupIndianDigits(String(Math.abs(rupees)))}`;
}

/** Discount percent, rounded down, or null when there is no real discount. */
export function discountPercent(pricePaise: number, mrpPaise: number | null): number | null {
  if (!mrpPaise || mrpPaise <= pricePaise || mrpPaise <= 0) return null;
  return Math.floor(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

/**
 * A rupee amount written as something a Kannada voice can READ ALOUD (register H4).
 *
 * This is a display helper like the others, not a second source of truth: the
 * argument is still integer paise and the arithmetic is the same. It exists
 * because speech is a different problem from print.
 *
 * Why not just pass `formatPaise()` to the engine? Because that returns
 * `"₹145.00"`. The `₹` glyph and the `.00` are typography, not speech: a TTS engine
 * given them either skips the symbol (so the customer hears "one hundred forty
 * five", with no currency at all) or reads "rupee symbol one four five point zero
 * zero", which is noise. And `formatPaise` deliberately uses Western digits for
 * grouping, which the engine may then read in an English rhythm.
 *
 * So this returns **Kannada digits** with the rupee word written out:
 *   * `formatPaiseForSpeech(14500)`  -> `"೧೪೫ ರೂಪಾಯಿ"`
 *   * `formatPaiseForSpeech(14550)`  -> `"೧೪೫ ರೂಪಾಯಿ ೫೦ ಪೈಸೆ"`
 *   * `formatPaiseForSpeech(2500)`   -> `"೨೫ ರೂಪಾಯಿ"`
 *
 * The rupee word is passed in rather than hard-coded so it comes from `kn.json`
 * (`speech.rupees`) like every other customer-visible string (Rule 2); the paise
 * word likewise. Grouping commas are omitted on purpose — a comma is a pause the
 * engine may or may not honour, and a spoken price is short enough not to need it.
 */
export function formatPaiseForSpeech(
  paise: number | null | undefined,
  rupeeWord: string,
  paiseWord: string,
): string {
  if (paise === null || paise === undefined || Number.isNaN(paise)) {
    return `${toKannadaDigits('0')} ${rupeeWord}`;
  }

  const rounded = Math.round(paise);
  const absolute = Math.abs(rounded);
  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  const parts = [`${toKannadaDigits(String(rupees))} ${rupeeWord}`];
  // Say the paise only when there are any. "೧೪೫ ರೂಪಾಯಿ ೦೦ ಪೈಸೆ" is noise.
  if (remainder > 0) parts.push(`${toKannadaDigits(String(remainder))} ${paiseWord}`);

  return parts.join(' ');
}

/** ASCII digits -> Kannada digits. 145 -> "೧೪೫". */
export function toKannadaDigits(value: string): string {
  const KANNADA_ZERO = 0x0ce6; // '೦'
  return value.replace(/[0-9]/g, (digit) =>
    String.fromCharCode(KANNADA_ZERO + Number(digit)),
  );
}