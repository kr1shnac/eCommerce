import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import {
  COUPON_DUPLICATE_CODE,
  useCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  useSetCouponActive,
  useUpdateCoupon,
  type CouponDraft,
} from '@/hooks/use-coupons';
import { useStore } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedDescription } from '@/lib/localized';
import { formatPaiseShort } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';
import { currentLanguage, useLanguageStore } from '@/store/language-store';
import type { Coupon, CouponKind } from '@/types/database';

/**
 * The owner's offer codes.
 *
 * A code is a reason to fill a basket, so this is a counter tool, not a settings
 * page: the list states each code in plain words, and the two taps the owner
 * needs — switch it off, change it — are on the card itself.
 *
 * The app never works out a discount. `coupons` is admin-only under RLS, and the
 * customer's discount is computed by the database in `validate_coupon()` and
 * `place_order()` (rule 9.1), so what is written here and what a customer is
 * charged cannot drift apart.
 */
export default function AdminCouponsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = useLanguageStore((state) => state.language);

  const store = useStore();
  const storeId = store.data?.id ?? null;
  const coupons = useCoupons(storeId);

  const setActive = useSetCouponActive();
  const removeCoupon = useDeleteCoupon();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const list = coupons.data ?? [];
  const formOpen = creating || editing !== null;

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const onToggle = async (coupon: Coupon) => {
    if (!storeId) return;
    setErrorKey(null);
    try {
      await setActive.mutateAsync({ id: coupon.id, storeId, isActive: !coupon.is_active });
    } catch (error) {
      console.warn('[coupons] could not change active', error);
      setErrorKey('admin.couponToggleError');
    }
  };

  const confirmDelete = (coupon: Coupon) => {
    if (!storeId) return;
    Alert.alert(t('admin.couponDeleteTitle'), t('admin.couponDeleteBody', { code: coupon.code }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('admin.couponDelete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setErrorKey(null);
            try {
              await removeCoupon.mutateAsync({ id: coupon.id, storeId });
            } catch (error) {
              console.warn('[coupons] could not delete', error);
              setErrorKey('admin.couponDeleteError');
            }
          })();
        },
      },
    ]);
  };

  const renderCoupon = ({ item }: { item: Coupon }) => {
    const busy = setActive.isPending && setActive.variables?.id === item.id;
    const description = localizedDescription(item);

    const value =
      item.kind === 'percent'
        ? t('admin.couponValuePercent', { percent: item.value })
        : t('admin.couponValueFlat', { amount: formatPaiseShort(item.value) });

    const usage =
      item.usage_limit === null
        ? t('admin.couponUnlimited')
        : t('admin.couponUsed', { used: item.used_count, limit: item.usage_limit });

    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.flex}>
            <ThemedText type="smallBold" style={styles.code}>
              {item.code}
            </ThemedText>
            {description ? (
              <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
                {description}
              </ThemedText>
            ) : null}
          </View>
          <Badge
            label={item.is_active ? t('admin.couponActive') : t('admin.couponInactive')}
            tone={item.is_active ? 'success' : 'neutral'}
            icon={item.is_active ? 'checkmark-circle' : 'pause-circle'}
          />
        </View>

        <View style={styles.metaRow}>
          <Badge label={value} tone="secondary" icon="pricetag-outline" />
          {item.min_order_paise > 0 ? (
            <Badge
              label={t('admin.couponMinOrder', { amount: formatPaiseShort(item.min_order_paise) })}
              tone="neutral"
              icon="basket-outline"
            />
          ) : null}
          <Badge label={usage} tone="neutral" icon="repeat-outline" />
        </View>

        <View style={styles.actionsRow}>
          <View style={styles.switchRow}>
            <Switch
              value={item.is_active}
              onValueChange={() => void onToggle(item)}
              disabled={busy}
              trackColor={{ false: theme.border, true: theme.accentBorder }}
              thumbColor={item.is_active ? theme.accent : theme.card}
              accessibilityLabel={`${item.code}: ${t('admin.couponEnable')}`}
              accessibilityState={{ disabled: busy }}
            />
            <ThemedText type="caption" themeColor="textSecondary">
              {t('admin.couponEnable')}
            </ThemedText>
          </View>

          <View style={styles.actionsRight}>
            <Button
              label={t('admin.couponEdit')}
              icon="create-outline"
              variant="outline"
              onPress={() => setEditing(item)}
            />
            <IconButton
              icon="trash-outline"
              label={t('admin.couponDelete')}
              color={theme.danger}
              onPress={() => confirmDelete(item)}
            />
          </View>
        </View>
      </Card>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={[styles.headerRow, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.flex}>
          <ThemedText type="title">{t('admin.couponsTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('admin.couponsHint')}
          </ThemedText>
        </View>
      </View>

      {errorKey ? (
        <View style={styles.errorSlot}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {store.isLoading || coupons.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderCoupon}
          extraData={language}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl
              refreshing={coupons.isRefetching}
              onRefresh={() => void coupons.refetch()}
              tintColor={theme.accent}
            />
          }
          ListHeaderComponent={
            storeId ? (
              <Button
                label={t('admin.couponNew')}
                icon="add"
                variant="secondary"
                fullWidth
                onPress={() => setCreating(true)}
              />
            ) : null
          }
          ListEmptyComponent={
            coupons.isError || store.isError ? (
              <StateMessage
                title={t('admin.couponsError')}
                hint={t('admin.couponsErrorHint')}
                onRetry={() => {
                  if (store.isError) void store.refetch();
                  else void coupons.refetch();
                }}
                tone="danger"
              />
            ) : (
              <StateMessage
                title={t('admin.couponsEmpty')}
                hint={t('admin.couponsEmptyHint')}
                art="🏷️"
              />
            )
          }
        />
      )}

      {formOpen && storeId ? (
        <CouponForm
          key={editing?.id ?? 'new'}
          coupon={editing}
          storeId={storeId}
          onClose={closeForm}
        />
      ) : null}
    </View>
  );
}

