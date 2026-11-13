import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { kannadaInputFont } from '@/constants/fonts';
import { Radii, Spacing } from '@/constants/theme';
import { useUpdateDeliverySettings, useStore, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';
import { isUsableFix, radiusKmLabel } from '@/lib/geo';
import { currentFix, hasLocationRuntime, requestForegroundPermission } from '@/lib/location';
import { currentLanguage } from '@/store/language-store';
import type { Store, StoreSettings } from '@/types/database';

/**
 * The delivery area, on the owner's Today screen.
 *
 * WHY THE OWNER NEEDS THIS ON A PHONE
 *
 * `place_order()` has decided delivery by pincode since migration 08. The radius
 * rule (migration 20261112000004) made the shop's reach a NUMBER — 10 km today —
 * and a number the owner cannot change is not a setting, it is a hard-coded
 * decision wearing a column name. Kunigal is small now; the day the shop buys a
 * second bike, the owner must be able to type 15 and be done.
 *
 * WHAT IT WRITES
 *
 * One call, `update_delivery_settings()`, in one transaction: the radius, the
 * express promise, and the shop's own pin. Never a plain `.update()` — a
 * non-admin's direct update touches zero rows and raises nothing, so a save
 * button built on it would report success while saving nothing (rule 9.4). The
 * RPC raises instead, and returns the STORED rows, which the hook writes back
 * into the cache so this card and the customer's checkout agree.
 *
 * WHY THE FORM IS A CHILD COMPONENT WITH A KEY
 *
 * The inputs are seeded from the database at mount. Keying the form on the
 * stored `updated_at` means a successful save (or another phone's save arriving
 * through the cache) remounts it with what the database actually holds — no
 * effect, no stale draft, and no chance of showing a number that was never
 * written.
 *
 * NO ONLINE-PAYMENT SWITCH HERE, deliberately. `store_settings.online_payments_enabled`
 * stays false until the shop can really collect the money; flipping it before
 * then would let a customer place a UPI order nobody can settle. It is moved by
 * SQL, on purpose, and PRODUCTION.md says so.
 */
export function DeliverySettingsCard() {
  const { t } = useTranslation();
  const theme = useTheme();

  const settings = useStoreSettings();
  const store = useStore();

  return (
    <Card>
      <View style={styles.heading}>
        <Ionicons name="navigate-outline" size={18} color={theme.textSecondary} />
        <ThemedText type="subtitle" style={styles.flex}>
          {t('admin.deliveryTitle')}
        </ThemedText>
        {settings.data ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {t('admin.deliveryRadiusValue', {
              radius: radiusKmLabel(settings.data.delivery_radius_m),
            })}
          </ThemedText>
        ) : null}
      </View>

      {settings.isLoading || store.isLoading ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {t('admin.deliveryLoading')}
        </ThemedText>
      ) : settings.isError || store.isError || !settings.data || !store.data ? (
        <View style={styles.failed}>
          <ThemedText type="small" style={{ color: theme.dangerInk }}>
            {t('admin.deliveryErrorTitle')}
          </ThemedText>
          <Button
            label={t('common.retry')}
            variant="outline"
            onPress={() => {
              void settings.refetch();
              void store.refetch();
            }}
          />
        </View>
      ) : (
        <DeliveryForm
          key={`${settings.data.updated_at}:${settings.data.delivery_radius_m}:${store.data.lat ?? 'x'},${store.data.lng ?? 'x'}`}
          settings={settings.data}
          store={store.data}
        />
      )}
    </Card>
  );
}

