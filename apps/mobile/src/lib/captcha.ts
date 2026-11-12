/**
 * The CAPTCHA gate on the OTP endpoint.
 *
 * WHY THIS EXISTS
 *
 * Supabase's production checklist asks for it, and the reason is money: once a
 * real SMS provider is connected, every `signInWithOtp` call sends a text that
 * somebody pays for. An unauthenticated endpoint that sends paid SMS is a bill
 * waiting to be run up by a script. The gate is what stops it.
 *
 * THE ONE THING THAT MAKES THIS WORK
 *
 * Supabase's own switch ("enable CAPTCHA protection") makes GoTrue *demand* a
 * token on every OTP request. So the app-side gate must be built and working
 * BEFORE the switch is flipped — flipping it first breaks sign-in for every
 * customer, not just the attackers.
 *
 * THE OTHER THING THAT MAKES THIS WORK
 *
 * A token is single-use and expires. One token fetched at mount does not protect
 * a customer who took four minutes to read the screen: by the time they tap
 * *Send code*, the token is stale and the request is refused for a reason the
 * customer cannot understand. So a fresh token is taken per attempt, and this
 * module is where that rule lives.
 *
 * This module is PURE. It decides whether the gate is on, whether a token is
 * still good, and what the SDK is told — it never touches the network or the
 * widget. `scripts/check-captcha.mjs` proves those decisions; the widget itself
 * (`src/components/captcha-gate.tsx`) needs a real device and a real Cloudflare
 * site key, which is stated in PRODUCTION.md rather than claimed here.
 */

/** Cloudflare Turnstile: invisible-first, free, and what Supabase documents. */
export const CAPTCHA_PROVIDER = 'turnstile' as const;

/**
 * The PUBLIC site key. Publishable by design — it is `EXPO_PUBLIC_`, so it is
 * in the shipped bundle, exactly like the Supabase anon key. The *secret* key
 * never leaves the Supabase dashboard.
 */
export const CAPTCHA_SITE_KEY: string =
  (process.env.EXPO_PUBLIC_CAPTCHA_SITE_KEY ?? '').trim();

/**
 * Cloudflare's own tokens expire after 300 seconds. Asking early enough that a
 * slow reader still has a live token, and late enough that it is not thrown away
 * the moment it is issued.
 */
export const CAPTCHA_TOKEN_TTL_MS = 120_000;

/** Turnstile tokens are long opaque strings; anything else is not one. */
const TOKEN_MIN_LENGTH = 20;
const TOKEN_MAX_LENGTH = 4096;

/**
 * The gate is on ONLY when a site key is configured. With no key the app
 * behaves exactly as it always has, which is what lets the shop run, and this
 * work be tested, before an account exists.
 */
export function isCaptchaEnabled(): boolean {
  return CAPTCHA_SITE_KEY.length > 0;
}

/**
 * Is this a token Cloudflare could have issued?
 *
 * A shape check, not a verification — the server verifies. It exists so the
 * three failure modes that actually happen in React Native are caught before a
 * request: an empty string (the widget had not answered yet), `undefined`
 * unwrapped into the JSON body as a missing field, and an HTML error page that
 * a captive portal served instead of the script.
 */
export function captchaTokenLooksValid(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const value = token.trim();
  if (value.length < TOKEN_MIN_LENGTH || value.length > TOKEN_MAX_LENGTH) return false;
  // No whitespace, and printable ASCII only: a real token has neither.
  return /^[\x21-\x7e]+$/.test(value);
}

/** A token with the moment it was issued, so age can be judged. */
export type CaptchaToken = {
  token: string;
  issuedAt: number;
};

/**
 * A token is usable when it looks right AND was issued recently enough that
 * Cloudflare has not expired it. `now` is injected so the rule can be tested
 * without a clock.
 */
export function captchaTokenIsFresh(
  held: CaptchaToken | null,
  now: number = Date.now(),
): held is CaptchaToken {
  if (!held) return false;
  if (!captchaTokenLooksValid(held.token)) return false;
  return now - held.issuedAt < CAPTCHA_TOKEN_TTL_MS;
}

/**
 * What to pass to Supabase, or nothing at all.
 *
 * `undefined` means "no captcha for this request", which is only ever correct
 * when the gate is off. When the gate is ON and the token is missing or stale
 * the caller must not send the request, so this returns null and the caller
 * shows the customer a sentence instead of a server refusal they cannot read.
 */
export function captchaOptions(
  held: CaptchaToken | null,
  now: number = Date.now(),
): { captchaToken: string } | null {
  if (!isCaptchaEnabled()) return null;
  if (!captchaTokenIsFresh(held, now)) return null;
  return { captchaToken: held.token };
}

/**
 * The reason the gate could not produce an option, for the error box. Kept as a
 * small union so the screen words stay in one place and `check-captcha` can
 * prove each one is translated.
 */
export type CaptchaProblem = 'not_ready' | 'stale' | 'failed';

export function captchaProblem(
  held: CaptchaToken | null,
  now: number = Date.now(),
): CaptchaProblem | null {
  if (captchaTokenIsFresh(held, now)) return null;
  return held ? 'stale' : 'not_ready';
}

/**
 * The page Turnstile loads. A page and not a URL, because a file:// or a
 * localhost origin makes Cloudflare refuse to run — and there is no key in it,
 * so nothing here is secret.
 */
export function captchaHtml(siteKey: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0">
<div id="slot"></div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<script>
  var widgetId = null;
  function render() {
    if (!window.turnstile || widgetId !== null) return;
    widgetId = window.turnstile.render('#slot', {
      sitekey: ${JSON.stringify(siteKey)},
      appearance: 'interaction-only',
      callback: function (token) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'token', token: token }));
      },
      'error-callback': function () {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error' }));
      }
    });
  }
  window.turnstile_ready = render;
  window.addEventListener('load', function () {
    if (window.turnstile) render();
    else setTimeout(render, 500);
  });
  // The app asks for a fresh token before each attempt. One listener, because
  // react-native-webview dispatches on window and a double reset would spend
  // two challenges for one tap.
  window.addEventListener('message', function (event) {
    var data = JSON.parse(event.data || '{}');
    if (data.type === 'reset' && window.turnstile && widgetId !== null) {
      window.turnstile.reset(widgetId);
    }
  });
</script>
</body>
</html>`;
}
