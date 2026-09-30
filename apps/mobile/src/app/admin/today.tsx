import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';import { useShopDayByRider, useShopDayTotals } from '@/hooks/use-shop-totals';
import { useTheme } from '@/hooks/use-theme';
import { formatPaise } from '@/lib/money';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * Today's takings — the number the owner closes the shop with.
 *
 * WHY THIS SCREEN MATTERS MORE THAN IT LOOKS
 *
 * Every other admin screen answers "what is happening?". This one answers "did
 * we make money, and does the cash in the drawer match?" That is the question
 * that decides whether the app survives the pilot, and until now it had no
 * answer at all — the owner would have reconciled on paper, which is exactly the
 * work the app is supposed to remove (register H3).
 *
 * HOW TO READ IT. The screen is deliberately ordered by certainty, not by size:
 *
 *   1. Earned — sales, in flight included. The one number that summarises the day.
 *   2. Delivered — what actually reached a home.
 *   3. Cash — in the riders' pockets vs already handed in. These two must add up
 *      to the COD money on delivered orders; if the drawer disagrees, this is
 *      where it shows.
 *   4. Owed back — money held for orders that were paid but never delivered.
 *      Kept visibly apart because it is the opposite of takings.
 *   5. Charges and coupons — what the day cost the shop in giveaways.
 *
 * Everything is integer paise from the database and is formatted with
 * `formatPaise` at the last moment (AGENTS.md Rule 1). The screen computes no
 * money itself, on purpose: see `use-shop-totals.ts`.
 */
