import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import { useOrders, type OrderWithItems } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { isTerminal, orderStatusStyle } from '@/lib/order-status';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { useCartStore } from '@/store/cart-store';

/**
 * Past orders. Cash on delivery, so the useful thing here is "where is my bag"
 * — the status, the order number to read out on the phone, and how much to
 * hand over. Plus one-tap reorder, which is what a repeat customer actually
 * wants (the same monthly list, not hunting through the shop again).
 *
 * The status is an icon AND a colour AND a word (lib/order-status.ts), and the
 * small filter keeps a month of history from becoming one long scroll.
 */

type Filter = 'all' | 'active' | 'done';

const FILTER_KEY: Record<Filter, string> = {
  all: 'orders.filterAll',
  active: 'orders.filterActive',
  done: 'orders.filterDone',
};

export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const orders = useOrders();
  const replaceAll = useCartStore((state) => state.replaceAll);
  const [filter, setFilter] = useState<Filter>('all');

  const statusLabel = (status: OrderWithItems['status']): string => t(`orders.status.${status}`);

  /** Same as the Reorder button on the order screen: refill the bag, go to cart. */
  const onReorder = (order: OrderWithItems) => {
    const items: Record<string, number> = {};
    for (const item of order.order_items) {
      if (!item.product_id) continue;
      items[item.product_id] = (items[item.product_id] ?? 0) + item.quantity;
    }
    replaceAll(items);
    router.push('/(tabs)/cart');
  };

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const visible = useMemo(() => {
    if (filter === 'active') {
      return all.filter((order) => !isTerminal(order.status));
    }
    if (filter === 'done') {
      return all.filter((order) => isTerminal(order.status));
    }
    return all;
  }, [all, filter]);

  const renderOrder = ({ item }: { item: OrderWithItems }) => {
    const first = item.order_items[0];
    const rest = item.order_items.length - 1;
    const style = orderStatusStyle(theme, item.status);

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${item.order_number}, ${statusLabel(item.status)}, ${formatPaise(item.total_paise)}`}
        style={({ pressed }) => [
          styles.card,
          { borderColor: theme.border, backgroundColor: theme.card },
          pressed && styles.pressed,
        ]}>
        <View style={styles.cardTop}>
          <ThemedText type="smallBold">{item.order_number}</ThemedText>
          <Badge label={statusLabel(item.status)} tone={style.tone} icon={style.icon} />
        </View>

        <View style={styles.itemsRow}>
          <View style={[styles.dot, { backgroundColor: style.soft }]}>
            <ThemedText style={[styles.dotText, { color: style.ink }]}>
              {item.order_items.length}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.flex}>
            {first
              ? `${first.quantity} × ${localizedItemName(first)}${
                  rest > 0 ? ` ${t('orders.moreItems', { count: rest })}` : ''
                }`
              : t('orders.noItems')}
          </ThemedText>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <View style={styles.cardBottom}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDate(item.placed_at)}
          </ThemedText>
          <View style={styles.bottomRight}>
            <ThemedText type="price">{formatPaise(item.total_paise)}</ThemedText>
            <Pressable
              onPress={() => onReorder(item)}
              accessibilityRole="button"
              accessibilityLabel={t('order.reorder')}
              hitSlop={8}
              style={({ pressed }) => [
                styles.reorder,
                { backgroundColor: theme.accentSoft },
                pressed && styles.pressed,
              ]}>
              <Ionicons name="repeat" size={15} color={theme.accent} />
              <ThemedText type="caption" style={{ color: theme.accent }}>
                {t('order.reorder')}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Pressable>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <Header title={t('orders.title')} />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <Header title={t('orders.title')} />
        <StateMessage title={t('orders.signInTitle')} hint={t('orders.signInHint')} art="🔒" />
        <View style={styles.centerAction}>
          <Button
            label={t('auth.signIn')}
            icon="log-in-outline"
            onPress={() => router.push('/login?returnTo=/(tabs)/orders')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <OfflineBanner />
      <Header title={t('orders.title')} subtitle={all.length > 0 ? String(all.length) : undefined} />

      <View style={styles.filters}>
        {(Object.keys(FILTER_KEY) as Filter[]).map((option) => {
          const active = option === filter;
          return (
            <Pressable
              key={option}
              onPress={() => setFilter(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(FILTER_KEY[option])}
              style={({ pressed }) => [
                styles.filter,
                active
                  ? { backgroundColor: theme.accent }
                  : { backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? theme.onAccent : theme.textSecondary }}>
                {t(FILTER_KEY[option])}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {orders.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl
              refreshing={orders.isRefetching}
              onRefresh={() => void orders.refetch()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            orders.isError ? (
              <StateMessage
                title={t('orders.errorTitle')}
                hint={t('orders.errorHint')}
                onRetry={() => void orders.refetch()}
                tone="danger"
              />
            ) : (
              <StateMessage title={t('orders.emptyTitle')} hint={t('orders.emptyHint')} art="🧾" />
            )
          }
        />
      )}
    </View>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.headerRow}>
      <ThemedText type="title">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * 24-hour, day/month. Written out by hand rather than with Intl, because Intl's
 * output is not identical on Hermes/Android/iOS, and "25/10, 21:05" is read the
 * same way in Kunigal whichever language the customer picked.
 */
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  filters: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  filter: {
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  itemsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: {
    width: 28,
    height: 28,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { fontSize: 13, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  bottomRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 32,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: Radii.pill,
  },
  centerAction: { alignItems: 'center' },
  pressed: { opacity: 0.75 },
});
