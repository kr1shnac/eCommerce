import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useCategories } from '@/hooks/use-catalog';
import { useCreateProduct, type NewProduct } from '@/hooks/use-product-shelf';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import type { PackUnit, ProductSoldBy } from '@/types/database';
import { useLanguageStore } from '@/store/language-store';

/**
 * "Add a product", from the owner's phone (register M6).
 *
 * WHY THIS SCREEN EXISTS AT ALL. Every customer-visible string in this app has a
 * Kannada twin — the database columns (`name_en` / `name_kn`), the interface
 * (`en.json` / `kn.json`). The i18n system was built for **reading**, and nothing
 * had ever asked how the owner *types* a new product's Kannada name. Until now the
 * answer was: open the web panel, or run SQL. Both mean leaving the counter, and a
 * grocery shelf changes faster than a desk habit.
 *
 * WHAT IT ASKS FOR, AND WHY THAT ORDER. The Kannada name is asked for FIRST and is
 * REQUIRED. About 31% of the town has low literacy (KUNIGAL.md §3), and the
 * Kannada name is the one the customer actually reads — so it is not an optional
 * translation bolted on the end, it is the name. `create_product_from_shop()`
 * refuses a blank Kannada name and refuses the English name copied across, and
 * this screen mirrors both so the refusal is shown before the request, not after.
 *
 * WHY THE OWNER TYPES PAISE. They do not — they type rupees, and this screen does
 * the single conversion to integer paise (§9.1 / Rule 1). Nothing downstream ever
 * sees a decimal rupee.
 *
 * WHY THE PACK IS ASKED FOR SEPARATELY. Selling rice by the kilo and soap by the
 * piece are different kinds of thing, and the app must know which to offer "also in
 * 1 kg". So the owner says "counted" or "weighed", and if weighed, how big one pack
 * is. The customer-facing text ("1 kg") is DERIVED on the server from that, so it
 * can never disagree with the pack the app compares sizes on.
 *
 * The keyboard: Kannada is typed with the phone's own keyboard. Nothing here
 * transliterates — a guesser that turned English letters into Kannada letters would
 * produce words no Kunigal customer recognises, which is worse than asking the
 * owner to type it (the M6 decision recorded in PRODUCTION.md §10).
 */
