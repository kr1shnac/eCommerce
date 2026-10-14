import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { useProfile, useTeam } from '@/hooks/use-profile';
import { useAdminOrders, useAssignRider } from '@/hooks/use-staff-orders';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import {
  formatClock,
  formatSnapshotAddress,
  isSameDay,
  minutesSince,
  readSnapshotAddress,
} from '@/lib/order-view';
import { orderStatusStyle } from '@/lib/order-status';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { OrderWithItems } from '@/hooks/use-orders';
import type { Profile } from '@/types/database';

/**
 * The owner's live board. Every order that is not cancelled, newest first, with
 * the one thing a small shop must be able to do from the counter: put a name
 * against it. Riders can also claim orders themselves; this is the override.
 *
 * The three tiles at the top are the counter's whole day: how much is moving,
 * how much nobody has taken, and how much went out. A card wears its status as
 * an icon + colour + word, and an order nobody has claimed shows how long it has
 * been waiting, so the owner can see the shop is falling behind without reading.
 */
export default function AdminBoardScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const profile = useProfile();
  const orders = useAdminOrders();
  const team = useTeam();
  const assign = useAssignRider();
  const signOut = useAuthStore((state) => state.signOut);

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const riders = (team.data ?? []).filter((person) => person.role === 'delivery');
  const list = orders.data ?? [];
  const now = new Date();

  const live = list.filter((order) => order.status !== 'delivered').length;
  const waiting = list.filter(
    (order) => !order.assigned_to && (order.status === 'placed' || order.status === 'confirmed'),
  ).length;
  const today = list.filter((order) => order.status === 'delivered' && isSameDay(order.delivered_at, now)).length;

  const onAssign = async (orderId: string, riderId: string | null) => {
    setErrorKey(null);
    try {
      await assign.mutateAsync({ orderId, riderId });
      setPickerFor(null);
    } catch (error) {
      console.warn('[admin] could not assign rider', error);
      setErrorKey('admin.assignError');
    }
  };

  const renderOrder = ({ item }: { item: OrderWithItems }) => {
    const address = readSnapshotAddress(item);
    const assignedRider = riders.find((person) => person.id === item.assigned_to);
    const picking = pickerFor === item.id;
    const busy = assign.isPending && assign.variables?.orderId === item.id;
    const style = orderStatusStyle(theme, item.status);

    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <ThemedText type="smallBold">{item.order_number}</ThemedText>
          <Badge label={t(`orders.status.${item.status}`)} tone={style.tone} icon={style.icon} />
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15} color={theme.textSecondary} />
          <ThemedText type="caption" themeColor="textSecondary" style={styles.flex}>
            {item.status === 'delivered'
              ? formatClock(item.delivered_at)
              : `${formatClock(item.placed_at)} · ${t('admin.waitingTooLong', {
                  minutes: minutesSince(item.placed_at),
                })}`}
          </ThemedText>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={15} color={theme.textSecondary} />
          <ThemedText type="small" style={styles.flex}>
            <ThemedText type="smallBold">{address.full_name ?? ''}</ThemedText>
            {address.phone ? `  ${address.phone}` : ''}
          </ThemedText>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={15} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
            {formatSnapshotAddress(address, t('order.near'))}
          </ThemedText>
        </View>

        <View style={styles.cardBottom}>
          <Badge
            label={t('rider.items', { count: item.order_items.length })}
            tone="neutral"
            icon="cube-outline"
          />
          <ThemedText type="smallBold">{formatPaise(item.total_paise)}</ThemedText>
        </View>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <View style={styles.riderRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('admin.riderLabel')}
          </ThemedText>
          {assignedRider ? (
            <Badge label={riderName(assignedRider)} tone="accent" icon="bicycle-outline" />
          ) : (
            <Badge label={t('admin.noRider')} tone="warning" icon="help-circle-outline" />
          )}
        </View>

        {picking ? (
          riders.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('admin.teamEmptyHint')}
            </ThemedText>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}>
              {riders.map((rider) => {
                const selected = rider.id === item.assigned_to;
                return (
                  <Pressable
                    key={rider.id}
                    onPress={() => void onAssign(item.id, rider.id)}
                    disabled={assign.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('admin.assign')} ${riderName(rider)}`}
                    accessibilityState={{ selected, busy, disabled: assign.isPending }}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: selected ? theme.accent : theme.border,
                        backgroundColor: selected ? theme.accent : theme.card,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: selected ? theme.onAccent : theme.text }}>
                      {riderName(rider)}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>
          )
        ) : (
          <View style={styles.actionsRow}>
            <Button
              label={item.assigned_to ? t('admin.change') : t('admin.assign')}
              icon="person-add-outline"
              variant="outline"
              onPress={() => setPickerFor(item.id)}
            />

            {item.assigned_to ? (
              <Button
                label={t('admin.unassign')}
                variant="ghost"
                busy={busy}
                disabled={assign.isPending}
                onPress={() => void onAssign(item.id, null)}
              />
            ) : null}
          </View>
        )}
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
          <ThemedText type="title">{t('admin.boardTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('rider.greeting', { name: profile.data?.full_name ?? '' })}
          </ThemedText>
        </View>
        <IconButton
          icon="storefront-outline"
          label={t('admin.customerView')}
          onPress={() => router.replace('/(tabs)')}
        />
        <IconButton
          icon="log-out-outline"
          label={t('account.signOut')}
          onPress={() => void signOut()}
        />
      </View>

      {errorKey ? (
        <View style={styles.errorSlot}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {orders.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          extraData={pickerFor}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl
              refreshing={orders.isRefetching}
              onRefresh={() => void orders.refetch()}
              tintColor={theme.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.summary}>
              <StatTile value={live} label={t('admin.statLive')} icon="flash-outline" tone="accent" />
              <StatTile
                value={waiting}
                label={t('admin.statWaiting')}
                icon="hourglass-outline"
                tone="warning"
              />
              <StatTile
                value={today}
                label={t('admin.statDone')}
                icon="checkmark-done"
                tone="success"
              />
            </View>
          }
          ListEmptyComponent={
            orders.isError ? (
              <StateMessage
                title={t('admin.boardError')}
                hint={t('admin.boardErrorHint')}
                onRetry={() => void orders.refetch()}
                tone="danger"
              />
            ) : (
              <StateMessage title={t('admin.boardEmpty')} hint={t('admin.boardEmptyHint')} art="📋" />
            )
          }
        />
      )}
    </View>
  );
}

function StatTile({
  value,
  label,
  icon,
  tone,
}: {
  value: number;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'warning' | 'accent' | 'success';
}) {
  const theme = useTheme();
  const ink = tone === 'warning' ? theme.warningInk : tone === 'success' ? theme.successInk : theme.accent;
  const soft = tone === 'warning' ? theme.warningSoft : tone === 'success' ? theme.successSoft : theme.accentSoft;

  return (
    <Card flat style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={16} color={ink} />
      </View>
      <ThemedText type="subtitle" style={{ color: ink }}>
        {value}
      </ThemedText>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
    </Card>
  );
}

/** A person is whoever we can actually name: full name, else the phone. */
function riderName(profile: Profile): string {
  return profile.full_name?.trim() || profile.phone || profile.id.slice(0, 8);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  summary: { flexDirection: 'row', gap: Spacing.two, paddingBottom: Spacing.two },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.three },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  card: { gap: Spacing.one },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    gap: Spacing.two,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  chips: { gap: Spacing.two, paddingVertical: Spacing.one },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  pressed: { opacity: 0.7 },
});
