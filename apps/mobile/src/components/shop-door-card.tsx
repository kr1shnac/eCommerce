import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Radii, Spacing } from '@/constants/theme';
import { useSetShopOpen, useStoreSettings } from '@/hooks/use-shop';
import { useTheme } from '@/hooks/use-theme';

/**
 * The shop's door, on the owner's Today screen.
 *
 * WHY THIS IS THE FIRST CARD
 *
 * "We are closed" is the most time-critical thing a shop ever says. `place_order()`
 * has refused a closed shop since migration 08, but until now the only way to
 * set `is_open` was the web panel or raw SQL — so a shop that shut early kept
 * taking orders it could not deliver, and every one of those became a refund and
 * an apology.
 *
 * The write goes through `set_shop_open()`, never a plain `.update()`: a
 * non-admin's direct update touches zero rows and raises nothing, so a button
 * built on it would say "Closed" while the shop stayed open (the same lie rule
 * 9.4 is about). The RPC raises instead, and the hook writes the STORED row back
 * into the settings cache, so this card and the customer's checkout agree.
 *
 * Three states, as rule 9.2 requires: loading, failed (with the button still
 * there to retry), and the real state. No raw error text reaches the owner.
 */
export function ShopDoorCard() {
  const { t } = useTranslation();
  const theme = useTheme();

  const settings = useStoreSettings();
  const toggle = useSetShopOpen();

  const open = settings.data?.is_open ?? null;
  const busy = toggle.isPending;

  const onPress = () => {
    if (open === null || busy) return;
    toggle.mutate(!open);
  };

  return (
    <Card tone={open === false ? 'warning' : 'surface'}>
      <View style={styles.heading}>
        <ThemedText type="subtitle">{t('admin.shopDoorTitle')}</ThemedText>
        {open !== null ? (
          <ThemedText
            type="smallBold"
            style={{ color: open ? theme.successInk : theme.warningInk }}>
            {open ? t('admin.shopDoorOpenNow') : t('admin.shopDoorClosedNow')}
          </ThemedText>
        ) : null}
      </View>

      {settings.isLoading ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {t('admin.shopDoorLoading')}
        </ThemedText>
      ) : settings.isError || open === null ? (
        // The door cannot be read, so it cannot be changed safely either. Say so
        // rather than showing a switch whose position is a guess.
        <ThemedText type="small" style={{ color: theme.dangerInk }}>
          {t('admin.shopDoorUnknown')}
        </ThemedText>
      ) : (
        <>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {open ? t('admin.shopDoorOpenHint') : t('admin.shopDoorClosedHint')}
          </ThemedText>

          <Pressable
            onPress={onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={open ? t('admin.shopDoorClose') : t('admin.shopDoorOpenAction')}
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [
              styles.button,
              open
                ? {
                    backgroundColor: theme.dangerSoft,
                    borderColor: theme.danger,
                  }
                : {
                    backgroundColor: theme.accent,
                    borderColor: theme.accent,
                  },
              { opacity: busy ? 0.55 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText
              type="bodyStrong"
              style={{ color: open ? theme.dangerInk : theme.onAccent }}>
              {busy ? t('common.pleaseWait') : open ? t('admin.shopDoorClose') : t('admin.shopDoorOpenAction')}
            </ThemedText>
          </Pressable>

          {toggle.isError ? (
            <ThemedText type="caption" style={{ color: theme.dangerInk }}>
              {t('admin.shopDoorFailed')}
            </ThemedText>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  button: {
    minHeight: 48,
    borderRadius: Radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    marginTop: Spacing.one,
  },
});