/** Rupees as typed -> integer paise. One conversion, here, and never again. */
function toPaise(text: string): number | null {
  const cleaned = text.trim().replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Kilometres as typed -> integer metres. 7.5 -> 7500. */
function toMetres(text: string): number | null {
  const cleaned = text.trim().replace(/[, ]/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 1000);
}

/** 10000 -> "10", 7500 -> "7.5" — what the owner reads back. */
function kmText(metres: number): string {
  return String(Math.round(metres / 100) / 10);
}

/** 2000 -> "20", 2550 -> "25.5". */
function rupeeText(paise: number): string {
  return String(Math.round(paise) / 100);
}

const RADIUS_MIN_KM = 0.5;
const RADIUS_MAX_KM = 50;
const ETA_MIN = 10;
const ETA_MAX = 180;
const UNITS_MIN = 1;
const UNITS_MAX = 200;

function DeliveryForm({ settings, store }: { settings: StoreSettings; store: Store }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const save = useUpdateDeliverySettings();

  const [radius, setRadius] = useState(() => kmText(settings.delivery_radius_m));
  const [expressOn, setExpressOn] = useState(settings.express_enabled);
  const [expressRadius, setExpressRadius] = useState(() => kmText(settings.express_radius_m));
  const [eta, setEta] = useState(String(settings.express_eta_minutes));
  const [fee, setFee] = useState(() => rupeeText(settings.express_fee_paise));
  const [units, setUnits] = useState(String(settings.express_max_units));
  const [pinRequired, setPinRequired] = useState(settings.address_pin_required);

  const [locating, setLocating] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pin =
    isUsableFix(store.lat, store.lng) && store.lat !== null && store.lng !== null
      ? { lat: store.lat, lng: store.lng }
      : null;

  /**
   * The same bounds `update_delivery_settings()` checks, checked here first so
   * the owner reads a sentence instead of a Postgres error code. The database
   * still decides — this cannot let a bad value through (rule 9.1).
   */
  const validate = (): {
    radiusM: number;
    expressRadiusM: number;
    etaMinutes: number;
    feePaise: number;
    maxUnits: number;
  } | null => {
    const radiusM = toMetres(radius);
    if (radiusM === null || radiusM < RADIUS_MIN_KM * 1000 || radiusM > RADIUS_MAX_KM * 1000) {
      setProblem(t('admin.deliveryRadiusError', { min: RADIUS_MIN_KM, max: RADIUS_MAX_KM }));
      return null;
    }

    const expressRadiusM = toMetres(expressRadius);
    if (
      expressRadiusM === null ||
      expressRadiusM < RADIUS_MIN_KM * 1000 ||
      expressRadiusM > RADIUS_MAX_KM * 1000
    ) {
      setProblem(t('admin.deliveryRadiusError', { min: RADIUS_MIN_KM, max: RADIUS_MAX_KM }));
      return null;
    }
    if (expressRadiusM > radiusM) {
      setProblem(t('admin.expressRadiusError'));
      return null;
    }

    const etaMinutes = /^\d+$/.test(eta.trim()) ? Number(eta.trim()) : null;
    if (etaMinutes === null || etaMinutes < ETA_MIN || etaMinutes > ETA_MAX) {
      setProblem(t('admin.expressEtaError', { min: ETA_MIN, max: ETA_MAX }));
      return null;
    }

    const feePaise = toPaise(fee);
    if (feePaise === null || feePaise < 0) {
      setProblem(t('admin.expressFeeError'));
      return null;
    }

    const maxUnits = /^\d+$/.test(units.trim()) ? Number(units.trim()) : null;
    if (maxUnits === null || maxUnits < UNITS_MIN || maxUnits > UNITS_MAX) {
      setProblem(t('admin.expressUnitsError', { min: UNITS_MIN, max: UNITS_MAX }));
      return null;
    }

    return { radiusM, expressRadiusM, etaMinutes, feePaise, maxUnits };
  };

  const onSave = async () => {
    if (save.isPending) return;
    setProblem(null);
    setSaved(false);

    const values = validate();
    if (!values) return;

    try {
      await save.mutateAsync({
        deliveryRadiusM: values.radiusM,
        expressEnabled: expressOn,
        expressRadiusM: values.expressRadiusM,
        expressEtaMinutes: values.etaMinutes,
        expressFeePaise: values.feePaise,
        expressMaxUnits: values.maxUnits,
        addressPinRequired: pinRequired,
      });
      setSaved(true);
    } catch (error) {
      // The refusal is for the console; the owner gets a sentence they can act
      // on. A bound the app missed lands here too, which is the point of
      // checking twice.
      console.warn('[admin] could not save delivery settings', error);
      setProblem(t('admin.deliveryError'));
    }
  };

  /**
   * Where the shop is. This is the pin every distance is measured from, so a
   * wrong one makes every radius wrong — which is why it is asked once, here,
   * and shown as a number the owner can compare with the map on their phone.
   */
  const findShop = async () => {
    if (locating || save.isPending) return;
    setLocating(true);
    setPinError(false);
    setProblem(null);
    try {
      if (!hasLocationRuntime()) {
        setPinError(true);
        return;
      }
      const permission = await requestForegroundPermission();
      if (permission !== 'granted') {
        setPinError(true);
        return;
      }
      const fix = await currentFix();
      if (!fix || !isUsableFix(fix.lat, fix.lng)) {
        setPinError(true);
        return;
      }
      await save.mutateAsync({ lat: fix.lat, lng: fix.lng });
      setSaved(true);
    } catch (error) {
      console.warn('[admin] could not save the shop pin', error);
      setProblem(t('admin.deliveryError'));
    } finally {
      setLocating(false);
    }
  };

  const clearShopPin = async () => {
    if (save.isPending) return;
    setProblem(null);
    setSaved(false);
    try {
      await save.mutateAsync({ clearLocation: true });
      setSaved(true);
    } catch (error) {
      console.warn('[admin] could not clear the shop pin', error);
      setProblem(t('admin.deliveryError'));
    }
  };

  const canna = kannadaInputFont(currentLanguage());
  const busy = save.isPending;

  const fieldStyle = [
    styles.input,
    canna,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
  ];

  return (
    <>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        {t('admin.deliveryHint')}
      </ThemedText>

      <Field label={t('admin.deliveryRadius')} hint={t('admin.deliveryRadiusHint')}>
        <View style={styles.inline}>
          <TextInput
            value={radius}
            onChangeText={(text) => setRadius(text.replace(/[^0-9.]/g, '').slice(0, 5))}
            keyboardType="decimal-pad"
            editable={!busy}
            accessibilityLabel={t('admin.deliveryRadius')}
            style={[...fieldStyle, styles.narrow]}
          />
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {t('admin.km')}
          </ThemedText>
        </View>
      </Field>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <ToggleRow
        label={t('admin.expressEnable')}
        hint={t('admin.expressEnableHint')}
        value={expressOn}
        disabled={busy}
        onChange={setExpressOn}
      />

      {expressOn ? (
        <>
          <Field label={t('admin.expressRadius')}>
            <View style={styles.inline}>
              <TextInput
                value={expressRadius}
                onChangeText={(text) => setExpressRadius(text.replace(/[^0-9.]/g, '').slice(0, 5))}
                keyboardType="decimal-pad"
                editable={!busy}
                accessibilityLabel={t('admin.expressRadius')}
                style={[...fieldStyle, styles.narrow]}
              />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {t('admin.km')}
              </ThemedText>
            </View>
          </Field>

          <Field label={t('admin.expressEta')}>
            <View style={styles.inline}>
              <TextInput
                value={eta}
                onChangeText={(text) => setEta(text.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                editable={!busy}
                accessibilityLabel={t('admin.expressEta')}
                style={[...fieldStyle, styles.narrow]}
              />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {t('admin.minutes')}
              </ThemedText>
            </View>
          </Field>

          <Field label={t('admin.expressFee')}>
            <View style={styles.inline}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                ₹
              </ThemedText>
              <TextInput
                value={fee}
                onChangeText={(text) => setFee(text.replace(/[^0-9.]/g, '').slice(0, 7))}
                keyboardType="decimal-pad"
                editable={!busy}
                accessibilityLabel={t('admin.expressFee')}
                style={[...fieldStyle, styles.narrow]}
              />
            </View>
          </Field>

          <Field label={t('admin.expressMaxUnits')} hint={t('admin.expressMaxUnitsHint')}>
            <TextInput
              value={units}
              onChangeText={(text) => setUnits(text.replace(/[^0-9]/g, '').slice(0, 3))}
              keyboardType="number-pad"
              editable={!busy}
              accessibilityLabel={t('admin.expressMaxUnits')}
              style={[...fieldStyle, styles.narrow]}
            />
          </Field>
        </>
      ) : null}

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      <Field label={t('admin.shopPinTitle')} hint={t('admin.shopPinHint')}>
        {pin ? (
          <View style={styles.pinRow}>
            <Ionicons name="location" size={16} color={theme.accent} />
            <ThemedText type="small" style={styles.flex}>
              {t('admin.shopPinSet', {
                lat: pin.lat.toFixed(5),
                lng: pin.lng.toFixed(5),
              })}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.pinRow}>
            <Ionicons name="location-outline" size={16} color={theme.warningInk} />
            <ThemedText type="small" style={[styles.flex, { color: theme.warningInk }]}>
              {t('admin.shopPinMissing')}
            </ThemedText>
          </View>
        )}

        <View style={styles.pinActions}>
          <Button
            label={locating ? t('common.pleaseWait') : t('admin.shopPinUse')}
            icon="navigate"
            variant="outline"
            busy={locating}
            disabled={busy}
            onPress={() => void findShop()}
          />
          {pin ? (
            <Button
              label={t('admin.shopPinClear')}
              variant="ghost"
              disabled={busy}
              onPress={() => void clearShopPin()}
            />
          ) : null}
        </View>

        {pinError ? (
          <ThemedText type="caption" style={{ color: theme.dangerInk }}>
            {t('admin.shopPinFailed')}
          </ThemedText>
        ) : null}
      </Field>

      <View style={[styles.divider, { backgroundColor: theme.border }]} />

      {/*
        The pilot gate. It lives under the shop pin on purpose: the gate reads
        as a quiet lie until the pin exists — `place_order()` lets every order
        through while the shop has no pin of its own, whatever this switch
        says. So the row warns when the pin is missing, and the hint explains
        what turning it on actually does at the door.
      */}
      <ToggleRow
        label={t('admin.addressPinGate')}
        hint={pin ? t('admin.addressPinGateHint') : t('admin.addressPinGateNoPinHint')}
        value={pinRequired}
        disabled={busy}
        onChange={setPinRequired}
      />

      {problem ? (
        <View style={styles.problemRow}>
          <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
          <ThemedText type="caption" style={[styles.flex, { color: theme.danger }]}>
            {problem}
          </ThemedText>
        </View>
      ) : null}

      {saved && !problem ? (
        <View style={styles.problemRow}>
          <Ionicons name="checkmark-circle-outline" size={15} color={theme.successInk} />
          <ThemedText type="caption" style={{ color: theme.successInk }}>
            {t('admin.deliverySaved')}
          </ThemedText>
        </View>
      ) : null}

      <Button
        label={busy ? t('common.pleaseWait') : t('admin.deliverySave')}
        icon="save-outline"
        fullWidth
        busy={busy}
        onPress={() => void onSave()}
        style={styles.save}
      />
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {hint ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

/**
 * A labelled on/off row. Built from a Pressable rather than `Switch` so the
 * track and the label use the theme tokens in both light and dark, and so the
 * whole row is one 48 px target (rule 9.9).
 */
function ToggleRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {hint ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.track,
          {
            backgroundColor: value ? theme.accent : theme.backgroundElement,
            borderColor: value ? theme.accent : theme.border,
          },
        ]}>
        <View
          style={[
            styles.knob,
            {
              backgroundColor: value ? theme.onAccent : theme.textSecondary,
              alignSelf: value ? 'flex-end' : 'flex-start',
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  failed: { gap: Spacing.two },
  field: { gap: Spacing.one, marginTop: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  narrow: { width: 96 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.three },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
  },
  track: {
    width: 52,
    height: 32,
    borderRadius: Radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    padding: 3,
  },
  knob: { width: 24, height: 24, borderRadius: Radii.pill },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  pinActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  problemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  save: { marginTop: Spacing.three },
  pressed: { opacity: 0.75 },
});
