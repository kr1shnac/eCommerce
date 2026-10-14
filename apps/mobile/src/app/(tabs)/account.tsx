import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallShop } from '@/components/call-shop';
import { LanguageSwitch } from '@/components/language-switch';
import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';

/**
 * The account tab: who you are, how the app looks, the language, and the one
 * support channel this town uses (a phone call).
 *
 * Appearance and language are device preferences, not account data, so they are
 * visible even when signed out — a customer can make the shop comfortable to
 * read before they ever give us a phone number.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  const phone = user?.phone ?? session?.user?.phone ?? '';
  const lastDigits = phone.replace(/\D/g, '').slice(-2);

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={styles.headerRow}>
        <ThemedText type="title">{t('account.title')}</ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <Card style={styles.profileCard}>
          <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
            {session && lastDigits ? (
              <ThemedText type="subtitle" style={{ color: theme.accent }}>
                {lastDigits}
              </ThemedText>
            ) : (
              <Ionicons name="person" size={24} color={theme.accent} />
            )}
          </View>
          <View style={styles.flex}>
            <ThemedText type="bodyStrong">
              {session ? t('account.signedIn') : t('account.signedOut')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {session ? phone || t('account.phoneUnknown') : t('account.signInLater')}
            </ThemedText>
          </View>
        </Card>

        <View style={styles.actionSlot}>
          {session ? (
            <Button
              label={t('account.signOut')}
              icon="log-out-outline"
              variant="outline"
              fullWidth
              onPress={() => void signOut()}
            />
          ) : (
            <Button
              label={t('auth.signIn')}
              icon="log-in-outline"
              fullWidth
              onPress={() => router.push('/login?returnTo=/(tabs)/account')}
            />
          )}
        </View>

        {session ? (
          <Pressable
            onPress={() => router.push('/addresses')}
            accessibilityRole="button"
            accessibilityLabel={t('address.myAddresses')}
            style={styles.navRow}>
            <Ionicons name="location-outline" size={22} color={theme.accent} />
            <ThemedText style={styles.flex}>{t('address.myAddresses')}</ThemedText>
            <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
          </Pressable>
        ) : null}

        <SectionHeader title={t('common.appearance')} style={styles.sectionHeader} />
        <Card style={styles.settingCard}>
          <ThemeSwitch />
        </Card>

        <SectionHeader title={t('common.language')} style={styles.sectionHeader} />
        <Card style={styles.settingCard}>
          <LanguageSwitch />
        </Card>

        <View style={styles.callSlot}>
          <CallShop />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSlot: { marginTop: Spacing.one },
  sectionHeader: { marginTop: Spacing.three },
  settingCard: { gap: Spacing.two },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  callSlot: { marginTop: Spacing.three },
});
