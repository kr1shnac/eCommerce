import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useSetProductGst } from '@/hooks/use-product-shelf';
import { useTheme } from '@/hooks/use-theme';
import { gstPercentLabel } from '@/lib/invoice-html';
import { localizedName } from '@/lib/localized';
import type { GstRateBp, Product } from '@/types/database';

/**
 * The GST rate and HSN on one shelf row.
 *
 * WHY THE OWNER SETS THIS AND NOT THE APP
 *
 * A GST rate is a legal classification of the goods, not a price. Rice is 5%,
 * soap is 18%, and which one applies is the shop's accountant's call — inventing
 * a rate in code would put a wrong number on a tax invoice. So every product
 * starts at 0 ("not classified yet", printed as 0% rather than a guess) and the
 * owner moves it, once, when the accountant tells them what it is.
 *
 * WHY THE RATE IS CHIPS AND NOT A TEXT BOX
 *
 * The GST council sets five slabs and India has not invented a sixth. A free
 * text box would let a typo say 1800% (or 0.18%, or 18 rupees), and the invoice
 * would print it. Five chips make the wrong answer unreachable.
 *
 * The write goes through `set_product_gst()`, never a plain update: a non-admin's
 * direct update matches zero rows and raises nothing (rule 9.4). The HSN is
 * validated in the database too — 4 to 8 digits, or empty — because the app is
 * not the authority on a statutory code.
 */
export function GstField({ product, busy }: { product: Product; busy: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [open, setOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const save = useSetProductGst();

  const name = localizedName(product);
  const rateLabel = gstPercentLabel(product.gst_rate_bp);

  return (
    <View style={[styles.fieldRow, { borderTopColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {t('admin.gstTitle')}
      </ThemedText>

      {!open ? (
        <Pressable
          onPress={() => {
            setErrorKey(null);
            setOpen(true);
          }}
          disabled={busy || save.isPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || save.isPending }}
          accessibilityLabel={t('admin.gstEdit')}
          style={({ pressed }) => [styles.readRow, pressed && styles.pressed]}>
          <ThemedText type="price">{rateLabel}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {product.hsn_code
              ? `HSN ${product.hsn_code}`
              : t('admin.gstNotSet')}
          </ThemedText>
          <Ionicons name="pencil-outline" size={16} color={theme.textSecondary} />
        </Pressable>
      ) : (
        /*
         * Mounted only while open and keyed on the stored values, exactly like
         * `PackField`: the draft is seeded from the truth once, so no effect has
         * to keep it in sync and a refetch after a save cannot fight the owner's
         * typing.
         */
        <GstEditor
          key={`${product.gst_rate_bp}:${product.hsn_code ?? ''}`}
          product={product}
          busy={busy || save.isPending}
          errorKey={errorKey}
          onCancel={() => setOpen(false)}
          onSave={async (rateBp, hsnCode) => {
            setErrorKey(null);
            try {
              await save.mutateAsync({ productId: product.id, rateBp, hsnCode });
              setOpen(false);
            } catch (error) {
              // The refusal is for the console; the owner gets a sentence. A bad
              // HSN lands here too, which is the point of checking twice.
              console.warn('[shelf] could not save the GST rate', error);
              setErrorKey('admin.gstError');
            }
          }}
          name={name}
        />
      )}
    </View>
  );
}

/** The five slabs the GST council sets, in basis points. */
const RATES: GstRateBp[] = [0, 500, 1200, 1800, 2800];

function GstEditor({
  product,
  busy,
  errorKey,
  name,
  onCancel,
  onSave,
}: {
  product: Product;
  busy: boolean;
  errorKey: string | null;
  name: string;
  onCancel: () => void;
  onSave: (rateBp: GstRateBp, hsnCode: string | null) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [rate, setRate] = useState<GstRateBp>(product.gst_rate_bp as GstRateBp);
  const [hsn, setHsn] = useState(product.hsn_code ?? '');

  const trimmedHsn = hsn.trim();
  const hsnIsValid = trimmedHsn === '' || /^[0-9]{4,8}$/.test(trimmedHsn);

  return (
    <View style={styles.editor}>
      <View style={styles.rates}>
        {RATES.map((option) => {
          const active = rate === option;
          return (
            <Pressable
              key={option}
              onPress={() => setRate(option)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: busy }}
              accessibilityLabel={t('admin.gstRateOption', { rate: gstPercentLabel(option) })}
              style={({ pressed }) => [
                styles.rateChip,
                {
                  borderColor: active ? theme.accentBorder : theme.border,
                  backgroundColor: active ? theme.accentSoft : theme.backgroundElement,
                },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? theme.accent : theme.textSecondary }}>
                {gstPercentLabel(option)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={hsn}
        onChangeText={(text) => setHsn(text.replace(/[^0-9]/g, '').slice(0, 8))}
        keyboardType="number-pad"
        editable={!busy}
        placeholder={t('admin.gstHsn')}
        placeholderTextColor={theme.textTertiary}
        style={[
          styles.hsnInput,
          {
            color: theme.text,
            borderColor: hsnIsValid ? theme.border : theme.danger,
            backgroundColor: theme.backgroundElement,
          },
        ]}
        accessibilityLabel={t('admin.gstHsnLabel', { name })}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        {t('admin.gstHsnHint')}
      </ThemedText>

      {!hsnIsValid ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t('admin.gstHsnError')}
        </ThemedText>
      ) : null}

      {errorKey ? (
        <ThemedText type="caption" style={{ color: theme.dangerInk }}>
          {t(errorKey)}
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
          onPress={() => onSave(rate, trimmedHsn === '' ? null : trimmedHsn)}
          disabled={busy || !hsnIsValid}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !hsnIsValid, busy }}
          style={({ pressed }) => [
            styles.saveChip,
            { backgroundColor: hsnIsValid ? theme.accent : theme.border },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
            {busy ? t('common.pleaseWait') : t('common.save')}
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
  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    flexShrink: 1,
  },
  editor: { flex: 1, gap: Spacing.two },
  rates: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  rateChip: {
    minWidth: 52,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  hsnInput: {
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    fontSize: 16,
    letterSpacing: 1,
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
