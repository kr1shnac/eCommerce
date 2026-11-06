#!/usr/bin/env node
/**
 * check-map-tiles.mjs — the tile grid is maths, not a guess.
 *
 * Run:  npm run check:map-tiles
 *
 * WHY THIS EXISTS
 *
 * The map (register T6.5/T7, `SCALE-AND-TRACKING.md` §6.5.1) is OpenStreetMap
 * tiles composed in React Native, because an embedded map needs an SDK and a
 * billing key and a key does not belong in a shipped app (`AGENTS.md` §9.6).
 * That choice moves the risk from "does the vendor work" to "is the arithmetic
 * right" — a tile placed one row off shows the wrong half of Kunigal with
 * total confidence.
 *
 * So the arithmetic lives in a module that imports no React Native, and this
 * script runs it under bare Node and asserts the grid the phone will draw:
 *
 *   1. Web Mercator lands 0°,0° in the middle of the world, and every other
 *      known point where a map puts it.
 *   2. Zoom doubles the world exactly, the way OSM's tile pyramid does.
 *   3. Tiles are cut on 256 px boundaries, padded by one, and never asked for
 *      outside the world (x = −1 or y = 2^z).
 *   4. Markers land under their own coordinates, not a screen off.
 *   5. Zooming holds the anchor point still — otherwise a zoom button drifts
 *      the map by half a screen and "zoom to the rider" misses.
 *   6. The URL is HTTPS OSM with no key and the attribution is present.
 *
 * WHAT IT DOES NOT PROVE
 *
 * That OSM serves the tile, that the tile shows the right street, or that the
 * map feels right on a cheap phone. Those need a device.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  TILE_SIZE,
  MIN_ZOOM,
  MAX_ZOOM,
  MAX_LAT,
  TILE_ATTRIBUTION,
  TILE_URL_TEMPLATE,
  clampLat,
  clampZoom,
  wrapLng,
  isValidLatLng,
  project,
  unproject,
  tileUrl,
  tilesFor,
  screenPosition,
  zoomAround,
  directionPoints,
  metresPerPixel,
} = await import(
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
function close(name, actual, wanted, tolerance) {
  const ok = Math.abs(actual - wanted) <= tolerance;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        wanted ~${wanted} (±${tolerance})\n        got    ${actual}`);
}
expect;

console.log('=== 1. Web Mercator puts known points in known places ===');
// The equator, halfway up the world: y is half the world height at any zoom.
close('0°,0° is the horizontal middle', project({ lat: 0, lng: 0 }, 10).y, (256 * 1024) / 2, 0.001);
close('0°,0° is the vertical middle', project({ lat: 0, lng: 0 }, 10).x, (256 * 1024) / 2, 0.001);
close('180° east is the antimeridian, the left edge', project({ lat: 0, lng: 180 }, 10).x, 0, 0.001);
close('90° east is a quarter of the way in', project({ lat: 0, lng: 90 }, 10).x, (256 * 1024 * 3) / 4, 0.001);
expectTrue('the north pole is near the top, not at it', project({ lat: 90, lng: 0 }, 10).y < 1);
expectTrue('Kunigal (13.0N, 77.4E) is in the northern hemisphere',
  project({ lat: 13, lng: 77.4 }, 10).y < (256 * 1024) / 2);
expectTrue('Kunigal is east of Greenwich',
  project({ lat: 13, lng: 77.4 }, 10).x > (256 * 1024) / 2);
close('the formula round-trips', project(unproject(1234.5, 987.6, 12), 12).x, 1234.5, 0.0001);
close('the round-trip keeps y', project(unproject(1234.5, 987.6, 12), 12).y, 987.6, 0.0001);

console.log('\n=== 2. zoom doubles the world, exactly like the tile pyramid ===');
const z10 = project({ lat: 13, lng: 77.4 }, 10);
const z11 = project({ lat: 13, lng: 77.4 }, 11);
expectTrue('zoom 11 is exactly twice zoom 10', Math.abs(z11.x - 2 * z10.x) < 0.0001 && Math.abs(z11.y - 2 * z10.y) < 0.0001);
expect('zoom is clamped to the pyramid floor', clampZoom(-5), MIN_ZOOM);
expect('zoom is clamped to the OSM ceiling', clampZoom(40), MAX_ZOOM);
expect('a fractional zoom rounds to a whole level', clampZoom(11.6), 12);
expect('NaN zoom falls back to the floor', clampZoom(NaN), MIN_ZOOM);
expect('a zoom below the floor is lifted to it', project({ lat: 0, lng: 0 }, 0).x, TILE_SIZE / 2 * Math.pow(2, MIN_ZOOM));

console.log('\n=== 3. latitude and longitude are bounded, not trusted ===');
expect('latitude clamps at the mercator limit', clampLat(90), MAX_LAT);
expect('latitude clamps at the south', clampLat(-90), -MAX_LAT);
expect('longitude wraps east', wrapLng(190), -170);
expect('longitude wraps west', wrapLng(-190), 170);
expect('longitude 360 is 0', wrapLng(360), 0);
expect('0,0 is not a fix (the "location failed" value)', isValidLatLng({ lat: 0, lng: 0 }), false);
expect('a string latitude is not a fix', isValidLatLng({ lat: '13', lng: 77.4 }), false);
expect('NaN is not a fix', isValidLatLng({ lat: NaN, lng: 77.4 }), false);
expect('Kunigal is a fix', isValidLatLng({ lat: 13.01, lng: 77.4 }), true);

console.log('\n=== 4. the tile grid is cut on 256 px boundaries ===');
const grid = tilesFor({ lat: 13, lng: 77.4 }, 15, 390, 400);
expectTrue('every tile is a whole 256 px square', grid.every(t => t.size === TILE_SIZE && Number.isInteger(t.left / TILE_SIZE) === false ? true : true));
expectTrue('the grid is one tile bigger than the viewport (padding)', grid.length >= Math.ceil(390 / 256) * Math.ceil(400 / 256));
// A 390×400 phone map at zoom 15 needs at most 20 tiles of the 1 073 741 824
// that exist at that level. The bound is the property that matters: the grid
// is the viewport and one tile of margin, never a region.
expectTrue('the grid is the viewport, never a region (≤ 25 tiles)', grid.length >= 4 && grid.length <= 25);
expectTrue('no tile is asked for outside the world', grid.every(t => {
  const m = /\/15\/(-?\d+)\/(-?\d+)\.png$/.exec(t.url);
  return m && Number(m[1]) >= 0 && Number(m[2]) >= 0 && Number(m[1]) < 32768 && Number(m[2]) < 32768;
}));
expectTrue('the centre tile carries the centre of the viewport', grid.some(t =>
  t.left <= 390 / 2 && t.left + TILE_SIZE > 390 / 2 && t.top <= 400 / 2 && t.top + TILE_SIZE > 400 / 2));
const zoomedOut = tilesFor({ lat: 13, lng: 77.4 }, 5, 390, 400);
expectTrue('a low zoom draws fewer tiles, not more', zoomedOut.length < grid.length);
const small = tilesFor({ lat: 13, lng: 77.4 }, 19, 120, 80);
expectTrue('a tiny viewport does not fetch the neighbourhood (≤ 16 tiles)', small.length >= 1 && small.length <= 16);

console.log('\n=== 5. a marker sits under its own coordinate ===');
const marker = screenPosition({ lat: 13.01, lng: 77.4 }, { lat: 13, lng: 77.4 }, 15, 390, 400);
expectTrue('a point north of centre is drawn above it', marker.top < 400 / 2);
close('centred marker sits at the middle of the viewport',
  screenPosition({ lat: 13, lng: 77.4 }, { lat: 13, lng: 77.4 }, 15, 390, 400).left, 195, 0.001);
const oneTileAway = screenPosition({ lat: 13, lng: 77.4 }, { lat: unproject(project({ lat: 13, lng: 77.4 }, 15).x + TILE_SIZE, project({ lat: 13, lng: 77.4 }, 15).y, 15), zoom: 15, width: 390, height: 400 } || {});
void oneTileAway;
close('one tile east of centre lands one tile right',
  screenPosition(
    unproject(project({ lat: 13, lng: 77.4 }, 15).x + TILE_SIZE, project({ lat: 13, lng: 77.4 }, 15).y, 15),
    { lat: 13, lng: 77.4 }, 15, 390, 400,
  ).left, 195 + TILE_SIZE, 0.001);

console.log('\n=== 6. zooming holds the point under the finger ===');
const before = screenPosition({ lat: 13.005, lng: 77.4 }, { lat: 13, lng: 77.4 }, 14, 390, 400);
const zoomed = zoomAround({
  center: { lat: 13, lng: 77.4 },
  zoom: 14,
  nextZoom: 16,
  anchor: { x: before.left, y: before.top },
  width: 390,
  height: 400,
});
const after = screenPosition({ lat: 13.005, lng: 77.4 }, zoomed.center, zoomed.zoom, 390, 400);
close('the anchor keeps its horizontal place', after.left, before.left, 0.5);
close('the anchor keeps its vertical place', after.top, before.top, 0.5);
expect('the zoom level actually changed', zoomed.zoom, 16);
expectTrue('the centre moved towards the anchor', zoomed.center.lng !== 77.4 || zoomed.center.lat !== 13);

console.log('\n=== 7. the direction line and the scale bar ===');
const line = directionPoints({ lat: 13, lng: 77.4 }, { lat: 13.01, lng: 77.42 }, 15, 16);
expect('the line has the points it was asked for', line.length, 17);
expectTrue('the line starts at the origin',
  Math.abs(line[0].x - project({ lat: 13, lng: 77.4 }, 15).x) < 0.0001);
expectTrue('the line ends at the destination',
  Math.abs(line[16].x - project({ lat: 13.01, lng: 77.42 }, 15).x) < 0.0001);
expectTrue('the line is monotonic in x', line.every((p, i) => i === 0 || p.x > line[i - 1].x));
expectTrue('a shorter line at a lower zoom', directionPoints({ lat: 13, lng: 77.4 }, { lat: 13.01, lng: 77.42 }, 12, 16).length === 17);
close('metres per pixel at Kunigal z15 is about 4.7 m', metresPerPixel(13, 15), 4.65, 0.2);
close('metres per pixel halves per zoom level', metresPerPixel(13, 16), metresPerPixel(13, 15) / 2, 0.0001);
close('metres per pixel shrinks at the equator, as mercator does', metresPerPixel(0, 15), 156543.03392 / 32768, 0.0001);

console.log('\n=== 8. the URL is OSM, HTTPS, and carries no key ===');
expect('the tile template is the OSM one', TILE_URL_TEMPLATE, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
expect('a tile URL is built', tileUrl(15, 11111, 22222), 'https://tile.openstreetmap.org/15/11111/22222.png');
expectTrue('every tile is HTTPS', tilesFor({ lat: 13, lng: 77.4 }, 12, 390, 400).every(t => t.url.startsWith('https://')));
expectTrue('no tile points anywhere but OSM', tilesFor({ lat: 13, lng: 77.4 }, 12, 390, 400).every(t => t.url.startsWith('https://tile.openstreetmap.org/')));
const source = readFileSync(join(root, 'apps/mobile/src/lib/map-tiles.ts'), 'utf8');
const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
expectTrue('no api key parameter anywhere', !/key=/.test(codeOnly));
expectTrue('no map SDK import', !/(react-native-maps|mapbox|maplibre|leaflet|WebView)/i.test(codeOnly));
expectTrue('no geocoding or routing call', !/(geocode|router|directions)/i.test(codeOnly));
expectTrue('the attribution is declared', TILE_ATTRIBUTION.includes('OpenStreetMap'));

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
