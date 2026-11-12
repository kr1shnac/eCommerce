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
import { CallShop } from '@/components/call-shop';
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

type AuthErrorKey =
  | 'invalidCode'
  | 'expiredCode'
  | 'tooManyAttempts'
  | 'notEnabled'
  | 'offline'
  | 'generic';

function authErrorKey(message: string): AuthErrorKey {
  const text = message.toLowerCase();
  if (text.includes('expired')) return 'expiredCode';
  if (text.includes('invalid') && text.includes('token')) return 'invalidCode';
  if (text.includes('rate') || text.includes('too many') || text.includes('seconds')) return 'tooManyAttempts';
  if (text.includes('signups not allowed') || text.includes('phone provider')) return 'notEnabled';
  // A misconfigured or un-entitled SMS provider surfaces as a 5xx or a
  // "provider" / "sms" error rather than the friendly one above. Same sentence
  // to the customer, because the fix is the same either way: call the shop.
  if (text.includes('provider') || text.includes('sms') || text.includes('sending')) return 'notEnabled';
  if (text.includes('network') || text.includes('fetch') || text.includes('timeout')) return 'offline';
  return 'generic';
}

/**
 * The 10 digits a customer types, and nothing else.
 *
 * Two jobs, both previously done by two half-behaviours that got them wrong:
 *
 *   1. accept what a person types — digits only, everything else dropped, capped
 *      at the 10 digits of an Indian mobile number;
 *   2. accept a number that arrives PASTED with its country code.
 *      `+9196119...` or `9196119...` is 12 nonzero digits; slicing that to 10
 *      keeps the `91` and throws away the last two real digits, which silently
 *      becomes a different, wrong number.
 *
 * So a pasted international number is stripped to its local 10 before it is
 * stored, and what the field holds is always exactly what it shows.
 */
function localDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits.slice(0, 10);
}

/**
 * What Supabase receives: E.164, always `+91` plus the 10 local digits.
 *
 * Kept separate from `localDigits` so exactly one place decides the country code
 * — the field holds local digits, the wire holds the prefixed form, and nothing
 * in between guesses. A number that is not 10 digits is returned unchanged so
 * the caller's length check refuses it, rather than inventing a +91 that would
 * send a code to the wrong person.
 */
function normalisePhone(raw: string): string {
  const local = localDigits(raw);
  return local.length === 10 ? `+91${local}` : local;
}

/**
 * How long the resend button stays quiet.
 *
 * Supabase Auth rate-limits OTP requests for a number to **once every 60
 * seconds** by default (Authentication → Rate Limits). A shorter countdown here
 * would put a tappable button on screen *before* the server will accept a tap,
 * and the customer would get "too many attempts" for having waited the 30
 * seconds they were told to wait — which reads as a broken shop, not a rule.
 *
 * So the client never offers what the server will refuse: this must be **at
 * least** the server's OTP request frequency, and it is deliberately equal to
 * the default. If that rate limit is ever lowered in the dashboard, this can come
 * down with it — change them together.
 *
 * The countdown is a *visible* reason to wait, not the limit itself. The real
 * ceiling stays on the server, where a customer cannot talk their way past it.
 */
const RESEND_SECONDS = 60;

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
  /** Seconds until the resend button wakes up. 0 means "tap me". */
  const [resendIn, setResendIn] = useState(0);

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
      setResendIn(RESEND_SECONDS);
    } catch (error) {
      // Rule 9.2: the technical message goes to the console, never to the screen.
      console.warn('[auth] could not send the code', error);
      setErrorKey(authErrorKey((error as Error).message ?? ''));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Batch 6: the resend door.
   *
   * `signInWithOtp` has always been callable again — the SMS can be re-requested
   * — but the screen had no way to ask, so a customer whose code never arrived
   * (including at a shop whose SMS provider is only now being configured) had to
   * back out to the phone step and type the number again. The countdown makes
   * the wait legible, and a refusal from the server still lands in the same
   * error box as everything else, translated — never a raw PostgREST string.
   */
  const onResendCode = async () => {
    if (busy || !phone || resendIn > 0) return;

    setBusy(true);
    setErrorKey(null);
    try {
      await sendCode(phone);
      setResendIn(RESEND_SECONDS);
    } catch (error) {
      console.warn('[auth] could not resend the code', error);
      setErrorKey(authErrorKey((error as Error).message ?? ''));
    } finally {
      setBusy(false);
    }
  };

  // The countdown. One interval, cleared on the way out; it only runs while the
  // code step is on screen, so a customer sitting on the phone step for an hour
  // is not greeted by a stale timer.
  useEffect(() => {
    if (step !== 'code' || resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((left) => (left <= 1 ? 0 : left - 1)), 1000);
    return () => clearInterval(timer);
  }, [step, resendIn]);

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
                  value={phoneInput}
                  onChangeText={(text) => setPhoneInput(localDigits(text))}
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

        {step === 'code' ? (
          <Pressable
            onPress={() => void onResendCode()}
            disabled={busy || resendIn > 0}
            accessibilityRole="button"
            accessibilityLabel={t('auth.resend')}
            accessibilityState={{ disabled: busy || resendIn > 0, busy }}
            style={styles.linkButton}>
            <ThemedText
              type="smallBold"
              style={{ color: resendIn > 0 || busy ? theme.textSecondary : theme.accent }}>
              {resendIn > 0
                ? t('auth.resendIn', { seconds: resendIn })
                : busy
                  ? t('common.pleaseWait')
                  : t('auth.resend')}
            </ThemedText>
          </Pressable>
        ) : null}

        {/*
          The door has to be openable by a real customer. If the code never
          arrives — no network, OTP not enabled yet, a number typed wrong — the
          sentence says what to do, and the shop's own phone number is one tap
          away. `CallShop` renders nothing when `store_settings.support_phone`
          is empty, so this block degrades to the sentence alone.
        */}
        {step === 'code' || errorKey ? (
          <View style={styles.help}>
            <Ionicons name="help-circle-outline" size={16} color={theme.textSecondary} />
            <View style={styles.helpBody}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('auth.trouble')}
              </ThemedText>
              <CallShop />
            </View>
          </View>
        ) : null}

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
    marginTop: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  helpBody: { flex: 1, gap: Spacing.two },
});
