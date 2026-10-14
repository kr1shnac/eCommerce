import { currentLanguage } from '@/store/language-store';
import type { Language } from '@/i18n';

/**
 * DB rows carry both languages. UI must never hard-code name_en — always go
 * through this helper so the whole app follows the language switch.
 */
type LocalizedNameRow = { name_en: string; name_kn: string | null };

export function localizedName(
  row: LocalizedNameRow,
  language: Language = currentLanguage(),
): string {
  if (language === 'kn' && row.name_kn) return row.name_kn;
  return row.name_en;
}
/**
 * Order lines snapshot the product name as `product_name_en` / `product_name_kn`,
 * not `name_en` / `name_kn`, because the row belongs to a past order rather than
 * to the catalogue. Same language rule, different column names.
 */
type LocalizedItemRow = { product_name_en: string; product_name_kn: string | null };

export function localizedItemName(
  row: LocalizedItemRow,
  language: Language = currentLanguage(),
): string {
  if (language === 'kn' && row.product_name_kn) return row.product_name_kn;
  return row.product_name_en;
}

/**
 * A coupon's marketing line is stored as `description_en` / `description_kn`.
 * Same language rule again, so it gets its own small helper rather than every
 * caller reaching for a column name.
 */
type LocalizedDescriptionRow = { description_en: string | null; description_kn: string | null };

export function localizedDescription(
  row: LocalizedDescriptionRow,
  language: Language = currentLanguage(),
): string {
  if (language === 'kn' && row.description_kn) return row.description_kn;
  return row.description_en ?? '';
}