export function AddProductPanel({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);
  const categories = useCategories();
  const createProduct = useCreateProduct();

  const [nameKn, setNameKn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [rupees, setRupees] = useState('');
  const [mrpRupees, setMrpRupees] = useState('');
  const [stock, setStock] = useState('10');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [soldBy, setSoldBy] = useState<ProductSoldBy>('piece');
  const [packSize, setPackSize] = useState('');
  const [packUnit, setPackUnit] = useState<PackUnit>('g');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const canna = kannadaInputFont(language);

  /** Rupees as typed -> integer paise. One conversion, here, and never again. */
  const toPaise = (text: string): number | null => {
    const cleaned = text.trim().replace(/[₹,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    return Math.round(Number(cleaned) * 100);
  };

  const pricePaise = toPaise(rupees);
  const mrpPaise = mrpRupees.trim() === '' ? null : toPaise(mrpRupees);
  const stockQty = /^\d+$/.test(stock.trim()) ? Number(stock.trim()) : null;
  const parsedPack = (() => {
    const cleaned = packSize.trim();
    if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    return value > 0 ? value : null;
  })();

  /**
   * Mirrors the RPC's rules so the owner is told before the request. The database
   * still refuses anything this misses — this is a courtesy, never the guard.
   */
  const validate = (): string | null => {
    if (nameKn.trim() === '') return 'admin.addNeedKannada';
    // The same script check the server does, in the same spirit: it looks for a
    // Kannada character, so "Basmati Rice" typed into the Kannada box is caught.
    if (!/[\u0C80-\u0CFF]/.test(nameKn)) return 'admin.addKannadaNotKannada';
    if (nameEn.trim() === '') return 'admin.addNeedEnglish';
    if (pricePaise === null) return 'admin.addNeedPrice';
    if (mrpRupees.trim() !== '' && mrpPaise === null) return 'admin.addNeedPrice';
    if (mrpPaise !== null && pricePaise > mrpPaise) return 'admin.addPriceAboveMrp';
    if (stockQty === null) return 'admin.addNeedStock';
    if (soldBy === 'measure' && parsedPack === null) return 'admin.addNeedPack';
    return null;
  };

  const save = async () => {
    setErrorKey(null);
    setSavedId(null);
    const problem = validate();
    if (problem !== null) {
      setErrorKey(problem);
      return;
    }

    const input: NewProduct = {
      nameEn: nameEn.trim(),
      nameKn: nameKn.trim(),
      pricePaise: pricePaise as number,
      categoryId,
      soldBy,
      packSize: soldBy === 'piece' ? null : parsedPack,
      packUnit: soldBy === 'piece' ? null : packUnit,
      // 0 is the "no printed MRP" convention the RPC understands.
      mrpPaise: mrpPaise === null ? null : mrpPaise,
      stockQty: stockQty as number,
      emoji: null,
    };

    try {
      const created = await createProduct.mutateAsync(input);
      setSavedId(created.name_en);
      // Clear the form for the next product, but leave the category and the
      // counted/weighed choice: a shop restocks an aisle, not one item.
      setNameKn('');
      setNameEn('');
      setRupees('');
      setMrpRupees('');
      setPackSize('');
      setStock('10');
    } catch (error) {
      // Technical text goes to the console only (§9.2).
      console.warn('[add-product] could not add the product', error);
      setErrorKey('admin.addSaveError');
    }
  };

  const busy = createProduct.isPending;

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="add-circle-outline" size={20} color={theme.accent} />
        <ThemedText type="subtitle">{t('admin.addTitle')}</ThemedText>
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        {t('admin.addHint')}
      </ThemedText>

      {/* Kannada first: it is the name the customer reads. */}
      <Field label={t('admin.addNameKn')} hint={t('admin.addNameKnHint')}>
        <TextInput
          value={nameKn}
          onChangeText={setNameKn}
          placeholder={t('admin.addNameKnPlaceholder')}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, canna, themedInput(theme)]}
          accessibilityLabel={t('admin.addNameKn')}
        />
      </Field>

      <Field label={t('admin.addNameEn')}>
        <TextInput
          value={nameEn}
          onChangeText={setNameEn}
          placeholder={t('admin.addNameEnPlaceholder')}
          placeholderTextColor={theme.textTertiary}
          autoCapitalize="words"
          style={[styles.input, themedInput(theme)]}
          accessibilityLabel={t('admin.addNameEn')}
        />
      </Field>

      <View style={styles.pairRow}>
        <Field label={t('admin.addPrice')} style={styles.flex}>
          <TextInput
            value={rupees}
            onChangeText={setRupees}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, themedInput(theme)]}
            accessibilityLabel={t('admin.addPrice')}
          />
        </Field>
        <Field label={t('admin.addMrp')} style={styles.flex}>
          <TextInput
            value={mrpRupees}
            onChangeText={setMrpRupees}
            keyboardType="decimal-pad"
            placeholder={t('admin.addMrpOptional')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, themedInput(theme)]}
            accessibilityLabel={t('admin.addMrp')}
          />
        </Field>
      </View>

      <Field label={t('admin.addStock')}>
        <TextInput
          value={stock}
          onChangeText={setStock}
          keyboardType="number-pad"
          placeholder="10"
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, themedInput(theme)]}
          accessibilityLabel={t('admin.addStock')}
        />
      </Field>

      {/* Category. Optional, because a product can sit on the shelf without an
          aisle, and forcing a choice before the product exists is worse. */}
      <Field label={t('admin.addCategory')} hint={t('admin.addCategoryHint')}>
        <View style={styles.chips}>
          {(categories.data ?? []).map((category) => {
            const active = categoryId === category.id;
            return (
              <Pressable
                key={category.id}
                onPress={() => setCategoryId(active ? null : category.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? theme.accentBorder : theme.border,
                    backgroundColor: active ? theme.accentSoft : theme.backgroundElement,
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: active ? theme.accent : theme.textSecondary }}>
                  {localizedName(category)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Field>

      {/* Counted or weighed — the question that decides whether a pack is asked
          for at all. */}
      <Field label={t('admin.addHowSold')}>
        <View style={styles.chips}>
          {(['piece', 'measure'] as const).map((option) => {
            const active = soldBy === option;
            return (
              <Pressable
                key={option}
                onPress={() => setSoldBy(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? theme.accentBorder : theme.border,
                    backgroundColor: active ? theme.accentSoft : theme.backgroundElement,
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: active ? theme.accent : theme.textSecondary }}>
                  {option === 'piece' ? t('admin.shelfPackPiece') : t('admin.shelfPackMeasure')}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Field>

      {soldBy === 'measure' ? (
        <Field label={t('admin.addPack')} hint={t('admin.addPackHint')}>
          <View style={styles.packRow}>
            <TextInput
              value={packSize}
              onChangeText={setPackSize}
              keyboardType="decimal-pad"
              placeholder="500"
              placeholderTextColor={theme.textTertiary}
              style={[styles.sizeInput, themedInput(theme)]}
              accessibilityLabel={t('admin.addPack')}
            />
            <View style={styles.chips}>
              {(['g', 'kg', 'ml', 'l'] as const).map((option) => {
                const active = packUnit === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setPackUnit(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.unitChip,
                      {
                        borderColor: active ? theme.accentBorder : theme.border,
                        backgroundColor: active ? theme.accentSoft : theme.backgroundElement,
                      },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: active ? theme.accent : theme.textSecondary }}>
                      {option}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Field>
      ) : null}

      {errorKey ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.dangerInk }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {savedId ? (
        <View style={styles.errorRow}>
          <Ionicons name="checkmark-circle" size={16} color={theme.successInk} />
          <ThemedText type="small" style={{ color: theme.successInk }}>
            {t('admin.addSaved', { name: savedId })}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('admin.addSave')}
          icon="checkmark"
          // `busy` blocks taps and shows a spinner, so a double tap cannot create
          // two products (§9.4).
          busy={busy}
          onPress={() => void save()}
        />
        <Pressable
          onPress={onDone}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.doneChip,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('admin.addDone')}
          </ThemedText>
        </Pressable>
      </View>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View style={[styles.field, style]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/** The shared input chrome. Every input is 44 px tall (§9.9). */
function themedInput(theme: ReturnType<typeof useTheme>) {
  return {
    color: theme.text,
    borderColor: theme.border,
    backgroundColor: theme.backgroundElement,
  };
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  field: { gap: Spacing.one },
  flex: { flex: 1 },
  pairRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    fontSize: 16,
  },
  sizeInput: {
    minWidth: 88,
    minHeight: 44,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    fontSize: 16,
  },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  unitChip: {
    minWidth: 44,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  doneChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  pressed: { opacity: 0.75 },
});
