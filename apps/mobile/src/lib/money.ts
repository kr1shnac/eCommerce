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