import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useOrders, type OrderWithItems } from '@/hooks/use-orders';
import { useAuthStore } from '@/store/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';
import { formatPaise } from '@/lib/money';
import { localizedItemName } from '@/lib/localized';

/**
 * Past orders. Cash on delivery, so the useful thing here is "where is my bag"
 * — the status, the order number to read out on the phone, and how much to
 * hand over.
 */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const orders = useOrders();

  const statusLabel = (status: OrderWithItems['status']): string =>
    t(`orders.status.${status}`);

  const renderOrder = ({ item }: { item: OrderWithItems }) => {
    const first = item.order_items[0];
    const rest = item.order_items.length - 1;

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${item.order_number}, ${statusLabel(item.status)}, ${formatPaise(item.total_paise)}`}
        style={({ pressed }) => [
          styles.card,
          { borderColor: theme.border, backgroundColor: theme.background },
          pressed && styles.pressed,
        ]}>
        <View style={styles.cardTop}>
          <ThemedText type="smallBold">{item.order_number}</ThemedText>
          <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{statusLabel(item.status)}</ThemedText>
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {first
            ? `${first.quantity} × ${localizedItemName(first)}${
                rest > 0 ? ` + ${rest} ${t('orders.moreItems', { count: rest })}` : ''
              }`
            : t('orders.noItems')}
        </ThemedText>

        <View style={styles.cardBottom}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDate(item.placed_at)}
          </ThemedText>
          <ThemedText type="smallBold">{formatPaise(item.total_paise)}</ThemedText>
        </View>
      </Pressable>
    );
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <ThemedText style={styles.header}>{t('orders.title')}</ThemedText>
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <ThemedText style={styles.header}>{t('orders.title')}</ThemedText>
        <StateMessage
          title={t('orders.signInTitle')}
          hint={t('orders.signInHint')}
        />
        <Pressable
          onPress={() => router.push('/login?returnTo=/(tabs)/orders')}
          accessibilityRole="button"
          accessibilityLabel={t('auth.signIn')}
          style={({ pressed }) => [styles.signIn, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={styles.signInLabel}>
            {t('auth.signIn')}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <ThemedText style={styles.header}>{t('orders.title')}</ThemedText>

      {orders.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={orders.data ?? []}
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
              <StateMessage title={t('orders.emptyTitle')} hint={t('orders.emptyHint')} />
            )
          }
        />
      )}
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
  header: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  list: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    minHeight: 88,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 999,
  },
  signIn: {
    alignSelf: 'center',
    marginTop: Spacing.three,
    minHeight: 48,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInLabel: { color: '#ffffff' },
  pressed: { opacity: 0.7 },
});