/** Whole-number field value -> integer, or null when blank. Digits only. */
function parseWhole(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits === '' ? null : parseInt(digits, 10);
}

/** The editable form. Mounted only while open, so it starts fresh each time. */
function CouponForm({
  coupon,
  storeId,
  onClose,
}: {
  coupon: Coupon | null;
  storeId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const busy = createCoupon.isPending || updateCoupon.isPending;

  const [code, setCode] = useState(coupon?.code ?? '');
  const [kind, setKind] = useState<CouponKind>(coupon?.kind ?? 'percent');
  const [valueText, setValueText] = useState(
    coupon ? String(coupon.kind === 'percent' ? coupon.value : coupon.value / 100) : '',
  );
  const [minOrderText, setMinOrderText] = useState(
    coupon && coupon.min_order_paise > 0 ? String(coupon.min_order_paise / 100) : '',
  );
  const [maxDiscountText, setMaxDiscountText] = useState(
    coupon && coupon.max_discount_paise > 0 ? String(coupon.max_discount_paise / 100) : '',
  );
  const [usageLimitText, setUsageLimitText] = useState(
    coupon?.usage_limit ? String(coupon.usage_limit) : '',
  );
  const [descriptionEn, setDescriptionEn] = useState(coupon?.description_en ?? '');
  const [descriptionKn, setDescriptionKn] = useState(coupon?.description_kn ?? '');
  const [isActive, setIsActive] = useState(coupon?.is_active ?? true);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Work out what to save, or a translated reason it cannot be saved yet. Money
   * arrives as whole rupees (the shop's own offers are ₹50, ₹199 — never paise);
   * multiplying by 100 is the only arithmetic, and it stays in integers.
   */
  const buildDraft = (): CouponDraft | string => {
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(cleanCode)) return 'admin.couponErrorCode';

    const amount = parseWhole(valueText);
    if (amount === null) return 'admin.couponErrorValue';

    if (kind === 'percent' && (amount < 1 || amount > 100)) return 'admin.couponErrorValue';
    if (kind === 'flat' && amount < 1) return 'admin.couponErrorValue';

    const minOrder = parseWhole(minOrderText) ?? 0;
    const maxDiscount = kind === 'percent' ? (parseWhole(maxDiscountText) ?? 0) : 0;
    const usageLimit = usageLimitText.trim() === '' ? null : parseWhole(usageLimitText);

    if (usageLimit !== null && usageLimit < 1) return 'admin.couponErrorValue';

    return {
      storeId,
      code: cleanCode,
      kind,
      value: kind === 'percent' ? amount : amount * 100,
      maxDiscountPaise: maxDiscount * 100,
      minOrderPaise: minOrder * 100,
      isActive,
      usageLimit,
      descriptionEn,
      descriptionKn,
    };
  };

  const onSubmit = async () => {
    const draft = buildDraft();
    if (typeof draft === 'string') {
      setProblem(draft);
      return;
    }

    setProblem(null);
    try {
      if (coupon) await updateCoupon.mutateAsync({ id: coupon.id, ...draft });
      else await createCoupon.mutateAsync(draft);
      onClose();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      console.warn('[coupons] could not save', error);
      setProblem(
        code === COUPON_DUPLICATE_CODE ? 'admin.couponErrorDuplicate' : 'admin.couponErrorSave',
      );
    }
  };

  const field = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    options?: { placeholder?: string; keyboardType?: 'default' | 'number-pad'; hint?: string },
  ) => (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={options?.placeholder}
        placeholderTextColor={theme.textTertiary}
        keyboardType={options?.keyboardType ?? 'default'}
        editable={!busy}
        accessibilityLabel={label}
        style={[
          styles.input,
          kannadaInputFont(currentLanguage()),
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}
      />
      {options?.hint ? (
        <ThemedText type="caption" themeColor="textTertiary">
          {options.hint}
        </ThemedText>
      ) : null}
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.sheetHeader,
            { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border },
          ]}>
          <IconButton icon="close" label={t('common.cancel')} onPress={onClose} disabled={busy} />
          <ThemedText type="heading">
            {coupon ? t('admin.couponFormEdit') : t('admin.couponFormNew')}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + Spacing.five }]}
          keyboardShouldPersistTaps="handled">
          {field(t('admin.couponFieldCode'), code, (text) => setCode(text.toUpperCase()), {
            placeholder: t('admin.couponFieldCodeHint'),
          })}

          <View style={styles.field}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('admin.couponFieldKind')}
            </ThemedText>
            <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
              {(['percent', 'flat'] as const).map((option) => {
                const selected = kind === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setKind(option)}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: busy }}
                    accessibilityLabel={t(`admin.couponKind.${option}`)}
                    style={({ pressed }) => [
                      styles.segmentButton,
                      selected && { backgroundColor: theme.accent },
                      pressed && !selected && styles.pressed,
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
                      {t(`admin.couponKind.${option}`)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.twoUp}>
            <View style={styles.flex}>
              {field(
                kind === 'percent' ? t('admin.couponFieldPercent') : t('admin.couponFieldFlat'),
                valueText,
                setValueText,
                { keyboardType: 'number-pad', placeholder: '0' },
              )}
            </View>
            <View style={styles.flex}>
              {field(t('admin.couponFieldMinOrder'), minOrderText, setMinOrderText, {
                keyboardType: 'number-pad',
                placeholder: '0',
              })}
            </View>
          </View>

          {kind === 'percent'
            ? field(t('admin.couponFieldMaxDiscount'), maxDiscountText, setMaxDiscountText, {
                keyboardType: 'number-pad',
                placeholder: '0',
                hint: t('admin.couponFieldMaxDiscountHint'),
              })
            : null}

          {field(t('admin.couponFieldUsageLimit'), usageLimitText, setUsageLimitText, {
            keyboardType: 'number-pad',
            hint: t('admin.couponFieldUsageHint'),
          })}

          <View style={styles.field}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t('admin.couponEnable')}
            </ThemedText>
            <Switch
              value={isActive}
              onValueChange={setIsActive}
              disabled={busy}
              trackColor={{ false: theme.border, true: theme.accentBorder }}
              thumbColor={isActive ? theme.accent : theme.card}
              accessibilityLabel={t('admin.couponEnable')}
            />
          </View>

          {field(t('admin.couponFieldDescriptionEn'), descriptionEn, setDescriptionEn)}
          {field(t('admin.couponFieldDescriptionKn'), descriptionKn, setDescriptionKn)}

          {problem ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
              <ThemedText type="small" style={[styles.flex, { color: theme.danger }]}>
                {t(problem)}
              </ThemedText>
            </View>
          ) : null}

          <Button
            label={t('admin.couponSave')}
            icon="checkmark"
            size="lg"
            fullWidth
            busy={busy}
            disabled={busy}
            onPress={() => void onSubmit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  errorSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  card: { gap: Spacing.two },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  code: { letterSpacing: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  pressed: { opacity: 0.7 },

  // The form sheet
  sheet: { flex: 1 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  /** Balances the close button so the title sits centred. */
  headerSpacer: { width: 44, height: 44 },
  form: { padding: Spacing.three, gap: Spacing.three },
  field: { gap: Spacing.one },
  twoUp: { flexDirection: 'row', gap: Spacing.three },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    lineHeight: 24,
  },
  segment: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: Radii.pill },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
