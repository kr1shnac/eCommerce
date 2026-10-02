import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryChip } from '@/components/category-chip';
import { OfflineBanner } from '@/components/offline-banner';
import { ProductCard } from '@/components/product-card';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useCategories, useProducts } from '@/hooks/use-catalog';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useCartStore } from '@/store/cart-store';
import type { Product } from '@/types/database';

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categories = useCategories();
  const products = useProducts(categoryId);
  // Subscribe to the whole basket ONLY to tell FlatList to redraw. Each card
  // subscribes to its own product, so this does not re-render them all.
  const cartRevision = useCartStore((state) => Object.values(state.items).join(','));

  const emojiByCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories.data ?? []) {
      map.set(category.id, category.icon ?? '🛒');
    }
    return map;
  }, [categories.data]);

  const renderProduct = ({ item }: { item: Product }) => (
    <View style={styles.cardSlot}>
      <ProductCard product={item} fallbackEmoji={item.category_id ? emojiByCategory.get(item.category_id) : undefined} />
    </View>
  );

  const listHeader = (
    <View>
      <ThemedText style={styles.title}>{t('home.title')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('home.subtitle')}
      </ThemedText>

      <View style={[styles.pill, { backgroundColor: theme.accentSoft }]}>
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          📍 {t('home.deliveringTo')}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {t('home.categoriesTitle')}
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}>
        <CategoryChip
          icon="🛍️"
          label={t('home.allCategories')}
          isSelected={categoryId === null}
          onPress={() => setCategoryId(null)}
        />
        {(categories.data ?? []).map((category) => (
          <CategoryChip
            key={category.id}
            icon={category.icon}
            label={localizedName(category)}
            isSelected={categoryId === category.id}
            onPress={() => setCategoryId(category.id)}
          />
        ))}
      </ScrollView>

      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {t('home.productsTitle')}
      </ThemedText>
    </View>
  );

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + Spacing.three }]}>
        <View style={styles.contentTop}>
          <ThemedText style={styles.title}>{t('home.title')}</ThemedText>
        </View>
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <FlatList
        data={products.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderProduct}
        ListHeaderComponent={listHeader}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}
        ItemSeparatorComponent={() => <View style={styles.columnGap} />}
        // Re-render the cards when the language changes OR when any cart
        // quantity changes, so an "Add" button flips to a stepper immediately.
        extraData={[i18n.language, cartRevision]}
        refreshControl={
          <RefreshControl
            refreshing={products.isRefetching && !products.isLoading}
            onRefresh={() => void products.refetch()}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          products.isLoading ? (
            <LoadingState />
          ) : products.isError ? (
            // Never show products.error.message: it is a PostgREST string, and
            // the customer cannot act on it (rule 9.2).
            <StateMessage
              title={t('home.errorTitle')}
              hint={t('home.errorHint')}
              onRetry={() => void products.refetch()}
              tone="danger"
            />
          ) : (
            <StateMessage title={t('home.empty')} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  pill: {
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 6,
    borderRadius: 999,
  },
  sectionTitle: {
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chipsRow: {
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  row: {
    gap: Spacing.three,
  },
  columnGap: {
    height: Spacing.three,
  },
  cardSlot: {
    flex: 1,
  },
  contentTop: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
});