export default function AdminTodayScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const totals = useShopDayTotals();
  const riders = useShopDayByRider();

  const configured = isSupabaseConfigured;
  const loading = totals.isLoading || riders.isLoading;
  const failed = totals.isError || riders.isError;

  const refetchAll = () => {
    void totals.refetch();
    void riders.refetch();
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <OfflineBanner />

      <View style={styles.header}>
        <ThemedText type="title">{t('admin.today')}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {t('admin.todaySubtitle')}
        </ThemedText>
      </View>

      {loading ? (
        <LoadingState label={t('admin.todayLoading')} />
      ) : failed ? (
        <StateMessage
          title={t('admin.todayFailed')}
          hint={t('admin.todayFailedHint')}
          onRetry={refetchAll}
          retryLabel={t('common.retry')}
        />
      ) : !configured || !totals.data ? (
        <StateMessage title={t('admin.todayEmpty')} hint={t('admin.todayEmptyHint')} art="🌙" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
          refreshControl={
            <RefreshControl
              refreshing={totals.isFetching || riders.isFetching}
              onRefresh={refetchAll}
              tintColor={theme.accent}
            />
          }>
          {/* 1. The day in one line. */}
          <Card tone="accent">
            <ThemedText type="caption" style={{ color: theme.accent }}>
              {t('admin.todayEarned')}
            </ThemedText>
            <ThemedText type="title" style={{ color: theme.accent }}>
              {formatPaise(totals.data.gross_paise)}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.accent }}>
              {t('admin.todayOrders', {
                count: totals.data.orders_placed,
                delivered: totals.data.orders_delivered,
              })}
            </ThemedText>
          </Card>

          {/* 2. What reached a home. */}
          <StatRow
            icon="checkmark-circle-outline"
            label={t('admin.todayDelivered')}
            value={formatPaise(totals.data.delivered_paise)}
            note={t('admin.todayDeliveredNote', { count: totals.data.orders_delivered })}
          />

          {/* 3. The cash loop — the reason this screen exists. */}
          <Card>
            <SectionHeading icon="wallet-outline" title={t('admin.todayCashTitle')} />
            <StatLine
              label={t('admin.todayCashInHand')}
              value={formatPaise(totals.data.cash_in_hand_paise)}
              emphasis
            />
            <StatLine
              label={t('admin.todayCashCollected')}
              value={formatPaise(totals.data.cash_collected_paise)}
            />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {t('admin.todayCashHint')}
            </ThemedText>
          </Card>

          {/* 4. Money the shop is holding but owes. Kept apart from takings. */}
          {totals.data.refund_due_paise > 0 ? (
            <Card tone="warning">
              <SectionHeading
                icon="arrow-undo-outline"
                title={t('admin.todayRefundTitle')}
                color={theme.warningInk}
              />
              <ThemedText type="subtitle" style={{ color: theme.warningInk }}>
                {formatPaise(totals.data.refund_due_paise)}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.warningInk }}>
                {t('admin.todayRefundHint')}
              </ThemedText>
            </Card>
          ) : null}

          {/* 5. What the day cost the shop. */}
          <Card>
            <SectionHeading icon="pricetag-outline" title={t('admin.todayCostsTitle')} />
            <StatLine
              label={t('admin.todayDeliveryFees')}
              value={formatPaise(totals.data.delivery_fee_paise)}
            />
            <StatLine
              label={t('admin.todayDiscounts')}
              value={formatPaise(totals.data.discount_paise)}
            />
          </Card>

          {/* Nothing came in, or everything failed: say so rather than showing a
              wall of zeroes and letting the owner guess whether it is broken. */}
          {totals.data.orders_placed === 0 && totals.data.orders_cancelled === 0 ? (
            <StateMessage title={t('admin.todayEmpty')} hint={t('admin.todayEmptyHint')} art="🌙" />
          ) : null}

          {totals.data.orders_cancelled + totals.data.orders_failed > 0 ? (
            <Card tone="danger">
              <SectionHeading
                icon="close-circle-outline"
                title={t('admin.todayProblemsTitle')}
                color={theme.dangerInk}
              />
              <StatLine
                label={t('admin.todayCancelled')}
                value={String(totals.data.orders_cancelled)}
                color={theme.dangerInk}
              />
              <StatLine
                label={t('admin.todayFailedCount')}
                value={String(totals.data.orders_failed)}
                color={theme.dangerInk}
              />
              <ThemedText type="caption" style={{ color: theme.dangerInk }}>
                {t('admin.todayProblemsHint')}
              </ThemedText>
            </Card>
          ) : null}

          {/* Who is holding the money. The screen is a dead end without this:
              "₹340 in hand" is not actionable, "Ravi is holding ₹340" is. */}
          <Card>
            <SectionHeading icon="people-outline" title={t('admin.todayRidersTitle')} />
            {riders.data && riders.data.length > 0 ? (
              riders.data.map((rider) => (
                <View
                  key={rider.rider_id ?? 'unknown'}
                  style={[styles.riderRow, { borderTopColor: theme.border }]}>
                  <View style={styles.riderName}>
                    <ThemedText type="default">{rider.rider_name ?? t('admin.todayRiderUnknown')}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {t('admin.todayRiderDelivered', { count: rider.orders_delivered })}
                    </ThemedText>
                  </View>
                  <View style={styles.riderMoney}>
                    <ThemedText
                      type="subtitle"
                      style={{
                        color:
                          rider.cash_to_collect_paise > 0 ? theme.warningInk : theme.textSecondary,
                      }}>
                      {formatPaise(rider.cash_to_collect_paise)}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {t('admin.todayRiderHolding')}
                    </ThemedText>
                  </View>
                </View>
              ))
            ) : (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {t('admin.todayNoRiders')}
              </ThemedText>
            )}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

/** A small heading inside a card, so each block announces what it is. */
function SectionHeading({
  icon,
  title,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeading}>
      <Ionicons name={icon} size={18} color={color ?? theme.textSecondary} />
      <ThemedText type="subtitle" style={color ? { color } : undefined}>
        {title}
      </ThemedText>
    </View>
  );
}

/** Label on the left, amount on the right, read as one line. */
function StatLine({
  label,
  value,
  emphasis = false,
  color,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.statLine}>
      <ThemedText type="default" style={{ color: theme.textSecondary, flex: 1 }}>
        {label}
      </ThemedText>
      <ThemedText
        type={emphasis ? 'title' : 'subtitle'}
        style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

/** A full-width block for one figure that deserves its own row. */
function StatRow({
  icon,
  label,
  value,
  note,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  note?: string;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.statRow}>
        <Ionicons name={icon} size={22} color={theme.accent} />
        <View style={styles.statRowText}>
          <ThemedText type="default" style={{ color: theme.textSecondary }}>
            {label}
          </ThemedText>
          {note ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {note}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="subtitle">{value}</ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.one },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.three },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  statLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  statRowText: { flex: 1, gap: 2 },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  riderName: { flex: 1, gap: 2 },
  riderMoney: { alignItems: 'flex-end', gap: 2 },
});
