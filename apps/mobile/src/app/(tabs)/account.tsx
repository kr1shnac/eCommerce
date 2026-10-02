import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageSwitch } from '@/components/language-switch';
import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/store/auth-store';
import { useTheme } from '@/hooks/use-theme';

export default function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const session = useAuthStore((state) => state.session);
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  const phone = user?.phone ?? session?.user?.phone ?? '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <OfflineBanner />
      <ThemedText style={styles.header}>{t('account.title')}</ThemedText>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.background }]}>
          <LanguageSwitch />
          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {session ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{t('account.signedIn')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {phone || t('account.phoneUnknown')}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => void signOut()}
                accessibilityRole="button"
                accessibilityLabel={t('account.signOut')}
                style={({ pressed }) => [
                  styles.button,
                  { borderColor: theme.danger },
                  pressed && styles.pressed,
                ]}>
                <Ionicons name="log-out-outline" size={20} color={theme.danger} />
                <ThemedText type="smallBold" style={{ color: theme.danger }}>
                  {t('account.signOut')}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.flex}>
                <ThemedText type="small">{t('account.signedOut')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('account.signInLater')}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => router.push('/login?returnTo=/(tabs)/account')}
                accessibilityRole="button"
                accessibilityLabel={t('auth.signIn')}
                style={({ pressed }) => [
                  styles.buttonSolid,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {t('auth.signIn')}
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
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
  content: {
    paddingHorizontal: Spacing.three,
  },
  card: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
  },
  buttonSolid: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { color: '#ffffff' },
  pressed: { opacity: 0.7 },
});