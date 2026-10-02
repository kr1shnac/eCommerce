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
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/store/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * Phone number, then a one-time code. Two steps on one screen.
 *
 * The customer is sent back to where they came from (usually the cart) once the
 * code is accepted, which is why this lives outside the tabs.
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
        <ThemedText style={styles.title}>{t('auth.title')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {step === 'phone' ? t('auth.subtitlePhone') : t('auth.subtitleCode')}
        </ThemedText>

        {step === 'phone' ? (
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('auth.phoneLabel')}
            </ThemedText>
            <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <ThemedText type="default" themeColor="textSecondary">
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
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>
        ) : (
          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
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
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            />
          </View>
        )}

        {errorKey ? (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {t(`auth.error.${errorKey}`)}
          </ThemedText>
        ) : null}

        {!isSupabaseConfigured ? (
          <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
            {t('auth.error.notConfigured')}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={step === 'phone' ? onSendCode : onVerifyCode}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy }}
          accessibilityLabel={step === 'phone' ? t('auth.sendCode') : t('auth.verify')}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent },
            !canSubmit && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            {busy
              ? t('common.pleaseWait')
              : step === 'phone'
                ? t('auth.sendCode')
                : t('auth.verify')}
          </ThemedText>
        </Pressable>

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
            <ThemedText type="small" style={{ color: theme.accent }}>
              {t('auth.changeNumber')}
            </ThemedText>
          </Pressable>
        ) : null}

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
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    flexGrow: 1,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: -Spacing.two,
  },
  field: {
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 52,
    fontSize: 17,
    paddingVertical: Spacing.two,
    ...(Platform.OS === 'android' ? { paddingVertical: 0 } : {}),
  },
  error: {
    textAlign: 'center',
  },
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
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
  helpText: {
    flex: 1,
  },
});