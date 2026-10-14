import { Ionicons } from '@expo/vector-icons';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Radii, Spacing } from '@/constants/theme';
import { useAddAddress } from '@/hooks/use-orders';
import { useDeliveryZones } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { localizedName } from '@/lib/localized';

/**
 * Add a delivery address.
 *
 * The pincode is checked against the shop's delivery zones as the customer
 * types, so somebody in a village the shop does not serve finds out before they
 * fill in the rest. place_order() checks it again, because this check is a
 * courtesy, not a security control.
 *
 * The label ("Home" / "Work" / "Other") is three big chips rather than a text
 * box, because typing a word is exactly the thing this audience should not have
 * to do twice. The chosen label is stored as the customer typed it — it is
 * their own name for their own place, so it is not re-translated later.
 */
const LABEL_KEYS = ['address.labelHome', 'address.labelWork', 'address.labelOther'] as const;

export default function NewAddressScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pick?: string }>();

  const zones = useDeliveryZones();
  const addAddress = useAddAddress();

  const [label, setLabel] = useState<string>(t('address.labelHome'));
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
        label: label.trim() || t('address.labelHome'),
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
      <ThemedText type="smallBold" themeColor="textSecondary">
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
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor:
              options?.invalid && touched ? theme.danger : theme.border,
          },
        ]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <OfflineBanner />
      <View style={[styles.headerRow, { paddingTop: insets.top + Spacing.two }]}>
        <IconButton icon="arrow-back" label={t('common.back')} onPress={() => router.back()} />
        <ThemedText type="subtitle">{t('address.title')}</ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {t('address.label')}
          </ThemedText>
          <View style={styles.labelRow}>
            {LABEL_KEYS.map((key) => {
              const value = t(key);
              const active = label === value;
              return (
                <Pressable
                  key={key}
                  onPress={() => setLabel(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={value}
                  style={({ pressed }) => [
                    styles.labelChip,
                    {
                      backgroundColor: active ? theme.accent : theme.backgroundElement,
                      borderColor: active ? theme.accent : theme.border,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={{ color: active ? theme.onAccent : theme.textSecondary }}>
                    {value}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {field(fullName, setFullName, 'address.fullName', {
          placeholder: 'address.namePlaceholder',
          invalid: fullName.trim().length < 2,
        })}
        {field(phone, setPhone, 'address.phone', {
          placeholder: 'address.phonePlaceholder',
          keyboardType: 'phone-pad',
          maxLength: 12,
          invalid: phone.replace(/\D/g, '').length < 10,
        })}
        {field(line1, setLine1, 'address.line1', {
          placeholder: 'address.line1Placeholder',
          invalid: line1.trim().length < 4,
        })}
        {field(line2, setLine2, 'address.line2')}
        {field(landmark, setLandmark, 'address.landmark')}

        <View style={styles.row}>
          <View style={styles.rowItem}>
            {field(city, setCity, 'address.city', { invalid: city.trim().length < 2 })}
          </View>
          <View style={styles.rowItemSmall}>
            {field(pincode, setPincode, 'address.pincode', {
              placeholder: 'address.pincodePlaceholder',
              keyboardType: 'number-pad',
              maxLength: 6,
              invalid: !pincodeLooksReal,
            })}
          </View>
        </View>

        {pincodeLooksReal ? (
          isServed ? (
            <Card tone="accent" style={styles.zoneCard}>
              <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
              <ThemedText type="smallBold" style={[styles.flex, { color: theme.accent }]}>
                {t('address.servedHere', {
                  area: localizedName({
                    name_en: zone?.area_name_en ?? '',
                    name_kn: zone?.area_name_kn ?? null,
                  }),
                  eta: zone?.eta_minutes ?? 0,
                })}
              </ThemedText>
            </Card>
          ) : (
            <Card tone="danger" style={styles.zoneCard}>
              <Ionicons name="close-circle" size={20} color={theme.danger} />
              <ThemedText type="smallBold" style={[styles.flex, { color: theme.dangerInk }]}>
                {t('address.notServed')}
              </ThemedText>
            </Card>
          )
        ) : null}

        {addAddress.isError ? (
          <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
            {t('address.saveError')}
          </ThemedText>
        ) : null}

        <Button
          label={addAddress.isPending ? t('common.pleaseWait') : t('address.save')}
          size="lg"
          fullWidth
          busy={addAddress.isPending}
          disabled={!isValid}
          onPress={() => void onSave()}
          style={styles.saveButton}
        />

        <Button label={t('common.cancel')} variant="ghost" fullWidth onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  field: { gap: Spacing.one },
  labelRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  labelChip: {
    minHeight: 44,
    paddingHorizontal: Spacing.four,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', gap: Spacing.three },
  rowItem: { flex: 2 },
  rowItemSmall: { flex: 1 },
  input: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  zoneCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  saveButton: { marginTop: Spacing.two },
  pressed: { opacity: 0.8 },
});
