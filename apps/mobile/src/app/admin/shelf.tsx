import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { kannadaInputFont } from '@/constants/fonts';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useShelfProducts, useUpdateShelf, type ShelfEdit } from '@/hooks/use-product-shelf';
import { AddProductPanel } from '@/components/add-product-panel';
import { PackField } from '@/components/pack-field';
import { useStore } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useLanguageStore } from '@/store/language-store';
import type { Product } from '@/types/database';

/**
 * The shelf, from the counter.
 *
 * The owner stands in front of the goods and needs three taps: change a price,
 * change stock, take something off the shelf. Every one of those writes goes
 * through `update_product_from_shop()` (see `use-product-shelf.ts` for why a
 * plain update would silently lie).
 *
 * Money is integer paise from end to end (AGENTS.md rule 1). The only rupee
 * strings in this file come out of `formatPaise`/`formatPaiseShort` at render
 * time — the edit box parses rupees back to paise the moment the owner confirms,
 * and never stores the typed string.
 */

/** How much a stock stepper moves per tap. Groceries move in whole units. */
const STOCK_STEP = 1;

export default function AdminShelfScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = useLanguageStore((state) => state.language);

  const store = useStore();
  const storeId = store.data?.id ?? null;
  const products = useShelfProducts(storeId);
  const updateShelf = useUpdateShelf();

  const [term, setTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => {
    const all = products.data ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (p) =>
        p.name_en.toLowerCase().includes(needle) || p.name_kn.toLowerCase().includes(needle),
    );
  }, [products.data, term]);

  const busyId = updateShelf.isPending ? (updateShelf.variables?.productId ?? null) : null;

  const save = async (edit: ShelfEdit) => {
    setErrorKey(null);
    try {
      await updateShelf.mutateAsync(edit);
    } catch (error) {
      // Postgres codes and messages go to the console only (rule 9.2). A CHECK
      // violation here means the owner typed a price above the MRP or a negative
      // stock; the database refused it, which is the right outcome, so the screen
      // says so in words rather than showing the SQL.
      console.warn('[shelf] could not save the change', error);
      setErrorKey('admin.shelfSaveError');
    }
  };

  /**
   * Parse what the owner typed into PAISE. Returns null when it is not a number,
   * so a broken entry is refused before it reaches the database rather than being
   * silently coerced.
   */
  const parseRupees = (text: string): number | null => {
    const cleaned = text.trim().replace(/[₹,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    // Rupees -> paise. Done once, here, and never again: everything downstream
    // is an integer.
    return Math.round(Number(cleaned) * 100);
  };

  const beginEdit = (product: Product) => {
    setErrorKey(null);
    setEditingId(product.id);
    setDraft((product.price_paise / 100).toFixed(2));
  };

  const commitPrice = (product: Product) => {
    const paise = parseRupees(draft);
    setEditingId(null);
    if (paise === null || paise === product.price_paise) return;
    // Raising the price above the printed MRP is refused by the database, and
    // rightly so — a shop cannot sell above its own printed price. When the new
    // price exceeds the old MRP the MRP goes up with it, which is what the owner
    // means; otherwise the MRP is left alone.
    if (product.mrp_paise !== null && paise > product.mrp_paise) {
      void save({ productId: product.id, pricePaise: paise, mrpPaise: paise });
      return;
    }
    void save({ productId: product.id, pricePaise: paise });
  };

  const stepStock = (product: Product, by: number) => {
    const next = Math.max(0, product.stock_qty + by);
    if (next === product.stock_qty) return;
    void save({ productId: product.id, stockQty: next });
  };

  const toggleActive = (product: Product) => {
    void save({ productId: product.id, isActive: !product.is_active });
  };

  const renderProduct = ({ item }: { item: Product }) => {
    const busy = busyId === item.id;
    const name = localizedName(item);
    const editing = editingId === item.id;
    const soldOut = item.stock_qty === 0;

    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.thumbBox, { backgroundColor: theme.backgroundElement }]}>
            {item.image_url ? (
              <Image
                source={{ uri: item.image_url }}
                style={styles.thumb}
                contentFit="cover"
                transition={150}
              />
            ) : (
              <ThemedText style={styles.emoji}>{item.emoji ?? '🛒'}</ThemedText>
            )}
          </View>

          <View style={styles.info}>
            <ThemedText type="bodyStrong" numberOfLines={2}>
              {name}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {item.unit}
            </ThemedText>
            <View style={styles.badgeRow}>
              {!item.is_active ? (
                <Badge label={t('admin.shelfOff')} tone="warning" icon="eye-off-outline" />
              ) : soldOut ? (
                <Badge label={t('admin.shelfSoldOut')} tone="danger" icon="close-circle" solid />
              ) : (
                <Badge
                  label={t('admin.shelfInStock', { count: item.stock_qty })}
                  tone="success"
                  icon="checkmark-circle"
                />
              )}
            </View>
          </View>

          {busy ? <ActivityIndicator color={theme.accent} /> : null}
        </View>

        {/* Price. Tap the number to edit it; the rupee string never leaves this
            box — `commitPrice` turns it into paise before the request. */}
        <View style={[styles.fieldRow, { borderTopColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            {t('admin.shelfPrice')}
          </ThemedText>

          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                keyboardType="decimal-pad"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => commitPrice(item)}
                onBlur={() => commitPrice(item)}
                style={[
                  styles.priceInput,
                  { color: theme.text, borderColor: theme.accentBorder, backgroundColor: theme.backgroundElement },
                ]}
                accessibilityLabel={t('admin.shelfPriceLabel', { name })}
              />
              <Pressable
                onPress={() => commitPrice(item)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
                style={({ pressed }) => [
                  styles.saveChip,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                  {t('common.save')}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => beginEdit(item)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('admin.shelfEditPriceLabel', {
                name,
                amount: formatPaise(item.price_paise),
              })}
              style={({ pressed }) => [styles.priceButton, pressed && styles.pressed]}>
              <ThemedText type="price">{formatPaise(item.price_paise)}</ThemedText>
              <Ionicons name="pencil-outline" size={16} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Stock. The stepper is the fastest way to say "two left"; typing is for
            the delivery morning when the whole shelf is restocked at once. */}
        <View style={[styles.fieldRow, { borderTopColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            {t('admin.shelfStock')}
          </ThemedText>

          <View style={styles.stepper}>
            <Pressable
              onPress={() => stepStock(item, -STOCK_STEP)}
              disabled={busy || item.stock_qty === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || item.stock_qty === 0 }}
              accessibilityLabel={t('admin.shelfStockDownLabel', { name })}
              style={({ pressed }) => [
                styles.stepButton,
                { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <Ionicons
                name="remove"
                size={18}
                color={item.stock_qty === 0 ? theme.textTertiary : theme.text}
              />
            </Pressable>

            <ThemedText type="bodyStrong" style={styles.stockValue}>
              {item.stock_qty}
            </ThemedText>

            <Pressable
              onPress={() => stepStock(item, STOCK_STEP)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={t('admin.shelfStockUpLabel', { name })}
              style={({ pressed }) => [
                styles.stepButton,
                { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <Ionicons name="add" size={18} color={theme.text} />
            </Pressable>

            <Pressable
              onPress={() => void save({ productId: item.id, stockQty: 0 })}
              disabled={busy || item.stock_qty === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || item.stock_qty === 0 }}
              accessibilityLabel={t('admin.shelfSoldOutLabel', { name })}
              style={({ pressed }) => [
                styles.soldOutChip,
                { borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.dangerInk }}>
                {t('admin.shelfSoldOutAction')}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {/* On/off the shelf. This is the "we have stopped selling this" switch,
            different from "we have none today" — so it gets its own control. */}
        <View style={[styles.fieldRow, { borderTopColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            {t('admin.shelfOnShelf')}
          </ThemedText>
          <Pressable
            onPress={() => toggleActive(item)}
            disabled={busy}
            accessibilityRole="switch"
            accessibilityState={{ checked: item.is_active, disabled: busy }}
            accessibilityLabel={t('admin.shelfToggleLabel', { name })}
            style={({ pressed }) => [
              styles.toggle,
              {
                borderColor: item.is_active ? theme.accentBorder : theme.border,
                backgroundColor: item.is_active ? theme.accentSoft : theme.backgroundElement,
              },
              pressed && styles.pressed,
            ]}>
            <Ionicons
              name={item.is_active ? 'checkmark-circle' : 'close-circle-outline'}
              size={16}
              color={item.is_active ? theme.accent : theme.textSecondary}
            />
            <ThemedText
              type="smallBold"
              style={{ color: item.is_active ? theme.accent : theme.textSecondary }}>
              {item.is_active ? t('admin.shelfOn') : t('admin.shelfOff')}
            </ThemedText>
          </Pressable>
        </View>

        {/* The pack (register M4). Shown read-only most of the time, because the
            pack is identity, not a day-to-day number: the owner sets "500 g" once.
            Changing it is a deliberate two-step — tap Change, then Save — so a
            mis-tap on a busy morning cannot turn a 1 kg bag into a 5 kg bag at the
            1 kg price. The product guard refuses it anyway; this just makes the
            refusal impossible to reach by accident. */}
        <PackField
          product={item}
          busy={busy}
          onSave={(pack) => void save({ productId: item.id, pack })}
        />
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

      <View style={[styles.header, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.titleRow}>
          <ThemedText type="title">{t('admin.shelfTitle')}</ThemedText>
          <Pressable
            onPress={() => {
              setAdding((open) => !open);
              setErrorKey(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: adding }}
            accessibilityLabel={t('admin.addProduct')}
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: theme.accentBorder, backgroundColor: theme.accentSoft },
              pressed && styles.pressed,
            ]}>
            <Ionicons name={adding ? 'close' : 'add'} size={18} color={theme.accent} />
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {adding ? t('common.cancel') : t('admin.addProduct')}
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {t('admin.shelfHint')}
        </ThemedText>

        <View
          style={[
            styles.searchBar,
            Elevation.card,
            { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.shadow },
          ]}>
          <Ionicons name="search" size={20} color={theme.textSecondary} />
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t('admin.shelfSearch')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.searchInput, kannadaInputFont(language), { color: theme.text }]}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t('admin.shelfSearch')}
          />
          {term.length > 0 ? (
            <Pressable
              onPress={() => setTerm('')}
              accessibilityRole="button"
              accessibilityLabel={t('home.clearSearch')}>
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
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

      {store.isLoading || products.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          extraData={language}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.five }]}
          // The add-product panel scrolls with the list so it never covers the
          // shelf, and closing it restores exactly what was there.
          ListHeaderComponent={adding ? <AddProductPanel onDone={() => setAdding(false)} /> : null}
          refreshControl={
            <RefreshControl
              refreshing={products.isRefetching}
              onRefresh={() => void products.refetch()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            products.isError || store.isError ? (
              <StateMessage
                title={t('admin.shelfError')}
                hint={t('admin.shelfErrorHint')}
                onRetry={() => void (store.isError ? store.refetch() : products.refetch())}
              />
            ) : term.trim() ? (
              <StateMessage
                title={t('admin.shelfNoMatch')}
                hint={t('admin.shelfNoMatchHint')}
                art="🔍"
              />
            ) : (
              <StateMessage
                title={t('admin.shelfEmpty')}
                hint={t('admin.shelfEmptyHint')}
                art="🧺"
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 15, height: '100%' },
  errorSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  card: { padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  thumbBox: {
    width: 52,
    height: 52,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  emoji: { fontSize: 26 },
  info: { flex: 1, gap: 2 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: 2 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { minWidth: 64 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  priceInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
  saveChip: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockValue: { minWidth: 32, textAlign: 'center' },
  soldOutChip: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.75 },
});
