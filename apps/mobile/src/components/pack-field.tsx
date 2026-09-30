import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { packLabel, trimNumber } from '@/lib/pack';
import type { PackUnit, Product, ProductSoldBy } from '@/types/database';

/**
 * What one pack of this product IS (register M4).
 *
 * WHY THIS IS A TWO-STEP EDIT, NOT A TEXT BOX. The owner types the price all day;
 * the pack is typed **once**, when the product is first entered on the shelf.
 * Worse, the pack is *identity*: the product guard freezes `sold_by`, `pack_size`
 * and `pack_unit` so that no ordinary save can change what a pack is. If changing
 * "1 kg" to "5 kg" were one stray tap away, the customer would be charged the 1 kg
 * price for a 5 kg bag and nothing in the flow would look wrong. So the field
 * shows the truth read-only, and changing it takes a deliberate "Change", then a
 * "Save" — a shape no slip of the thumb can produce.
 *
 * WHY IT SAYS WHAT IT SAYS. The row prints the pack in the shop's own words
 * ("500 g"), and when the shop has not described a pack structurally it falls back
 * to the free-text `unit` ("1 piece") so nothing on the shelf looks changed by
 * this feature. Where the two disagree, the structured pack is the truth — that is
 * what the customer's screen and the "also in 1 kg" chips read.
 *
 * The units offered are the closed list from the database enum, because g/kg/ml/l
 * are the only things that can be compared on a shared scale. A unit the database
 * does not know would make "which is bigger" unanswerable, which is the whole
 * point of the field.
 */
export type PackValue = { soldBy: ProductSoldBy; size: number | null; unit: PackUnit | null };

/** The units a shop actually writes on a shelf, in the order they are shown. */
const UNITS: PackUnit[] = ['g', 'kg', 'ml', 'l', 'piece'];

export function PackField({
  product,
  busy,
  onSave,
}: {
  product: Product;
  busy: boolean;
  onSave: (pack: PackValue) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [open, setOpen] = useState(false);
  const name = localizedName(product);

  return (
    <View style={[styles.fieldRow, { borderTopColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {t('admin.shelfPack')}
      </ThemedText>

      {!open ? (
        <Pressable
          onPress={() => setOpen(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={t('admin.shelfPackEditLabel', { name, size: packLabel(product) })}
          style={({ pressed }) => [styles.readRow, pressed && styles.pressed]}>
          <ThemedText type="price">{packLabel(product)}</ThemedText>
          <Ionicons name="pencil-outline" size={16} color={theme.textSecondary} />
        </Pressable>
      ) : (
        /*
         * The editor is its own component, MOUNTED only while open and keyed on the
         * stored pack. That is deliberate: a draft that is initialised from props
         * must not be kept in sync with them by an effect, or a refetch after a
         * save would fight whatever the owner is typing. Mounting fresh on each
         * open (and remounting if the stored value changes underneath) means the
         * draft is always seeded from the truth, once, with no syncing at all.
         */
        <PackEditor
          key={`${product.sold_by}:${product.pack_size}:${product.pack_unit}`}
          product={product}
          busy={busy}
          onCancel={() => setOpen(false)}
          onSave={(pack) => {
            setOpen(false);
            onSave(pack);
          }}
        />
      )}
    </View>
  );
}

/** The open editor. See the note above for why it owns its own draft state. */
function PackEditor({
  product,
  busy,
  onCancel,
  onSave,
}: {
  product: Product;
  busy: boolean;
  onCancel: () => void;
  onSave: (pack: PackValue) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  // Seeded ONCE from the stored row. No effect, no props-to-state sync.
  const [soldBy, setSoldBy] = useState<ProductSoldBy>(product.sold_by);
  const [size, setSize] = useState(
    product.pack_size === null ? '' : trimNumber(product.pack_size),
  );
  const [unit, setUnit] = useState<PackUnit>(product.pack_unit ?? 'g');

  const parsedSize = (() => {
    const cleaned = size.trim();
    if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
    const value = Number(cleaned);
    return value > 0 ? value : null;
  })();

  // A measure product needs a real size; a piece product needs none. This mirrors
  // the `products_pack_fields_agree` CHECK, so the button is disabled rather than
  // the request being refused — and the database still refuses it if the app is
  // ever wrong.
  const valid = soldBy === 'piece' ? true : parsedSize !== null;

  const save = () => {
    if (!valid) return;
    onSave({
      soldBy,
      size: soldBy === 'piece' ? null : parsedSize,
      unit: soldBy === 'piece' ? null : unit,
    });
  };

  const name = localizedName(product);

  return (
    <View style={styles.editor}>
      {/* Piece vs measure first, because it decides whether a size is even asked
          for: soap is counted, rice is weighed. */}
      <View style={styles.segmented}>
        {(['piece', 'measure'] as const).map((option) => {
          const active = soldBy === option;
          return (
            <Pressable
              key={option}
              onPress={() => setSoldBy(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.segment,
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

      {soldBy === 'measure' ? (
        <View style={styles.sizeRow}>
          <TextInput
            value={size}
            onChangeText={setSize}
            keyboardType="decimal-pad"
            placeholder="500"
            placeholderTextColor={theme.textTertiary}
            style={[
              styles.sizeInput,
              {
                color: theme.text,
                borderColor: theme.accentBorder,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            accessibilityLabel={t('admin.shelfPackSizeLabel', { name })}
          />
          <View style={styles.segmented}>
            {UNITS.map((option) => {
              const active = unit === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setUnit(option)}
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
      ) : null}

      {!valid ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t('admin.shelfPackNeedSize')}
        </ThemedText>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cancelChip,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('common.cancel')}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={save}
          disabled={busy || !valid}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !valid }}
          style={({ pressed }) => [
            styles.saveChip,
            { backgroundColor: valid ? theme.accent : theme.border },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
            {t('common.save')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    marginTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { flexShrink: 0 },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  editor: { flex: 1, gap: Spacing.two },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  segment: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sizeInput: {
    minWidth: 84,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    fontSize: 16,
    textAlign: 'center',
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
  actions: { flexDirection: 'row', gap: Spacing.two },
  cancelChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  saveChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
  },
  pressed: { opacity: 0.75 },
});
