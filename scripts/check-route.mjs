#!/usr/bin/env node
/**
 * check-route.mjs — the route line follows roads, when it can.
 *
 * Run:  npm run check:route
 *
 * WHY THIS EXISTS
 *
 * The tracking map draws a line between the rider and the door. A straight line
 * is honest ("a direction") but it is not what any famous delivery app draws,
 * and a customer reading a route that flies over three houses trusts the screen
 * less the second time. So the app asks a router — OSRM's public endpoint, no
 * key, no account — for the real road geometry.
 *
 * The failures that matter are all silent ones, and this asserts none of them
 * can happen:
 *
 *   1. **longitude first.** OSRM takes `lng,lat`; everything else in this app
 *      takes `lat,lng`. One swap puts the rider in the wrong district, and the
 *      map still renders perfectly. This is the assertion that matters most.
 *   2. A garbage body must degrade to `null`, never to a partial or empty line
 *      drawn with confidence.
 *   3. The fallback exists and is labelled `direction`, not `road`.
 *   4. No key anywhere — the whole point of choosing this endpoint.
 *
 * WHAT IT DOES NOT PROVE
 *
 * That OSRM is up, that the route is legal to drive, or that the drawn line
 * looks good. Those need a device and a live call.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  OSRM_BASE,
  MAX_ROUTE_POINTS,
  osrmRouteUrl,
  parseOsrmRoute,
  straightDirection,
  bearingBetween,
  routeLengthText,
} = await import(pathToFileURL(join(root, 'apps/mobile/src/lib/route.ts')).href);
const { isValidLatLng } = await import(
  pathToFileURL(join(root, 'apps/mobile/src/lib/map-tiles.ts')).href
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

const KUNIGAL = { lat: 13.0, lng: 77.4 };
const DOOR = { lat: 13.012, lng: 77.402 };

console.log('=== 1. OSRM gets longitude first — the one swap that ruins a map ===');
const url = osrmRouteUrl(KUNIGAL, DOOR);
expect('the URL spells lng,lat in OSRM order', url,
  'https://router.project-osrm.org/route/v1/driving/77.4,13;77.402,13.012?overview=full&geometries=geojson&alternatives=false&steps=false');
expectTrue('the first number is the longitude (77.4 before 13)', url.startsWith(`${OSRM_BASE}77.4,13;`));
expectTrue('the order flips at the semicolon too', url.includes(';77.402,13.012'));
expect('a bad fix never becomes a URL', osrmRouteUrl({ lat: 0, lng: 0 }, DOOR), null);
expect('a NaN fix never becomes a URL', osrmRouteUrl({ lat: NaN, lng: 77.4 }, DOOR), null);

console.log('\n=== 2. a real response becomes a road route ===');
const good = {
  code: 'Ok',
  routes: [{
    distance: 1834.7,
    duration: 402.1,
    geometry: {
      type: 'LineString',
      coordinates: [
        [77.4, 13.0], [77.4005, 13.001], [77.401, 13.004], [77.402, 13.012],
      ],
    },
  }],
};
const route = parseOsrmRoute(good);
expect('it is a road route', route.kind, 'road');
expect('the coordinates come back lat,lng for the map', route.points[0], { lat: 13.0, lng: 77.4 });
expect('the last point is the door', route.points[route.points.length - 1], { lat: 13.012, lng: 77.402 });
expect('every point is a usable fix', route.points.every(isValidLatLng), true);
expect('the router’s distance is kept', Math.round(route.distanceM), 1835);
expect('four coordinate pairs make four points', route.points.length, 4);

console.log('\n=== 3. anything else degrades to null, never to half a line ===');
expect('null is null', parseOsrmRoute(null), null);
expect('a string is null', parseOsrmRoute('Ok'), null);
expect('a non-Ok code is null', parseOsrmRoute({ code: 'NoRoute', routes: [] }), null);
expect('a missing geometry is null', parseOsrmRoute({ code: 'Ok', routes: [{}] }), null);
expect('an empty route list is null', parseOsrmRoute({ code: 'Ok', routes: [] }), null);
expect('a MultiLineString is refused, not half-drawn',
  parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { type: 'MultiLineString', coordinates: [] } }] }), null);
expect('a truncated pair is refused', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[77.4], [77.5]] } }],
}), null);
expect('a string coordinate is refused', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [['77.4', 13]] } }],
}), null);
expect('the null island is refused', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[0, 0], [77.4, 13]] } }],
}), null);
expect('a one-point route is not a line', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[77.4, 13]] } }],
}), null);
const huge = Array.from({ length: MAX_ROUTE_POINTS + 5 }, (_, i) => [77.4 + i / 1e6, 13]);
expect('an absurd route is refused rather than drawn', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: huge } }],
}), null);
expect('a missing distance is null, not zero', parseOsrmRoute({
  code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[77.4, 13], [77.41, 13.01]] } }],
}).distanceM, null);

console.log('\n=== 4. the fallback is honest about being a direction ===');
const fallback = straightDirection(KUNIGAL, DOOR);
expect('the fallback is labelled a direction', fallback.kind, 'direction');
expect('the fallback carries no distance claim', fallback.distanceM, null);
expect('the fallback starts at the rider', fallback.points[0], KUNIGAL);
expect('the fallback ends at the door', fallback.points[fallback.points.length - 1], DOOR);
expect('the fallback is sampled, not two points', fallback.points.length, 25);
expectTrue('the fallback never claims a distance it does not have', fallback.distanceM === null);
expect('a bad fix has no fallback either', straightDirection({ lat: 0, lng: 0 }, DOOR), null);

console.log('\n=== 5. bearing, and the length sentence ===');
expect('due east is 90°', Math.round(bearingBetween({ lat: 13, lng: 77.4 }, { lat: 13, lng: 77.5 })), 90);
expect('due north is 0°', Math.round(bearingBetween({ lat: 13, lng: 77.4 }, { lat: 13.1, lng: 77.4 })), 0);
expect('south-west is about 225°', Math.round(bearingBetween({ lat: 13, lng: 77.4 }, { lat: 12.9, lng: 77.3 })), 224);
expect('metres in English', routeLengthText(350, 'en'), '350 m');
expect('metres in Kannada', routeLengthText(350, 'kn'), '350 ಮೀಟರ್');
expect('a kilometre and a half, once', routeLengthText(1500, 'en'), '1.5 km');
expect('a kilometre and a half, Kannada', routeLengthText(1500, 'kn'), '1.5 ಕಿಲೋಮೀಟರ್');
expect('nothing is invented from a negative length', routeLengthText(-5, 'en'), '');

console.log('\n=== 6. no key, no SDK, one host ===');
const source = readFileSync(join(root, 'apps/mobile/src/lib/route.ts'), 'utf8');
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
expectTrue('no api key parameter anywhere', !/key=/.test(codeOnly));
expectTrue('no token or access key', !/(access_token|api-?key|Bearer)/i.test(codeOnly));
expectTrue('no marker, tab key, or polyline encoding to mis-decode', !/polyline/.test(codeOnly));
expectTrue('one host only', OSRM_BASE.startsWith('https://router.project-osrm.org/'));
expectTrue('HTTPS only', url.startsWith('https://'));
expectTrue('the request asks for the full geometry', url.includes('overview=full'));
expectTrue('the request asks for GeoJSON, not an encoded polyline', url.includes('geometries=geojson'));

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
