import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { useAddresses, useDeleteAddress, useSetDefaultAddress } from '@/hooks/use-orders';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import type { Address } from '@/types/database';

/**
 * The customer's saved places.
 *
 * Every action here is a database write that RLS already scopes to the owner —
 * the screen adds no permission of its own. Removing the DEFAULT address
 * promotes the next one, so a customer is never left with an order page that
 * cannot pick a place to deliver.
 */
export default function AddressesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const addresses = useAddresses({ enabled: Boolean(session) });
  const removeAddress = useDeleteAddress();
  const setDefault = useSetDefaultAddress();

  const list = addresses.data ?? [];
  const busy = removeAddress.isPending || setDefault.isPending;

  const confirmRemove = (address: Address) => {
    Alert.alert(t('address.deleteTitle'), t('address.deleteHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('address.deleteAction'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await removeAddress.mutateAsync(address.id);
              // Keep a default in place: if we removed the default and others
              // remain, promote the first of them.
              const remaining = list.filter((row) => row.id !== address.id);
              if (address.is_default && remaining.length > 0) {
                await setDefault.mutateAsync(remaining[0].id);
              }
            } catch (error) {
              console.warn('[addresses] could not remove', error);
            }
          })();
        },
      },
    ]);
  };

  const header = (
    <View style={[styles.headerRow, { paddingTop: insets.top + Spacing.two }]}>
      <IconButton icon="arrow-back" label={t('common.back')} onPress={() => router.back()} />
      <ThemedText type="subtitle">{t('address.myAddresses')}</ThemedText>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <OfflineBanner />
      {header}

      {addresses.isLoading ? (
        <LoadingState />
      ) : addresses.isError ? (
        <StateMessage
          title={t('address.listError')}
          tone="danger"
          onRetry={() => void addresses.refetch()}
        />
      ) : list.length === 0 ? (
        <StateMessage title={t('address.emptyTitle')} hint={t('address.emptyHint')} art="📍" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
          {list.map((address) => (
            <Card key={address.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Badge
                  label={address.label ?? t('address.labelFallback')}
                  tone="neutral"
                  icon="bookmark-outline"
                />
                {address.is_default ? (
                  <Badge label={t('address.defaultBadge')} tone="accent" icon="star" solid />
                ) : null}
              </View>

              <ThemedText type="bodyStrong">{address.full_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {address.phone}
              </ThemedText>
              <View style={styles.lines}>
                {addressLines(address).map((line, index) => (
                  <ThemedText key={index} type="small" themeColor="textSecondary">
                    {line}
                  </ThemedText>
                ))}
              </View>

              <View style={[styles.actions, { borderTopColor: theme.border }]}>
                {!address.is_default ? (
                  <Action
                    icon="star-outline"
                    label={t('address.setDefault')}
                    disabled={busy}
                    onPress={() => void setDefault.mutateAsync(address.id).catch(() => undefined)}
                  />
                ) : null}
                <Action
                  icon="create-outline"
                  label={t('address.edit')}
                  onPress={() =>
                    router.push({ pathname: '/address', params: { id: address.id } })
                  }
                />
                <Action
                  icon="trash-outline"
                  label={t('address.remove')}
                  tone="danger"
                  disabled={busy}
                  onPress={() => confirmRemove(address)}
                />
              </View>
            </Card>
          ))}

          {removeAddress.isError || setDefault.isError ? (
            <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
              {t('address.defaultError')}
            </ThemedText>
          ) : null}
        </ScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
        <Button
          label={t('address.addNew')}
          icon="add"
          fullWidth
          onPress={() => router.push('/address')}
        />
      </View>
    </View>
  );
}

function addressLines(address: Address): string[] {
  const lines = [address.line1];
  if (address.line2) lines.push(address.line2);
  if (address.landmark) lines.push(address.landmark);
  lines.push(`${address.city} ${address.pincode}`.trim());
  return lines;
}

function Action({
  icon,
  label,
  onPress,
  disabled = false,
  tone = 'plain',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'danger';
}) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.danger : theme.accent;
  return (
    <View style={styles.actionWrap}>
      <IconButton
        icon={icon}
        label={label}
        onPress={onPress}
        disabled={disabled}
        color={disabled ? theme.textTertiary : color}
        tone="plain"
      />
      <ThemedText
        type="caption"
        style={[styles.actionLabel, { color: disabled ? theme.textTertiary : theme.textSecondary }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three },
  card: { gap: Spacing.one, borderRadius: Radii.lg },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  lines: { marginTop: Spacing.one, gap: 1 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionWrap: { alignItems: 'center', gap: 2, minWidth: 72 },
  actionLabel: { textAlign: 'center' },
  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
});
