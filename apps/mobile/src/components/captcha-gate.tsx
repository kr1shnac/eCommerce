import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { CAPTCHA_SITE_KEY, captchaHtml, isCaptchaEnabled } from '@/lib/captcha';

/**
 * The Turnstile widget, in a WebView.
 *
 * Cloudflare's script needs a real browser origin, so it cannot run in a
 * `<Text>`: it runs in a page this module builds in memory. There is no key in
 * that page — the site key is not a secret — and no network call to anywhere
 * except Cloudflare.
 *
 * The widget is normally invisible (`appearance: 'interaction-only'`): it
 * renders nothing at all when it can decide by itself and only asks for a tap
 * when it must. That is what keeps the customer's login to one tap, which is
 * the only way a captcha is acceptable in a town where people are not going to
 * solve a puzzle to buy salt.
 *
 * It is ONE PIXEL, not zero: a zero-height WebView is treated as not-visible by
 * some WebView builds and the script then never runs. One pixel, hidden from
 * screen readers, because there is nothing in it for them to read.
 *
 * `controlsRef` hands the screen a way to ask for a fresh token, which is the
 * whole point: a token is single-use, so every attempt must spend a new one.
 */
export function CaptchaGate({
  onToken,
  onFailure,
  controlsRef,
}: {
  onToken: (token: string) => void;
  onFailure: () => void;
  /** Filled with `{ reset }` so the screen can ask for a new token. */
  controlsRef: React.MutableRefObject<{ reset: () => void } | null>;
}) {
  const webViewRef = useRef<WebView>(null);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: { type?: string; token?: string };
      try {
        data = JSON.parse(event.nativeEvent.data);
      } catch {
        // Not ours. A malformed message is ignored rather than crashing the
        // screen the customer is typing into.
        return;
      }
      if (data.type === 'token' && typeof data.token === 'string') onToken(data.token);
      else if (data.type === 'error') onFailure();
    },
    [onToken, onFailure],
  );

  const reset = useCallback(() => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'reset' }));
  }, []);

  /**
   * Publish the reset handle in an effect, never during render: a ref written
   * while rendering is a ref the next render may not see, and React's rules
   * forbid it outright. The hook only reaches for this after the user taps, by
   * which time the effect has run.
   */
  useEffect(() => {
    controlsRef.current = { reset };
  }, [reset, controlsRef]);

  if (!isCaptchaEnabled()) return null;

  return (
    <View
      style={styles.slot}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: captchaHtml(CAPTCHA_SITE_KEY) }}
        onMessage={onMessage}
        onError={onFailure}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        javaScriptEnabled
        domStorageEnabled
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    height: 1,
    width: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  webview: {
    height: 1,
    width: 1,
    backgroundColor: 'transparent',
  },
});
