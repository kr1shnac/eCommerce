import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Button } from '@/components/ui/button';
import { useStoreSettings } from '@/hooks/use-shop';

/**
 * "Call the shop".
 *
 * In a town with one shop, the phone IS the support channel — there is no chat
 * widget and there will not be one. The number comes from `store_settings`
 * (never hard-coded), so the owner can change it from the admin panel without a
 * new build. The button renders nothing at all when no number is set, so it can
 * be dropped onto any screen without a layout hole.
 *
 * It only ever opens the dialler with the number pre-filled; the customer still
 * presses the green button. Nothing is dialled silently.
 */
export function CallShop() {
  const { t } = useTranslation();
  const settings = useStoreSettings();

  const phone = settings.data?.support_phone?.trim();
  if (!phone) return null;

  return (
    <Button
      label={t('support.call')}
      icon="call-outline"
      variant="outline"
      fullWidth
      onPress={() => {
        Linking.openURL(`tel:${phone}`).catch((error) => {
          // A phone with no dialler (rare) must not crash the screen.
          console.warn('[support] could not open dialler', error);
        });
      }}
    />
  );
}
