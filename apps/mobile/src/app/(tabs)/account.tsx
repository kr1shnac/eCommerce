import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallShop } from '@/components/call-shop';
import { LanguageSwitch } from '@/components/language-switch';
import { OfflineBanner } from '@/components/offline-banner';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { ThemeSwitch } from '@/components/ui/theme-switch';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useDeleteAccount, DeleteAccountFailed } from '@/hooks/use-account-deletion';
import { useProfile, useSetMyName } from '@/hooks/use-profile';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import { useLanguageStore } from '@/store/language-store';

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

  const deleteAccount = useDeleteAccount();

  const profile = useProfile();
  const setMyName = useSetMyName();
  const language = useLanguageStore((state) => state.language);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const storedName = profile.data?.full_name?.trim() ?? '';

  const phone = user?.phone ?? session?.user?.phone ?? '';
  const lastDigits = phone.replace(/\D/g, '').slice(-2);

  const openNameEditor = () => {
    setNameDraft(storedName);
    setEditingName(true);
  };

  /**
   * Save the account's own name (register H10). A blank name is refused before the
   * request, and the server refuses it too — a stored blank is indistinguishable
   * from "never set", so the customer could not tell which state they were in.
   */
  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (trimmed === '') return;
    try {
      await setMyName.mutateAsync(trimmed);
      setEditingName(false);
    } catch (error) {
      // The technical text goes to the console only (§9.2).
      console.warn('[account] could not save the name', error);
    }
  };

  /**
   * Two taps, because this is the one irreversible thing in the app. The
   * confirmation says plainly what is lost and what stays, in the customer's own
   * language, before anything is sent. The button is disabled while the request
   * is in flight so a second tap cannot fire a second deletion (rule 9.4).
   */
  const confirmDelete = () => {
    Alert.alert(t('account.deleteConfirmTitle'), t('account.deleteConfirmBody'), [
      { text: t('account.deleteConfirmNo'), style: 'cancel' },
      {
        text: t('account.deleteConfirmYes'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const result = await deleteAccount.mutateAsync();
              // `orders_anonymised` is deliberately not shown: "3 orders" is a
              // number a customer cannot act on, and the sentence reads better
              // without it. It is logged instead, where it is useful.
              console.log('[account] erased', result);
              Alert.alert(t('account.deleteDoneTitle'), t('account.deleteDoneBody'));
            } catch (error) {
              // The raw message never reaches the customer: it goes to the
              // console, and the customer sees the sentence that matches the
              // code (rule 9.2).
              const code = error instanceof DeleteAccountFailed ? error.code : 'unknown';
              const key =
                code === 'only_admin'
                  ? 'account.deleteErrorOnlyAdmin'
                  : code === 'not_signed_in'
                    ? 'account.deleteErrorNotSignedIn'
                    : 'account.deleteErrorUnknown';
              Alert.alert(t('account.deleteTitle'), t(key));
            }
          })();
        },
      },
    ]);
  };

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
              {session ? storedName || t('account.signedIn') : t('account.signedOut')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {session ? phone || t('account.phoneUnknown') : t('account.signInLater')}
            </ThemedText>
          </View>
        </Card>

        {/*
          The account's own name (register H10). Sign-in is a phone number and a
          code, so nobody's name is captured and the screen could show only
          "Signed in". On a shared handset — the normal case in a joint family —
          that means nobody can tell whose account this is. This is the one field
          the customer owns and the app never asked for.
        */}
        {session ? (
          <Card style={styles.settingCard}>
            <View style={styles.navRow}>
              <Ionicons name="person-outline" size={22} color={theme.accent} />
              <ThemedText style={styles.flex}>{t('account.nameTitle')}</ThemedText>
            </View>

            {!editingName ? (
              <Pressable
                onPress={openNameEditor}
                accessibilityRole="button"
                accessibilityLabel={t('account.nameEditLabel')}
                style={({ pressed }) => [styles.nameReadRow, pressed && styles.pressed]}>
                <ThemedText type="price">
                  {storedName || t('account.nameNotSet')}
                </ThemedText>
                <Ionicons name="pencil-outline" size={16} color={theme.textSecondary} />
              </Pressable>
            ) : (
              <View style={styles.nameEditor}>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder={t('account.namePlaceholder')}
                  placeholderTextColor={theme.textTertiary}
                  autoCapitalize="words"
                  style={[
                    styles.nameInput,
                    kannadaInputFont(language),
                    {
                      color: theme.text,
                      borderColor: theme.accentBorder,
                      backgroundColor: theme.backgroundElement,
                    },
                  ]}
                  accessibilityLabel={t('account.nameTitle')}
                />
                <View style={styles.nameActions}>
                  <Pressable
                    onPress={() => setEditingName(false)}
                    disabled={setMyName.isPending}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.nameCancel,
                      { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {t('common.cancel')}
                    </ThemedText>
                  </Pressable>
                  <Button
                    label={t('common.save')}
                    icon="checkmark"
                    size="md"
                    busy={setMyName.isPending}
                    disabled={nameDraft.trim() === ''}
                    onPress={() => void saveName()}
                  />
                </View>
              </View>
            )}

            <ThemedText type="caption" themeColor="textSecondary">
              {t('account.nameHint')}
            </ThemedText>
          </Card>
        ) : null}

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

        {/*
          Account recovery (register H9). The sign-in IS the phone number, so a
          changed number is a lost account — the common case in this town, not a
          corner case. There is no self-serve way to move a number while auth is
          OTP-only (the customer cannot prove the old number, and an
          unauthenticated "change my number" endpoint would be an account-takeover
          hole), so the honest path is: the shop moves it, from the admin panel,
          after hearing the customer's voice. That keeps it one tap from here.
        */}
        {session ? (
          <View style={styles.recoveryBlock}>
            <View style={styles.navRow}>
              <Ionicons name="help-circle-outline" size={22} color={theme.accent} />
              <ThemedText style={styles.flex}>{t('account.changedNumber')}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('account.changedNumberHint')}
            </ThemedText>
            <CallShop />
          </View>
        ) : null}

        {/*
          One phone, several adults (register H10). A joint family shares a handset,
          so the account belongs to the HOUSEHOLD, not one person — and the name that
          matters for a delivery is the one on the address, not the account name
          above. Saying this plainly is most of the item's value: without it the
          household and the shop disagree about what the account means.
        */}
        {session ? (
          <Card style={styles.settingCard}>
            <View style={styles.navRow}>
              <Ionicons name="people-outline" size={22} color={theme.accent} />
              <ThemedText style={styles.flex}>{t('account.householdTitle')}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('account.householdBody')}
            </ThemedText>
          </Card>
        ) : null}

        <SectionHeader title={t('common.appearance')} style={styles.sectionHeader} />
        <Card style={styles.settingCard}>
          <ThemeSwitch />
        </Card>

        <SectionHeader title={t('common.language')} style={styles.sectionHeader} />
        <Card style={styles.settingCard}>
          <LanguageSwitch />
        </Card>

        <SectionHeader title={t('account.privacyTitle')} style={styles.sectionHeader} />
        <Pressable
          onPress={() => router.push('/privacy')}
          accessibilityRole="button"
          accessibilityLabel={t('account.privacyLink')}
          style={styles.navRow}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.accent} />
          <ThemedText style={styles.flex}>{t('account.privacyLink')}</ThemedText>
          <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
        </Pressable>

        {/*
          Deleting the account. Both stores require this to be reachable from
          inside the app, and the DPDP Act gives the customer the right to it, so
          it is a real button with a real consequence — not an email address. It
          is deliberately at the very bottom, below everything else, because it is
          the one thing here nobody should tap by accident. The work happens in
          the database (migration 20261020000001).
        */}
        {session ? (
          <View style={styles.dangerBlock}>
            <SectionHeader title={t('account.deleteTitle')} />
            <Card style={styles.settingCard}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('account.deleteIntro')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t('account.deleteWhatStays')}
              </ThemedText>
              <Button
                label={t('account.deleteButton')}
                variant="outline"
                fullWidth
                disabled={deleteAccount.isPending}
                onPress={confirmDelete}
              />
            </Card>
          </View>
        ) : null}

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
  nameReadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 44,
  },
  nameEditor: { gap: Spacing.two },
  nameInput: {
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.md,
    borderWidth: 1.5,
    fontSize: 16,
  },
  nameActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  nameCancel: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: 1.5,
  },
  pressed: { opacity: 0.75 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
  },
  recoveryBlock: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  dangerBlock: { marginTop: Spacing.four, gap: Spacing.one },
  callSlot: { marginTop: Spacing.three },
});
