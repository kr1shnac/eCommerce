import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Vibration,
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
import { SectionHeader } from '@/components/ui/section-header';
import { Radii, Spacing } from '@/constants/theme';
import { useProfile } from '@/hooks/use-profile';
import { useOrderEventListener } from '@/hooks/use-realtime-orders';
import {
  useAdvanceOrder,
  useClaimOrder,
  useDeliveredOrders,
  useMyDeliveries,
  useWaitingOrders,
} from '@/hooks/use-staff-orders';
import { useTheme } from '@/hooks/use-theme';
import { localizedItemName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import {
  formatClock,
  formatSnapshotAddress,
  isSameDay,
  readSnapshotAddress,
} from '@/lib/order-view';
import { orderStatusStyle } from '@/lib/order-status';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { OrderStatus } from '@/types/database';
import type { OrderWithItems } from '@/hooks/use-orders';

/**
 * The delivery face. One screen, three things a rider cares about:
 *   - orders nobody has taken yet (so a small team can self-serve),
 *   - what is on my own plate right now, with the one button that moves it on,
 *   - how many I finished today.
 *
 * There is no map and no turn-by-turn here yet (Phase 6); the address, the phone
 * number and a Call button are what actually get a bag to a door in Kunigal.
 *
 * The three numbers at the top are the whole day at a glance, and every card
 * wears its status as an icon + colour + word so a rider on a bike in the sun
 * reads it without stopping to squint.
 */

/** placed -> "Accept order", confirmed -> "Start packing", ... One tap, one step. */
const ACTION_KEY: Record<OrderStatus, string | null> = {
  placed: 'action.confirm',
  confirmed: 'action.pack',
  packing: 'action.out',
  out_for_delivery: 'action.deliver',
  delivered: null,
  cancelled: null,
};

export default function RiderScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const signOut = useAuthStore((state) => state.signOut);
  const profile = useProfile();

  const waiting = useWaitingOrders();
  const mine = useMyDeliveries();
  const delivered = useDeliveredOrders();

  const claim = useClaimOrder();
  const advance = useAdvanceOrder();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState<string | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A phone in a rider's pocket does not show a screen. When an order that
  // nobody has taken lands, buzz and put a banner up for a while. The list
  // itself updates on its own: Realtime invalidates the orders query, and this
  // event is only the cue that it happened.
  useOrderEventListener((event) => {
    if (event.type !== 'INSERT') return;
    if (event.order.status !== 'placed' || event.order.assigned_to) return;

    Vibration.vibrate(400);
    setNewOrderAlert(event.order.order_number);
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setNewOrderAlert(null), 20_000);
  });

  // Drop a pending banner timer when the rider leaves the screen.
  useEffect(
    () => () => {
      if (alertTimer.current) clearTimeout(alertTimer.current);
    },
    [],
  );

  const myDeliveries = mine.data ?? [];
  const today = new Date();
  const doneToday = (delivered.data ?? []).filter((order) => isSameDay(order.delivered_at, today)).length;

  const onClaim = async (orderId: string) => {
    setErrorKey(null);
    try {
      await claim.mutateAsync(orderId);
    } catch (error) {
      // Most likely a race: another rider tapped Accept first. Say so, do not crash.
      console.warn('[rider] could not accept order', error);
      setErrorKey('rider.claimError');
    }
  };

  const onAdvance = async (order: OrderWithItems) => {
    setErrorKey(null);
    try {
      await advance.mutateAsync({ orderId: order.id, from: order.status });
    } catch (error) {
      console.warn('[rider] could not advance order', error);
      setErrorKey('rider.advanceError');
    }
  };

  const onRefresh = () => {
    setErrorKey(null);
    void Promise.all([waiting.refetch(), mine.refetch(), delivered.refetch()]);
  };

  const onCall = (phone: string | undefined) => {
    if (!phone) return;
    void Linking.openURL(`tel:${phone}`);
  };

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.warn('[rider] sign out failed', error);
    } finally {
      setSigningOut(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <OfflineBanner />
        <StateMessage title={t('home.setupTitle')} hint={t('home.setupHint')} />
      </View>
    );
  }

  const loading = waiting.isLoading || mine.isLoading;
  const dead = waiting.isError && mine.isError;

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={[styles.headerRow, { paddingTop: insets.top + Spacing.two }]}>
        <View style={styles.flex}>
          <ThemedText type="title">{t('rider.title')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('rider.greeting', { name: profile.data?.full_name ?? '' })}
          </ThemedText>
        </View>
        <IconButton
          icon="log-out-outline"
          label={t('account.signOut')}
          onPress={() => void onSignOut()}
          disabled={signingOut}
        />
      </View>

      {newOrderAlert ? (
        <Pressable
          onPress={() => setNewOrderAlert(null)}
          accessibilityRole="alert"
          accessibilityLabel={t('rider.newOrderAlert')}
          style={({ pressed }) => [styles.alertSlot, pressed && styles.pressed]}>
          <Card tone="accent" style={styles.alert}>
            <Ionicons name="notifications" size={20} color={theme.accent} />
            <ThemedText type="smallBold" style={[styles.flex, { color: theme.accent }]}>
              {t('rider.newOrderAlert')}
            </ThemedText>
            <Ionicons name="close" size={18} color={theme.accent} />
          </Card>
        </Pressable>
      ) : null}

      {errorKey ? (
        <View style={styles.errorSlot}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : dead ? (
        <StateMessage
          title={t('rider.errorTitle')}
          hint={t('rider.errorHint')}
          onRetry={onRefresh}
          tone="danger"
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl
              refreshing={waiting.isRefetching || mine.isRefetching}
              onRefresh={onRefresh}
              tintColor={theme.accent}
            />
          }>
          {/* --- The day at a glance ---------------------------------------- */}
          <View style={styles.stats}>
            <StatTile
              value={waiting.data?.length ?? 0}
              label={t('rider.statWaiting')}
              icon="hourglass-outline"
              tone="warning"
            />
            <StatTile
              value={myDeliveries.length}
              label={t('rider.statMine')}
              icon="bicycle-outline"
              tone="accent"
            />
            <StatTile value={doneToday} label={t('rider.statDone')} icon="checkmark-done" tone="success" />
          </View>

          {/* --- Waiting pool ------------------------------------------------ */}
          <SectionHeader
            title={t('rider.waitingTitle')}
            style={styles.sectionTitle}
            action={
              <CountPill
                count={waiting.data?.length ?? 0}
                color={theme.warningInk}
                background={theme.warningSoft}
              />
            }
          />
          {waiting.isError ? (
            <StateMessage
              title={t('rider.errorTitle')}
              hint={t('rider.errorHint')}
              onRetry={() => void waiting.refetch()}
              tone="danger"
            />
          ) : (waiting.data?.length ?? 0) === 0 ? (
            <StateMessage title={t('rider.waitingEmpty')} hint={t('rider.waitingEmptyHint')} art="😴" />
          ) : (
            waiting.data?.map((order) => {
              const address = readSnapshotAddress(order);
              const busy = claim.isPending && claim.variables === order.id;
              return (
                <Card key={order.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <ThemedText type="smallBold">{order.order_number}</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {formatClock(order.placed_at)}
                    </ThemedText>
                  </View>

                  <View style={styles.personRow}>
                    <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" style={styles.flex}>
                      <ThemedText type="smallBold">{address.full_name ?? ''}</ThemedText>
                      {address.phone ? `  ${address.phone}` : ''}
                    </ThemedText>
                  </View>
                  <View style={styles.personRow}>
                    <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                      {formatSnapshotAddress(address, t('order.near'))}
                    </ThemedText>
                  </View>

                  <View style={styles.cardBottom}>
                    <Badge
                      label={t('rider.items', { count: order.order_items.length })}
                      tone="neutral"
                      icon="cube-outline"
                    />
                    <ThemedText type="smallBold" style={{ color: theme.warningInk }}>
                      {t('rider.cashToCollect')} {formatPaise(order.total_paise)}
                    </ThemedText>
                  </View>

                  <Button
                    label={busy ? t('common.pleaseWait') : t('rider.claim')}
                    icon="hand-left-outline"
                    fullWidth
                    busy={busy}
                    disabled={claim.isPending}
                    onPress={() => void onClaim(order.id)}
                    style={styles.cardButton}
                  />
                </Card>
              );
            })
          )}

          {/* --- My deliveries ---------------------------------------------- */}
          <SectionHeader
            title={t('rider.mineTitle')}
            style={styles.sectionTitle}
            action={
              <CountPill count={myDeliveries.length} color={theme.accent} background={theme.accentSoft} />
            }
          />
          {mine.isError ? (
            <StateMessage
              title={t('rider.errorTitle')}
              hint={t('rider.errorHint')}
              onRetry={() => void mine.refetch()}
              tone="danger"
            />
          ) : myDeliveries.length === 0 ? (
            <StateMessage title={t('rider.mineEmpty')} hint={t('rider.mineEmptyHint')} art="🛵" />
          ) : (
            myDeliveries.map((order) => {
              const address = readSnapshotAddress(order);
              const actionKey = ACTION_KEY[order.status];
              const busy = advance.isPending && advance.variables?.orderId === order.id;
              const style = orderStatusStyle(theme, order.status);
              return (
                <Card key={order.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <ThemedText type="smallBold">{order.order_number}</ThemedText>
                    <Badge
                      label={t(`orders.status.${order.status}`)}
                      tone={style.tone}
                      icon={style.icon}
                    />
                  </View>

                  {order.order_items.map((item) => (
                    <ThemedText key={item.id} type="small" numberOfLines={2} themeColor="textSecondary">
                      {`${item.quantity} × ${localizedItemName(item)}`}
                    </ThemedText>
                  ))}

                  <View style={[styles.divider, { backgroundColor: theme.border }]} />

                  <View style={styles.personRow}>
                    <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" style={styles.flex}>
                      <ThemedText type="smallBold">{address.full_name ?? ''}</ThemedText>
                      {address.phone ? `  ${address.phone}` : ''}
                    </ThemedText>
                  </View>
                  <View style={styles.personRow}>
                    <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                      {formatSnapshotAddress(address, t('order.near'))}
                    </ThemedText>
                  </View>

                  <View style={styles.actionsRow}>
                    <Button
                      label={t('common.call')}
                      icon="call-outline"
                      variant="outline"
                      disabled={!address.phone}
                      onPress={() => onCall(address.phone)}
                    />
                    {actionKey ? (
                      <Button
                        label={busy ? t('common.pleaseWait') : t(actionKey)}
                        icon="arrow-forward"
                        busy={busy}
                        disabled={advance.isPending}
                        onPress={() => void onAdvance(order)}
                        style={styles.flex}
                      />
                    ) : null}
                  </View>

                  <ThemedText type="smallBold" style={{ color: theme.warningInk }}>
                    {t('rider.cashToCollect')} {formatPaise(order.total_paise)}
                  </ThemedText>
                </Card>
              );
            })
          )}

          {/* --- Delivered today -------------------------------------------- */}
          <SectionHeader title={t('rider.doneTitle')} style={styles.sectionTitle} />
          <Card tone="accent" style={styles.doneCard}>
            <View style={[styles.doneIcon, { backgroundColor: theme.accent }]}>
              <Ionicons name="checkmark-done" size={18} color={theme.onAccent} />
            </View>
            <ThemedText type="bodyStrong">
              {doneToday === 0
                ? t('rider.doneEmpty')
                : t('rider.doneCount', { count: doneToday })}
            </ThemedText>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

/** A big number with a word under it: the whole day, three taps wide. */
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

function CountPill({ count, color, background }: { count: number; color: string; background: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <ThemedText type="caption" style={{ color }}>
        {count}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  alertSlot: { paddingHorizontal: Spacing.three },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  stats: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.three },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  sectionTitle: { marginTop: Spacing.four },
  pill: {
    minWidth: 28,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    alignItems: 'center',
  },
  card: { gap: Spacing.one },
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
    gap: Spacing.two,
  },
  personRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  cardButton: { marginTop: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  doneIcon: {
    width: 34,
    height: 34,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
