/**
 * The pure rules behind the Kannada speech feature (register H4).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `speech.ts`. `speech.ts` imports
 * `expo-speech`, which pulls in native code and therefore **cannot be imported
 * under Node** — so nothing in it can be unit-tested off-device. That is exactly
 * how the voice-matching rule goes silently wrong, because the failure is not a
 * crash: an exact `=== 'kn-IN'` comparison reports "no voice" on a phone that has
 * one, and the feature simply switches itself off for the people it was built for.
 *
 * So the decision that matters is here, in a module with no native import, and
 * `scripts/check-speech.mjs` asserts it directly. This is the same split as
 * `src/lib/order-view.ts` (pure, tested) versus the screens that render it.
 */

/**
 * The BCP-47 tag for Kannada as spoken in Karnataka. `kn` alone is accepted by some
 * engines, but `kn-IN` is what Android's TTS reports and what iOS uses, so it is
 * what we ask for.
 */
export const KANNADA_TAG = 'kn-IN';

/**
 * Does this voice language tag mean Kannada?
 *
 * **Not an equality check**, deliberately. Engines report the same language in
 * different spellings — `kn-IN` on iOS, `kn_IN` from some Android engines,
 * `kn-in` from others, occasionally bare `kn` — and comparing against one string
 * silently reports "no Kannada voice" on a phone that has one. That failure is
 * invisible: the button just never appears.
 *
 * Normalising first (lower-case, `_` to `-`) then matching the `kn` primary subtag
 * covers all of them. A tag that merely *starts with the letters* is still rejected:
 * `"kannada"` normalises to `kannada`, which does not start `kn-` and is not `kn`,
 * so the English word does not pass as the language tag.
 */
export function isKannadaVoiceTag(tag: string | null | undefined): boolean {
  const normalised = (tag ?? '').toLowerCase().replace(/_/g, '-');
  return normalised === 'kn' || normalised === KANNADA_TAG || normalised.startsWith('kn-');
}

/**
 * Speak slowly. A price read at normal speed is not a price — 0.9 is the same
 * choice the shop's own helper would make reading a bill out loud.
 */
export const SPEECH_RATE = 0.9;

/** The AsyncStorage-independent shape `getAvailableVoicesAsync` returns, trimmed. */
export type VoiceLike = { language?: string | null };

/** True when any of the device's voices is a Kannada one. */
export function hasKannadaAmong(voices: readonly VoiceLike[]): boolean {
  return voices.some((voice) => isKannadaVoiceTag(voice.language));
}

/**
 * The sentence to read out for a product, in the shop's own voice.
 *
 * Built from **already-translated** pieces — `name_kn` from the database and the
 * caller's `t('speech.priceLine')` — rather than a new hard-coded string, so the
 * spoken sentence cannot drift from what the screen shows (Rule 2).
 *
 * The price arrives as a **formatted Kannada string** (`೧೪೫`), not a number; see
 * `formatPaiseForSpeech` in `money.ts`, which exists because `formatPaise` returns
 * typography (`"₹145.00"`) that a speech engine mangles.
 *
 * Lives in this file rather than `speech.ts` so it can be asserted off-device — a
 * `{brace}` left unfilled is read aloud to the customer verbatim.
 */
export function spokenProductLine(
  nameKn: string,
  unit: string,
  priceSpeech: string,
  template: string,
): string {
  return template
    .replace('{name}', nameKn)
    .replace('{quantity}', unit)
    .replace('{amount}', priceSpeech);
}
