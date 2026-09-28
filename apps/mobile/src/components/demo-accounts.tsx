import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  demoAccounts,
  demoSignInAvailable,
  reviewAccount,
  reviewSignInAvailable,
  signInAsDemo,
  type DemoAccount,
} from '@/lib/demo-accounts';

/**
 * The scaffolded sign-in, and the reviewer's door.
 *
 * Two different things share this component because they share the same code
 * path (email + password, then the auth listener routes away):
 *
 *   * the three dev accounts, which exist so the app can be looked at before
 *     SMS is configured. `__DEV__` only — they cannot appear in a release;
 *   * the single reviewer account, which exists so the app can be *approved*.
 *     That one has to work in a release build, so it is gated on
 *     `EXPO_PUBLIC_REVIEW_*` being set rather than on `__DEV__`.
 *
 * Nothing renders when neither applies, so this can sit on the login screen of a
 * plain production build without leaving a hole. See src/lib/demo-accounts.ts.
 */

const ICONS: Record<DemoRoleKey, keyof typeof Ionicons.glyphMap> = {
  customer: 'basket-outline',
  delivery: 'bicycle-outline',
  admin: 'storefront-outline',
  review: 'eye-outline',
};

type DemoRoleKey = DemoAccount['role'];

export function DemoAccounts() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // The dev block and the review door are separate cards with separate wording,
  // so a reviewer is never told they are looking at "development only".
  const accounts = demoSignInAvailable
    ? demoAccounts
    : reviewSignInAvailable && reviewAccount
      ? [reviewAccount]
      : [];

  if (accounts.length === 0) return null;

  const isReviewOnly = !demoSignInAvailable;

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
          {t(isReviewOnly ? 'auth.review.title' : 'auth.demo.title')}
        </ThemedText>
        {!isReviewOnly ? (
          <View style={[styles.tag, { backgroundColor: theme.warningSoft, borderColor: theme.warningInk }]}>
            <ThemedText type="small" style={[styles.tagText, { color: theme.warningInk }]}>
              {t('auth.demo.tag')}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        {t(isReviewOnly ? 'auth.review.hint' : 'auth.demo.hint')}
      </ThemedText>

      <View style={styles.list}>
        {accounts.map((account) => (
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
          {t(isReviewOnly ? 'auth.review.failed' : 'auth.demo.failed')}
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
