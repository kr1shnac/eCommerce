import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
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
import { useAddAddress } from '@/hooks/use-orders';
import { useDeliveryZones } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';

/**
 * Add a delivery address.
 *
 * The pincode is checked against the shop's delivery zones as the customer
 * types, so somebody in a village the shop does not serve finds out before they
 * fill in the rest. place_order() checks it again, because this check is a
 * courtesy, not a security control.
 */
export default function NewAddressScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pick?: string }>();

  const zones = useDeliveryZones();
  const addAddress = useAddAddress();

  const [label, setLabel] = useState('Home');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('Kunigal');
  const [pincode, setPincode] = useState('');
  const [touched, setTouched] = useState(false);

  const pincodeValue = pincode.trim();
  const zone = zones.data?.find((candidate) => candidate.pincode === pincodeValue);
  const pincodeLooksReal = /^\d{6}$/.test(pincodeValue);
  const isServed = zone !== undefined;

  const isValid =
    fullName.trim().length >= 2 &&
    phone.replace(/\D/g, '').length >= 10 &&
    line1.trim().length >= 4 &&
    city.trim().length >= 2 &&
    pincodeLooksReal &&
    isServed;

  const onSave = async () => {
    setTouched(true);
    if (!isValid || addAddress.isPending) return;

    try {
      const saved = await addAddress.mutateAsync({
        label: label.trim() || 'Home',
        full_name: fullName.trim(),
        phone: phone.trim(),
        line1: line1.trim(),
        line2: line2.trim() || null,
        landmark: landmark.trim() || null,
        city: city.trim(),
        pincode: pincodeValue,
      });

      // Send the new address straight back to checkout, already ticked, when
      // that is who asked for it. Otherwise go back to the cart.
      if (params.pick === '1') {
        router.replace({ pathname: '/checkout', params: { addressId: (saved as any)?.id } });
      } else {
        router.back();
      }
    } catch (error) {
      console.warn('[address] could not save', error);
    }
  };

  const field = (
    value: string,
    onChange: (text: string) => void,
    labelKey: string,
    options?: {
      placeholder?: string;
      keyboardType?: 'default' | 'phone-pad' | 'number-pad';
      maxLength?: number;
      invalid?: boolean;
    },
  ) => (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {t(labelKey)}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={options?.placeholder ? t(options.placeholder) : undefined}
        placeholderTextColor={theme.textSecondary}
        keyboardType={options?.keyboardType ?? 'default'}
        maxLength={options?.maxLength}
        autoCapitalize="words"
        editable={!addAddress.isPending}
        accessibilityLabel={t(labelKey)}
        style={[
          styles.input,
          { color: theme.text, borderColor: options?.invalid ? theme.danger : theme.border },
        ]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.five },
        ]}
        keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.title}>{t('address.title')}</ThemedText>

        {field(label, setLabel, 'address.label')}
        {field(fullName, setFullName, 'address.fullName', {
          placeholder: 'address.namePlaceholder',
          invalid: touched && fullName.trim().length < 2,
        })}
        {field(phone, setPhone, 'address.phone', {
          placeholder: 'address.phonePlaceholder',
          keyboardType: 'phone-pad',
          maxLength: 12,
          invalid: touched && phone.replace(/\D/g, '').length < 10,
        })}
        {field(line1, setLine1, 'address.line1', {
          placeholder: 'address.line1Placeholder',
          invalid: touched && line1.trim().length < 4,
        })}
        {field(line2, setLine2, 'address.line2')}
        {field(landmark, setLandmark, 'address.landmark')}

        <View style={styles.row}>
          <View style={styles.rowItem}>
            {field(city, setCity, 'address.city', { invalid: touched && city.trim().length < 2 })}
          </View>
          <View style={styles.rowItemSmall}>
            {field(pincode, setPincode, 'address.pincode', {
              placeholder: 'address.pincodePlaceholder',
              keyboardType: 'number-pad',
              maxLength: 6,
              invalid: touched && !pincodeLooksReal,
            })}
          </View>
        </View>

        {pincodeLooksReal ? (
          isServed ? (
            <ThemedText type="small" style={{ color: theme.accent }}>
              {t('address.servedHere', {
                area: t('address.areaName', { name: zone?.area_name_en ?? '' }),
                eta: zone?.eta_minutes ?? 0,
              })}
            </ThemedText>
          ) : (
            <ThemedText type="small" style={{ color: theme.danger }}>
              {t('address.notServed')}
            </ThemedText>
          )
        ) : null}

        {addAddress.isError ? (
          <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
            {t('address.saveError')}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={!isValid || addAddress.isPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isValid, busy: addAddress.isPending }}
          accessibilityLabel={t('address.save')}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent },
            (!isValid || addAddress.isPending) && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}>
          <ThemedText type="smallBold" style={styles.buttonLabel}>
            {addAddress.isPending ? t('common.pleaseWait') : t('address.save')}
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          style={styles.cancelButton}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('common.cancel')}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  field: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rowItem: { flex: 2 },
  rowItemSmall: { flex: 1 },
  input: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: '#ffffff' },
  pressed: { opacity: 0.8 },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});