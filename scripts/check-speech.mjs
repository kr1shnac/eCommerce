#!/usr/bin/env node
/**
 * check-speech.mjs — the Kannada speech helpers (register H4).
 *
 * Run:  npm run check:speech
 *
 * WHY THIS EXISTS
 *
 * "Listen" reads a product's name and price aloud in Kannada, for the ~31% of
 * Kunigal with low literacy (KUNIGAL.md §3). Two things about it can break
 * silently, in ways no crash and no stack trace would ever reveal:
 *
 *   1. **What the engine is asked to say.** `formatPaise` returns `"₹145.00"` —
 *      typography, not speech. A TTS engine given that reads "rupee symbol one
 *      four five point zero zero", or skips the currency and says a bare number.
 *      So speech gets its own formatter, and this checks the string it produces
 *      really is something a Kannada voice can read.
 *   2. **Whether a Kannada voice is claimed to exist.** Matching voice language
 *      tags with an exact `=== 'kn-IN'` comparison reports "no voice" on a phone
 *      that has one, because engines report `kn_IN` and `kn-in`. That turns the
 *      feature off for exactly the people it was built for, with no error.
 *
 * `formatPaiseForSpeech` and `toKannadaDigits` are pure and are imported from the
 * real app module. The voice-tag matcher is the one piece of `speech.ts` that
 * touches the OS, so the rule is extracted and asserted here rather than only
 * living inside an `await`.
 *
 * WHAT IT PROVES
 *
 *   1. `toKannadaDigits` maps 0-9 to `೦`-`೯` and leaves everything else alone.
 *   2. `formatPaiseForSpeech` writes the rupee word out, drops the `.00`, and
 *      stays in integer paise (Rule 1: no float, no rupee arithmetic).
 *   3. Paise are spoken only when there are any — "೧೪೫ ರೂಪಾಯಿ ೦೦ ಪೈಸೆ" is noise.
 *   4. `spokenProductLine` fills every placeholder and leaves no `{brace}` behind
 *      (a stray `{amount}` read aloud is the exact failure Rule 2 warns about).
 *   5. Voice tags match across the spellings real engines report, and a non-Kannada
 *      tag never matches.
 *   6. Null/undefined/NaN money does not throw and does not print "NaN".
 *
 * What this does NOT prove: that any phone actually speaks. That needs a device
 * (PRODUCTION.md §5), and it is the feature's entire point.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { formatPaiseForSpeech, toKannadaDigits } = await import(
  pathToFileURL(join(root, 'apps/mobile/src/lib/money.ts')).href
);
// `speech-rules.ts` is imported, NOT `speech.ts`: the latter imports `expo-speech`,
// which pulls in native code and cannot load under Node. The rules were split out
// for exactly this reason — see the module's own comment.
const { isKannadaVoiceTag, hasKannadaAmong, spokenProductLine, KANNADA_TAG, SPEECH_RATE } =
  await import(pathToFileURL(join(root, 'apps/mobile/src/lib/speech-rules.ts')).href);

let failures = 0;
function expect(name, actual, wanted) {
  const a = JSON.stringify(actual);
  const w = JSON.stringify(wanted);
  const ok = a === w;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ${w}\n        got    ${a}`);
}
function expectTrue(name, ok) {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

// The words come from kn.json in the real app; passed in so money.ts stays free
// of translations, exactly as the module documents.
const RUPEES = 'ರೂಪಾಯಿ';
const PAISE = 'ಪೈಸೆ';

console.log('=== 1. ASCII digits become Kannada digits ===');
expect('independent digits', toKannadaDigits('0123456789'), '೦೧೨೩೪೫೬೭೮೯');
expect('a number in context', toKannadaDigits('145'), '೧೪೫');
expect('non-digits are untouched', toKannadaDigits('1.4x'), '೧.೪x');
expect('an empty string stays empty', toKannadaDigits(''), '');

console.log('\n=== 2. a spoken price, written for a voice ===');
// Whole rupees: no paise clause at all.
expect('₹145.00 speaks as ೧೪೫ ರೂಪಾಯಿ',
  formatPaiseForSpeech(14500, RUPEES, PAISE), `೧೪೫ ${RUPEES}`);
// The symbol and the decimals are typography. Neither may reach the engine.
expectTrue('no rupee glyph', !formatPaiseForSpeech(14500, RUPEES, PAISE).includes('₹'));
expectTrue('no decimal point', !formatPaiseForSpeech(14500, RUPEES, PAISE).includes('.'));
expectTrue('no Western digits', !/[0-9]/.test(formatPaiseForSpeech(14500, RUPEES, PAISE)));
// With paise, both parts are said.
expect('₹145.50 speaks as ೧೪೫ ರೂಪಾಯಿ ೫೦ ಪೈಸೆ',
  formatPaiseForSpeech(14550, RUPEES, PAISE), `೧೪೫ ${RUPEES} ೫೦ ${PAISE}`);
// A tiny amount must not read as "೦ ರೂಪಾಯಿ ೫೦ ಪೈಸೆ" — the rupees are still said,
// because "fifty paise" alone is right but "zero rupees" is embarrassing.
expect('₹0.50 keeps the rupee word',
  formatPaiseForSpeech(50, RUPEES, PAISE), `೦ ${RUPEES} ೫೦ ${PAISE}`);
expect('₹1 speaks as one rupee',
  formatPaiseForSpeech(100, RUPEES, PAISE), `೧ ${RUPEES}`);

console.log('\n=== 3. money is still integer paise (Rule 1) ===');
// The argument is paise and nothing here does rupee arithmetic.
expect('100 paise is one rupee, not one hundred',
  formatPaiseForSpeech(100, RUPEES, PAISE), `೧ ${RUPEES}`);
expect('99999 paise is 999 rupees 99 paise',
  formatPaiseForSpeech(99999, RUPEES, PAISE), `೯೯೯ ${RUPEES} ೯೯ ${PAISE}`);
// A price with sub-paise precision is rounded, never printed as a fraction.
expect('rounds a fractional paise', formatPaiseForSpeech(14500.4, RUPEES, PAISE), `೧೪೫ ${RUPEES}`);
expect('no stray decimal from rounding',
  formatPaiseForSpeech(99999.6, RUPEES, PAISE), `೧೦೦೦ ${RUPEES}`);

console.log('\n=== 4. missing money never says "NaN" out loud ===');
// A screen can render before its data resolves. Reading "NaN rupees" aloud would
// be worse than reading nothing.
expect('null', formatPaiseForSpeech(null, RUPEES, PAISE), `೦ ${RUPEES}`);
expect('undefined', formatPaiseForSpeech(undefined, RUPEES, PAISE), `೦ ${RUPEES}`);
expect('NaN', formatPaiseForSpeech(NaN, RUPEES, PAISE), `೦ ${RUPEES}`);
expectTrue('the string "NaN" never appears',
  !formatPaiseForSpeech(NaN, RUPEES, PAISE).includes('NaN'));

console.log('\n=== 5. the spoken sentence has no unfilled placeholder ===');
// This is the Rule 2 failure mode: a `{brace}` read aloud to a customer verbatim.
const line = spokenProductLine(
  'ಅಕ್ಕಿ', '೧ ಕೆ.ಜಿ', `೧೪೫ ${RUPEES}`, '{name}, {quantity}, {amount}',
);
expect('every placeholder is filled', line, `ಅಕ್ಕಿ, ೧ ಕೆ.ಜಿ, ೧೪೫ ${RUPEES}`);
expectTrue('no brace survives', !/[{}]/.test(line));

// The cart reuses the same helper for the total, passing empty name and unit.
const total = spokenProductLine('', '', `೧೪೫ ${RUPEES}`, 'ಒಟ್ಟು {amount}');
expect('the cart total template', total, `ಒಟ್ಟು ೧೪೫ ${RUPEES}`);
expectTrue('empty name and unit leave no stray comma', !total.includes(','));
expectTrue('the total has no brace either', !/[{}]/.test(total));

// A product whose Kannada name is somehow empty must not produce ", , ೧೪೫ ರೂಪಾಯಿ".
const blankName = spokenProductLine('', '೧ ಕೆ.ಜಿ', `೧೪೫ ${RUPEES}`, '{name}, {quantity}, {amount}');
expectTrue('an empty name does not break the template', /೧೪೫/.test(blankName));

console.log('\n=== 6. voice tags match the spellings real engines report ===');
// The REAL matcher from the app module, not a copy. A copied rule in a test is a
// test that passes while the app is broken.
const matchesKannada = isKannadaVoiceTag;
// What Android and iOS actually report, which is not one string.
expectTrue('kn-IN (the canonical tag)', matchesKannada('kn-IN'));
expectTrue('kn_IN (underscore, as some engines report)', matchesKannada('kn_IN'));
expectTrue('kn-in (lower case)', matchesKannada('kn-in'));
expectTrue('kn (bare)', matchesKannada('kn'));
expectTrue('kn-IN-x-foo (an extended variant)', matchesKannada('kn-IN-x-foo'));
// And the ones that must NOT match, or the app reads Kannada in an English voice.
expectTrue('en-IN does not match', matchesKannada('en-IN') === false);
expectTrue('hi-IN (Hindi) does not match', matchesKannada('hi-IN') === false);
expectTrue('te-IN (Telugu) does not match', matchesKannada('te-IN') === false);
expectTrue('an empty tag does not match', matchesKannada('') === false);
expectTrue('null does not match', matchesKannada(null) === false);
expectTrue('undefined does not match', matchesKannada(undefined) === false);
// The trap: `kannada` starts with "kn" but is not the language tag.
expectTrue('"kannada" the word does not match', matchesKannada('kannada') === false);
// `kn` as part of a longer tag that is not Kannada must not match either.
expectTrue('"knx" does not match', matchesKannada('knx') === false);

console.log('\n=== 7. which voices count, and the constants the engine is given ===');
// A device with only English and Hindi must NOT be considered to have Kannada.
expectTrue('no Kannada among en-IN + hi-IN',
  hasKannadaAmong([{ language: 'en-IN' }, { language: 'hi-IN' }]) === false);
expectTrue('Kannada among many', hasKannadaAmong([
  { language: 'en-IN' }, { language: 'kn_IN' }, { language: 'hi-IN' },
]) === true);
expectTrue('a voice with no language field is skipped',
  hasKannadaAmong([{ language: null }, { language: undefined }]) === false);
expectTrue('an empty voice list has no Kannada', hasKannadaAmong([]) === false);
// The constants matter: a wrong tag means the engine is asked for the wrong voice,
// and a rate of 1.5 makes a price unreadable.
expect('the tag the engine is asked for', KANNADA_TAG, 'kn-IN');
expectTrue('the speaking rate is slower than normal, not faster',
  SPEECH_RATE > 0 && SPEECH_RATE < 1);

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
