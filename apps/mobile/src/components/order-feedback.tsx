import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useOrderFeedback, useSubmitOrderFeedback } from '@/hooks/use-order-feedback';
import { useTheme } from '@/hooks/use-theme';
import type { FeedbackReason } from '@/types/database';

/**
 * The fixed six, in the order they are offered. This is the same list the
 * database CHECK accepts (migration 20261106000001); adding one here means
 * changing the constraint in a new migration too.
 */
const REASONS: FeedbackReason[] = [
  'missing_item',
  'damaged',
  'late',
  'wrong_address',
  'wrong_item',
  'other',
];

/**
 * "Was everything right?" — the one question asked after the bag arrives.
 *
 * It is deliberately not a rating. A star average tells a one-street shop
 * nothing it can act on; "an item was missing" tells the owner exactly which
 * order to look at and what to do. The answer is a record, not a conversation:
 * once tapped, it stays as written (the table has no update or delete policy).
 *
 * Rules 9.2 and 9.4: loading renders nothing rather than a flash, an error gets
 * a translated line and a Retry, and every control is disabled while the write
 * is in flight so a second tap cannot send a second answer.
 */
export function OrderFeedbackCard({
  orderId,
  isOwner,
}: {
  orderId: string;
  /** Only the customer who placed the order is asked; staff never are. */
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const existing = useOrderFeedback(isOwner ? orderId : null);
  const submit = useSubmitOrderFeedback();
  const [choosingReason, setChoosingReason] = useState(false);

  if (!isOwner) return null;

  // The question appears once the answer is known to be absent. Rendering
  // nothing during the read avoids asking "was it OK?" of someone who already
  // answered, even for a frame.
  if (existing.isLoading) return null;

  if (existing.isError) {
    return (
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('feedback.error')}
        </ThemedText>
        <Button
          label={t('feedback.retry')}
          icon="refresh"
          variant="outline"
          fullWidth
          onPress={() => void existing.refetch()}
        />
      </Card>
    );
  }

  const answer = existing.data;

  if (answer) {
    const ok = answer.was_ok;
    return (
      <Card style={styles.card}>
        <View style={styles.head}>
          <Ionicons
            name={ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            size={20}
            color={ok ? theme.successInk : theme.warningInk}
          />
          <ThemedText type="smallBold" style={styles.flex}>
            {t('feedback.thanks')}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {ok
            ? t('feedback.recordedOk')
            : t('feedback.recordedProblem', {
                reason: t(`feedback.reason.${answer.reason}`),
              })}
        </ThemedText>
      </Card>
    );
  }

  const pending = submit.isPending;

  return (
    <Card tone="accent" style={styles.card}>
      <ThemedText type="bodyStrong">{t('feedback.title')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('feedback.hint')}
      </ThemedText>

      {choosingReason ? (
        <>
          <ThemedText type="smallBold" style={styles.reasonTitle}>
            {t('feedback.reasonTitle')}
          </ThemedText>
          <View style={styles.chips}>
            {REASONS.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => submit.mutate({ orderId, wasOk: false, reason })}
                disabled={pending}
                accessibilityRole="button"
                accessibilityState={{ disabled: pending }}
                accessibilityLabel={t(`feedback.reason.${reason}`)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                  },
                  pending && styles.blocked,
                  pressed && !pending && styles.pressed,
                ]}>
                <ThemedText type="small">{t(`feedback.reason.${reason}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          <Button
            label={t('feedback.yes')}
            icon="checkmark"
            fullWidth
            busy={pending}
            onPress={() => submit.mutate({ orderId, wasOk: true, reason: null })}
          />
          <Button
            label={t('feedback.no')}
            icon="alert-circle-outline"
            variant="outline"
            fullWidth
            disabled={pending}
            onPress={() => setChoosingReason(true)}
          />
        </View>
      )}

      {pending ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t('feedback.saving')}
        </ThemedText>
      ) : null}
      {submit.isError ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {t('feedback.error')}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one, marginTop: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  reasonTitle: { marginTop: Spacing.one },
  actions: { gap: Spacing.two, marginTop: Spacing.one },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  blocked: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
