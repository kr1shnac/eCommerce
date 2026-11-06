import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  mapsDirectionsUrl,
  mapsPlaceUrl,
  type NavigationTarget,
  type TravelMode,
} from '@/lib/navigation-links';

type NavigateButtonProps = {
  target: NavigationTarget;
  /** `directions` = take me there (rider). `place` = show me this spot (customer). */
  mode?: 'directions' | 'place';
  travelMode?: TravelMode;
  /** Outline by default: the loud button on a card is the one that moves the order. */
  variant?: 'outline' | 'primary';
  style?: object;
};

/**
 * "Take me there", with no map vendor and no API key.
 *
 * This is the one piece of the tracking design that ships without the owner's
 * map decision (`SCALE-AND-TRACKING.md` §6.2). It builds a plain HTTPS Google
 * Maps URL — `lib/navigation-links.ts`, proved by `scripts/check-navigation.mjs`
 * — and hands it to the phone, which opens the installed maps app when it has
 * one and the browser when it does not. There is no SDK, no WebView, no tile, no
 * dot and no key compiled into the app.
 *
 * The failure is ordinary and in the customer's language: a phone with no maps
 * app and no internet is a real thing in Kunigal, and it must say "could not
 * open the maps app" in Kannada rather than throwing or silently doing nothing.
 * Nothing is opened when the target is empty — the button is simply not offered.
 */
export function NavigateButton({
  target,
  mode = 'directions',
  travelMode = 'two_wheeler',
  variant = 'outline',
  style,
}: NavigateButtonProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [failed, setFailed] = useState(false);

  const url =
    mode === 'place' ? mapsPlaceUrl(target) : mapsDirectionsUrl(target, travelMode);

  // Nothing to navigate to: no fix and no address. Offering a button that opens
  // an empty search would be worse than not offering one.
  if (!url) return null;

  const onPress = () => {
    setFailed(false);
    void Linking.openURL(url).catch(() => setFailed(true));
  };

  return (
    <>
      <Button
        label={mode === 'place' ? t('navigate.openInMaps') : t('navigate.navigate')}
        icon="navigate-circle-outline"
        variant={variant}
        accessibilityLabel={mode === 'place' ? t('navigate.openInMaps') : t('navigate.navigate')}
        onPress={onPress}
        style={style}
      />
      {failed ? (
        <ThemedText type="caption" style={{ color: theme.danger, marginTop: Spacing.one }}>
          {t('navigate.navigateFailed')}
        </ThemedText>
      ) : null}
    </>
  );
}
