import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Radii, Spacing } from '@/constants/theme';
import {
  CompleteDeliveryRejected,
  useCompleteDelivery,
} from '@/hooks/use-staff-orders';
import { useTheme } from '@/hooks/use-theme';

/**
 * The rider's half of the handover: type the four digits the customer reads out.
 *
 * This replaces the old one-tap "delivered" button for `out_for_delivery`.
 * `guard_delivery_code` (migration 20261106000003) refuses a plain order update
 * even with a timestamp, so this panel is not a convention the app could forget
 * — it is the only door to `delivered` for a rider.
 *
 * Every refusal is an ordinary answer the rider can act on ("2 tries left",
 * "this code is locked — call the shop"), never a red Postgres string on a
 * phone mount. A typo shorter than four digits is not sent at all.
 */
export function DeliveryCodeEntry({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const complete = useCompleteDelivery();
  const [code, setCode] = useState('');

  const pending = complete.isPending;
  const ready = code.length === 4 && !pending;

  const onSubmit = () => {
    if (!ready) return;
    complete.mutate({ orderId, code });
  };

  let errorText: string | null = null;
  if (complete.isError) {
    const error = complete.error;
    if (error instanceof CompleteDeliveryRejected) {
      switch (error.code) {
        case 'wrong_code':
          errorText =
            error.attemptsLeft === null
              ? t('rider.codeError')
              : t('rider.codeWrong', { count: error.attemptsLeft });
          break;
        case 'locked':
          errorText = t('rider.codeLocked');
          break;
        case 'invalid_code':
          errorText = t('rider.codeInvalid');
          break;
        case 'no_code':
          errorText = t('rider.codeMissing');
          break;
        case 'not_out_for_delivery':
          errorText = t('rider.codeAlreadyDone');
          break;
        case 'order_not_found':
          errorText = t('rider.codeNotFound');
          break;
      }
    } else {
      // A permission failure or a dead connection. The panel must not pretend
      // the code was wrong; say the honest general thing.
      errorText = t('rider.codeError');
    }
  }

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <View style={styles.head}>
        <Ionicons name="keypad-outline" size={18} color={theme.accent} />
        <ThemedText type="smallBold" style={styles.flex}>
          {t('rider.codeTitle')}
        </ThemedText>
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        {t('rider.codeHint')}
      </ThemedText>

      <TextInput
        value={code}
        // Digits only: the keypad cannot produce a letter, and a pasted code
        // with a space must not be treated as a wrong guess.
        onChangeText={(text) => setCode(text.replace(/[^0-9]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        editable={!pending}
        placeholder={t('rider.codePlaceholder')}
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel={t('rider.codeLabel')}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.card,
            borderColor: errorText ? theme.danger : theme.border,
          },
        ]}
      />

      {errorText ? (
        <ThemedText type="small" style={{ color: theme.danger }} accessibilityRole="alert">
          {errorText}
        </ThemedText>
      ) : null}

      <Button
        label={pending ? t('common.pleaseWait') : t('rider.codeSubmit')}
        icon="checkmark-done"
        fullWidth
        busy={pending}
        disabled={!ready}
        onPress={onSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
    padding: Spacing.twoHalf,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  input: {
    minHeight: 54,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    // Big, spaced digits: this is read at arm's length on a bike mount.
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
});
