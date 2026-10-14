import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useProfile, useSetRole, useTeam } from '@/hooks/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

/**
 * Who works here. Anyone who signs in with their phone shows up as a customer;
 * the owner promotes them to Rider (delivery) from here.
 *
 * The app is NOT the authority on role: `profiles_guard_role` in the database
 * refuses this update for anyone who is not an admin, so a bug in this screen
 * cannot promote a customer to owner.
 *
 * The three roles are drawn as one segmented control per person — the current
 * one filled, the others quiet — so the state is readable at a glance without
 * reading three words closely.
 */

const ROLES: UserRole[] = ['customer', 'delivery', 'admin'];

export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const me = useProfile();
  const team = useTeam();
  const setRole = useSetRole();

  const [errorKey, setErrorKey] = useState<string | null>(null);

  const onChangeRole = async (userId: string, role: UserRole) => {
    setErrorKey(null);
    try {
      await setRole.mutateAsync({ userId, role });
    } catch (error) {
      console.warn('[team] could not change role', error);
      setErrorKey('admin.roleError');
    }
  };

  const renderPerson = ({ item }: { item: Profile }) => {
    const busy = setRole.isPending && setRole.variables?.userId === item.id;
    const isMe = item.id === me.data?.id;
    const name = personName(item);

    return (
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons
              name={item.role === 'delivery' ? 'bicycle' : item.role === 'admin' ? 'shield' : 'person'}
              size={18}
              color={theme.textSecondary}
            />
          </View>
          <View style={styles.flex}>
            <ThemedText type="bodyStrong" numberOfLines={1}>
              {name}
            </ThemedText>
            {item.phone ? (
              <ThemedText type="small" themeColor="textSecondary">
                {item.phone}
              </ThemedText>
            ) : null}
          </View>
          {isMe ? <Badge label={t('admin.you')} tone="accent" icon="star" /> : null}
        </View>

        <View style={[styles.roles, { backgroundColor: theme.backgroundElement }]}>
          {ROLES.map((role) => {
            const selected = item.role === role;
            return (
              <Pressable
                key={role}
                onPress={() => void onChangeRole(item.id, role)}
                disabled={selected || setRole.isPending}
                accessibilityRole="radio"
                accessibilityLabel={`${name}: ${t(`admin.role.${role}`)}`}
                accessibilityState={{ selected, disabled: selected || setRole.isPending, busy }}
                style={({ pressed }) => [
                  styles.roleButton,
                  selected && { backgroundColor: theme.accent },
                  pressed && !selected && styles.pressed,
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
                  {t(`admin.role.${role}`)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
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
        <ThemedText type="title">{t('admin.teamTitle')}</ThemedText>
      </View>

      {errorKey ? (
        <View style={styles.errorSlot}>
          <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t(errorKey)}
          </ThemedText>
        </View>
      ) : null}

      {team.isLoading ? (
        <LoadingState />
      ) : (
        <FlatList
          data={team.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderPerson}
          extraData={setRole.isPending}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.five }]}
          refreshControl={
            <RefreshControl
              refreshing={team.isRefetching}
              onRefresh={() => void team.refetch()}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            team.isError ? (
              <StateMessage
                title={t('admin.teamError')}
                hint={t('admin.teamErrorHint')}
                onRetry={() => void team.refetch()}
                tone="danger"
              />
            ) : (
              <StateMessage title={t('admin.teamEmpty')} hint={t('admin.teamEmptyHint')} art="👥" />
            )
          }
        />
      )}
    </View>
  );
}

/** A person is whoever we can name: full name, else the phone. */
function personName(profile: Profile): string {
  return profile.full_name?.trim() || profile.phone || profile.id.slice(0, 8);
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
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
  card: { gap: Spacing.two },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roles: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: Radii.pill },
  roleButton: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
