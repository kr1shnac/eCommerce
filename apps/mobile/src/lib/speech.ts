import * as Speech from 'expo-speech';

import { KANNADA_TAG, SPEECH_RATE, hasKannadaAmong } from '@/lib/speech-rules';

/**
 * Reading the shop aloud, in Kannada (register H4).
 *
 * WHY THIS IS THE MOST KUNIGAL-SPECIFIC FEATURE ON THE LIST. About 31% of the
 * town has low literacy (KUNIGAL.md §3, from the public record), which makes
 * reading a price on a phone a barrier that has nothing to do with money or
 * interest. But the app already **has** every word in Kannada — `kn.json` and
 * `name_kn` — so reading it aloud costs no new content, only a voice. For someone
 * who cannot comfortably read `₹145.00 / ಕೆ.ಜಿ`, hearing "ಅಕ್ಕಿ, ಒಂದು ಕೆ.ಜಿ, ನೂರ
 * ನಲವತ್ತೈದು ರೂಪಾಯಿ" is the difference between using the app and asking a neighbour.
 *
 * ---------------------------------------------------------------------------
 * THE HONEST LIMITATION, AND WHY IT DRIVES THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 * **The phone may not have a Kannada voice.** `expo-speech` is a thin wrapper over
 * the operating system's own text-to-speech engine. On Android that is usually
 * Google's TTS, whose Kannada data is a separate download that many phones in a
 * small town will simply not have; on iOS it is `AVSpeechSynthesisVoice`. If the
 * voice is missing, the engine does not fail loudly — it reads Kannada text with an
 * English voice, which produces confident nonsense. That is worse than silence,
 * because the customer cannot tell it is wrong.
 *
 * So every entry point here is guarded:
 *
 *   1. `hasKannadaVoice()` asks the device what it actually has, once, and caches
 *      the answer. The matching rule lives in `speech-rules.ts` because it can be
 *      tested there and this file cannot (it imports native code).
 *   2. When there is no Kannada voice, `speakKannada` says so **in Kannada**, in a
 *      sentence written for the purpose (`speech.noVoice`), rather than reading the
 *      text in the wrong voice.
 *   3. The screen only shows the speaker button when `hasKannadaVoice()` is true.
 *      A button that produces gibberish is a button that teaches people the app is
 *      broken.
 *
 * `{ language: KANNADA_TAG }` is passed to the engine as well as being checked,
 * because on Android the *request* is what selects the voice; the check is what
 * tells us whether the request will be honoured.
 */

let cachedSupport: boolean | null = null;
let probe: Promise<boolean> | null = null;

/**
 * Does this device have a Kannada voice?
 *
 * The matching rule itself is `hasKannadaAmong` in `speech-rules.ts` — it cannot
 * live here, because this file imports native code and so cannot be tested off a
 * device, and a wrong rule here is invisible (the button silently never appears).
 *
 * The answer is cached after a **positive** probe only. It is not cached after a
 * negative one, because on Android the voice list is empty until the TTS engine has
 * finished initialising — caching that would permanently disable the feature on a
 * phone that supports it. A failed probe is a `false` that is not remembered.
 */
export async function hasKannadaVoice(): Promise<boolean> {
  if (cachedSupport !== null) return cachedSupport;
  if (probe) return probe;

  probe = (async () => {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      const found = hasKannadaAmong(voices);

      // Only remember a positive. An empty list usually means "the engine has not
      // answered yet", and remembering that would be a permanent wrong answer.
      if (found) cachedSupport = true;
      return found;
    } catch {
      // An engine that cannot be asked is treated as absent, and not remembered —
      // the same reasoning as an empty list.
      return false;
    } finally {
      probe = null;
    }
  })();

  return probe;
}

/** Reset the cached answer. For tests only; nothing in the app calls this. */
export function resetVoiceCache(): void {
  cachedSupport = null;
  probe = null;
}

/**
 * Read Kannada text aloud, or explain honestly that this phone cannot.
 *
 * Returns what actually happened, so a caller can react and a test can assert
 * without a device:
 *   * `'spoken'`   — the engine accepted it with a Kannada voice.
 *   * `'no-voice'` — there is no Kannada voice; the customer was told, in Kannada.
 *   * `'empty'`    — nothing to say.
 *
 * Never throws. A speech failure must never be a crash: this is an accessibility
 * affordance, not a load-bearing path.
 */
export async function speakKannada(
  text: string,
  noVoiceLine: string,
): Promise<'spoken' | 'no-voice' | 'empty'> {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';

  try {
    // One thing at a time. Without this, tapping two prices reads both, in order,
    // and the second one sounds like it belongs to the first product.
    await Speech.stop();

    if (!(await hasKannadaVoice())) {
      await Speech.speak(noVoiceLine, { language: KANNADA_TAG, rate: SPEECH_RATE });
      return 'no-voice';
    }

    await Speech.speak(trimmed, { language: KANNADA_TAG, rate: SPEECH_RATE });
    return 'spoken';
  } catch {
    // Swallowed deliberately. There is nothing useful to show a customer whose
    // phone refused to talk, and the button simply did nothing.
    return 'empty';
  }
}

/** Stop anything currently being read. */
export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // Nothing to stop, or nothing that can stop. Not an error worth surfacing.
  }
}

/**
 * The sentence to read out for a product is `spokenProductLine` in
 * `speech-rules.ts` — pure, and therefore tested off-device. Re-exported here so a
 * screen has one import for the whole feature.
 */
export { spokenProductLine } from '@/lib/speech-rules';
