import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { DemoAccounts } from '@/components/demo-accounts';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { currentLanguage } from '@/store/language-store';

/**
 * Phone number, then a one-time code. Two steps on one screen.
 *
 * The customer is sent back to where they came from (usually the cart) once the
 * code is accepted, which is why this lives outside the tabs.
 *
 * No password, no email: in a town this size everybody has a phone and nobody
 * remembers a password. The hero keeps the shop's horse mark, because a person
 * who cannot read still knows they are in the right place.
 */

type AuthErrorKey = 'invalidCode' | 'expiredCode' | 'tooManyAttempts' | 'notEnabled' | 'generic';

function authErrorKey(message: string): AuthErrorKey {
  const text = message.toLowerCase();
  if (text.includes('expired')) return 'expiredCode';
  if (text.includes('invalid') && text.includes('token')) return 'invalidCode';
  if (text.includes('rate') || text.includes('too many') || text.includes('seconds')) return 'tooManyAttempts';
  if (text.includes('signups not allowed') || text.includes('phone provider')) return 'notEnabled';
  return 'generic';
}

/** Digits only, and at most 10: an Indian mobile number without +91. */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('919')) return `+${digits.slice(2)}`;
  return raw.trim();
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ returnTo?: string }>();

  const sendCode = useAuthStore((state) => state.sendCode);
  const verifyCode = useAuthStore((state) => state.verifyCode);
  const session = useAuthStore((state) => state.session);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);

  const finish = () => {
    const target = typeof params.returnTo === 'string' && params.returnTo ? params.returnTo : '/(tabs)/cart';
    router.replace(target as never);
  };

  // If a session already exists (we came back from the cart, or the customer
  // was signed in all along) there is nothing to do here.
  useEffect(() => {
    if (session) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const onSendCode = async () => {
    if (busy) return;
    const normalised = normalisePhone(phoneInput);
    if (!/^\+\d{10,15}$/.test(normalised)) {
      setErrorKey('generic');
      return;
    }

    setBusy(true);
    setErrorKey(null);
    try {
      await sendCode(normalised);
      setPhone(normalised);
      setStep('code');
    } catch (error) {
      // Rule 9.2: the technical message goes to the console, never to the screen.
      console.warn('[auth] could not send the code', error);
      setErrorKey(authErrorKey((error as Error).message ?? ''));
    } finally {
      setBusy(false);
    }
  };

  const onVerifyCode = async () => {
    if (busy) return;
    if (!phone) return;

    setBusy(true);
    setErrorKey(null);
    try {
      await verifyCode(phone, code.trim());
      finish();
    } catch (error) {
      console.warn('[auth] could not verify the code', error);
      setErrorKey(authErrorKey((error as Error).message ?? ''));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    (step === 'phone'
      ? normalisePhone(phoneInput).length >= 12
      : code.trim().length >= 4);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four },
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={[styles.roundel, { backgroundColor: theme.accentSoft }]}>
            <ThemedText style={styles.horse}>🐎</ThemedText>
          </View>
          <ThemedText type="title" style={styles.heroTitle}>
            {t('home.title')}
          </ThemedText>
        </View>

        <ThemedText type="subtitle">{t('auth.title')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {step === 'phone' ? t('auth.subtitlePhone') : t('auth.subtitleCode')}
        </ThemedText>

        <Card style={styles.form}>
          {step === 'phone' ? (
            <View style={styles.field}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('auth.phoneLabel')}
              </ThemedText>
              <View
                style={[
                  styles.inputRow,
                  { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="bodyStrong" themeColor="textSecondary">
                  +91
                </ThemedText>
                <TextInput
                  value={phoneInput.replace(/^\+?91?/, '')}
                  onChangeText={(text) => setPhoneInput(text.replace(/\D/g, '').slice(0, 10))}
                  placeholder={t('auth.phonePlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  maxLength={10}
                  editable={!busy}
                  accessibilityLabel={t('auth.phoneLabel')}
                  style={[styles.input, kannadaInputFont(currentLanguage()), { color: theme.text }]}
                />
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {t('auth.codeSentTo', { phone: phone ?? '' })}
              </ThemedText>
              <TextInput
                value={code}
                onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 8))}
                placeholder={t('auth.codePlaceholder')}
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                editable={!busy}
                accessibilityLabel={t('auth.codeLabel')}
                style={[
                  styles.input,
                  styles.codeInput,
                  kannadaInputFont(currentLanguage()),
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
                ]}
              />
            </View>
          )}

          {errorKey ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
              <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
                {t(`auth.error.${errorKey}`)}
              </ThemedText>
            </View>
          ) : null}

          {!isSupabaseConfigured ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
              <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
                {t('auth.error.notConfigured')}
              </ThemedText>
            </View>
          ) : null}

          <Button
            label={
              busy
                ? t('common.pleaseWait')
                : step === 'phone'
                  ? t('auth.sendCode')
                  : t('auth.verify')
            }
            size="lg"
            fullWidth
            busy={busy}
            disabled={!canSubmit}
            onPress={() => void (step === 'phone' ? onSendCode() : onVerifyCode())}
          />
        </Card>

        {step === 'code' ? (
          <Pressable
            onPress={() => {
              setStep('phone');
              setCode('');
              setErrorKey(null);
            }}
            disabled={busy}
            accessibilityRole="button"
            style={styles.linkButton}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {t('auth.changeNumber')}
            </ThemedText>
          </Pressable>
        ) : null}

        <DemoAccounts />

        <View style={styles.help}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.helpText}>
            {t('auth.testNumbers')}
          </ThemedText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    flexGrow: 1,
  },
  hero: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three },
  roundel: {
    width: 72,
    height: 72,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  horse: { fontSize: 36, lineHeight: 44 },
  heroTitle: { textAlign: 'center' },
  subtitle: { marginBottom: Spacing.two },
  form: { gap: Spacing.three },
  field: { gap: Spacing.two },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 52,
    fontSize: 18,
    paddingVertical: Spacing.two,
    ...(Platform.OS === 'android' ? { paddingVertical: 0 } : {}),
  },
  codeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    textAlign: 'center',
    letterSpacing: 8,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  errorText: { flex: 1 },
  linkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  help: {
    marginTop: 'auto',
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  helpText: { flex: 1 },
});
