import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { demoAccounts, demoSignInAvailable, signInAsDemo, type DemoAccount } from '@/lib/demo-accounts';

/**
 * Development-only sign-in.
 *
 * The app signs in with a phone number and a one-time code, which needs an SMS
 * provider. Until one is configured there are no accounts, so the order history,
 * the rider's pool and the owner's board are behind a door nobody can open.
 * This block offers the three seeded accounts instead, so the app can actually
 * be looked at. It renders nothing unless `__DEV__` is true AND the accounts are
 * in the git-ignored `.env` — see src/lib/demo-accounts.ts.
 */

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  customer: 'basket-outline',
  delivery: 'bicycle-outline',
  admin: 'storefront-outline',
};

export function DemoAccounts() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!demoSignInAvailable) return null;

  const signIn = async (account: DemoAccount) => {
    if (busyRole) return;
    setBusyRole(account.role);
    setFailed(false);
    try {
      await signInAsDemo(account);
      // Success unmounts this screen (the session listener routes away), so the
      // spinner stays up on purpose rather than flickering off first.
    } catch (error) {
      // Rule 9.2: the technical message goes to the console, never the screen.
      console.warn('[demo] could not sign in as the demo account', error);
      setFailed(true);
      setBusyRole(null);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('auth.demo.title')}
        </ThemedText>
        <View style={[styles.tag, { backgroundColor: theme.warningSoft, borderColor: theme.warningInk }]}>
          <ThemedText type="small" style={[styles.tagText, { color: theme.warningInk }]}>
            {t('auth.demo.tag')}
          </ThemedText>
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {t('auth.demo.hint')}
      </ThemedText>

      <View style={styles.list}>
        {demoAccounts.map((account) => (
          <Button
            key={account.role}
            label={t(account.labelKey)}
            variant="outline"
            icon={ICONS[account.role]}
            fullWidth
            busy={busyRole === account.role}
            disabled={busyRole !== null && busyRole !== account.role}
            onPress={() => void signIn(account)}
          />
        ))}
      </View>

      {failed ? (
        <ThemedText type="small" style={{ color: theme.dangerInk }}>
          {t('auth.demo.failed')}
        </ThemedText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.two },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  tag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  tagText: { fontSize: 11, letterSpacing: 0.5 },
  list: { gap: Spacing.two, marginTop: Spacing.one },
});
