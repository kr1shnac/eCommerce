#!/usr/bin/env node
/**
 * check-navigation.mjs — the maps link, without a key (SCALE-AND-TRACKING §6.2).
 *
 * Run:  npm run check:navigation
 *
 * WHY THIS EXISTS
 *
 * "Open in maps" was the one piece of the tracking design that could be shipped
 * without a vendor decision, because a phone already has a maps app and Google
 * Maps reads a plain HTTPS URL. The risk is not the URL; it is the three ways a
 * hand-built URL goes wrong silently on a bike at a customer's door:
 *
 *   1. a coordinate that is not a coordinate (NaN, a string, a latitude of 200)
 *      reaches the maps app, which shows an error or — worse — somewhere else;
 *   2. a Kannada address written raw into the query string, which the maps app
 *      reads as garbage;
 *   3. an API key, which turns a free link into a secret in a shipped binary.
 *
 * This asserts all three cannot happen, plus that the link is the honest thing
 * it claims: HTTPS, one origin, no key, directions with no origin (so the
 * phone starts from its own location).
 *
 * WHAT IT DOES NOT PROVE
 *
 * That the maps app exists on any given phone, that it opens the right street,
 * or that a text destination geocodes to the right house. Those are the maps
 * app's job; the URL contract is ours.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  mapsDirectionsUrl,
  mapsPlaceUrl,
  hasNavigationTarget,
  isUsableFix,
} = await import(
  pathToFileURL(join(root, 'apps/mobile/src/lib/navigation-links.ts')).href
);

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

console.log('=== 1. a fix becomes the exact pair, never a coordinate of a string ===');
expect('a good fix is "lat,lng"', mapsDirectionsUrl({ lat: 12.56, lng: 77.31, label: 'ignored' }),
  'https://www.google.com/maps/dir/?api=1&destination=12.56%2C77.31&travelmode=driving');
expect('the pair separator is a comma', mapsDirectionsUrl({ lat: 12.56, lng: 77.31 }).includes('destination=12.56%2C77.31'), true);
expectTrue('a negative longitude survives', mapsDirectionsUrl({ lat: -1.5, lng: -77.25 }).includes('%2C-77.25'));
expectTrue('the label is ignored when a fix exists', !mapsDirectionsUrl({ lat: 12.5, lng: 77.5, label: 'x' }).includes('x'));

console.log('\n=== 2. a broken fix is refused, not sent ===');
for (const [name, lat, lng] of [
  ['NaN latitude', NaN, 77.31],
  ['NaN longitude', 12.5, NaN],
  ['Infinity latitude', Infinity, 77.31],
  ['string latitude', '12.5', 77.31],
  ['latitude 200', 200, 77.31],
  ['latitude -90.1', -90.1, 77.31],
  ['longitude 181', 12.5, 181],
]) {
  expect(`no directions for ${name}`, mapsDirectionsUrl({ lat, lng }), null);
  expect(`no place link for ${name}`, mapsPlaceUrl({ lat, lng }), null);
}
expect('the exact north pole corner is still a place', mapsDirectionsUrl({ lat: 90, lng: 180 }) !== null, true);
expectTrue('a null fix with no label has no target', !hasNavigationTarget({ lat: null, lng: null }));

console.log('\n=== 3. an address is encoded, so Kannada survives the URL ===');
const kann = 'ಕುನಿಗಲ, ಹೊರಗೆ ಮಾರುಕಟ್ಟೆ, ಬೆಂಗಳೂರು ರೋಡ್';
const kannUrl = mapsDirectionsUrl({ label: kann });
expectTrue('a Kannada address is percent-encoded, not raw', kannUrl.includes('%E0%B2%95') && !kannUrl.includes('ಕ'));
expectTrue('no raw space reaches the query', !/[?&]destination=[^&]* /.test(kannUrl));
expectTrue('no fragment can split the URL', !new URL(kannUrl).hash);
const amp = mapsDirectionsUrl({ label: 'Shop & Sons, #12' });
expectTrue('an & or # in the address is encoded, not structural',
  new URL(amp).searchParams.get('destination') === 'Shop & Sons, #12' && !new URL(amp).hash);
expectTrue('the URL is still parseable', new URL(kannUrl).searchParams.get('destination') === kann);

console.log('\n=== 4. whitespace and absurd length cannot make a link ===');
expect('a blank address has no directions', mapsDirectionsUrl({ label: '   ' }), null);
expect('an empty label object has no directions', mapsDirectionsUrl({}), null);
const long = 'a'.repeat(5000);
expectTrue('a 5000-character address is capped', new URL(mapsDirectionsUrl({ label: long })).searchParams.get('destination').length === 300);
expectTrue('the cap keeps whole characters', !new URL(mapsDirectionsUrl({ label: long })).searchParams.get('destination').includes('%'));
expect('a padding-only label is trimmed then capped', new URL(mapsDirectionsUrl({ label: `   ${'b'.repeat(400)}   ` })).searchParams.get('destination'), 'b'.repeat(300));

console.log('\n=== 5. no key, no SDK, one origin, always HTTPS ===');
const source = readFileSync(join(root, 'apps/mobile/src/lib/navigation-links.ts'), 'utf8');
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
expectTrue('no api key parameter anywhere', !/key=/.test(codeOnly));
expectTrue('no map SDK import', !/(react-native-maps|mapbox|leaflet|maplibre|WebView)/i.test(codeOnly));
expectTrue('no tile or provider endpoint', !/tile|staticmap|geocode/i.test(codeOnly));
expectTrue('HTTPS only', mapsDirectionsUrl({ lat: 1, lng: 1 }).startsWith('https://'));
expectTrue('one origin, always google maps', mapsDirectionsUrl({ lat: 1, lng: 1 }).startsWith('https://www.google.com/maps/'));
expectTrue('the place link shares the origin', mapsPlaceUrl({ lat: 1, lng: 1 }).startsWith('https://www.google.com/maps/'));

console.log('\n=== 6. the link is the honest shape it claims to be ===');
const dir = new URL(mapsDirectionsUrl({ lat: 12.5, lng: 77.5 }));
expect('directions ask for api=1', dir.searchParams.get('api'), '1');
expectTrue('directions carry NO origin (the phone starts from itself)', dir.searchParams.get('origin') === null);
expect('directions are driving by default', dir.searchParams.get('travelmode'), 'driving');
expect('a rider may ask for two_wheeler', new URL(mapsDirectionsUrl({ lat: 1, lng: 1 }, 'two_wheeler')).searchParams.get('travelmode'), 'two_wheeler');
const place = new URL(mapsPlaceUrl({ lat: 12.5, lng: 77.5 }));
expect('a place link carries the fix', place.searchParams.get('query'), '12.5,77.5');
expect('a place link is a search, not directions', mapsPlaceUrl({ lat: 1, lng: 1 }).includes('/search/?'), true);
expect('a place link without a fix is null', mapsPlaceUrl({ label: 'Kunigal' }), null);

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
