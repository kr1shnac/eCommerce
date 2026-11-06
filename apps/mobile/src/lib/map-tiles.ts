/**
 * map-tiles.ts — the arithmetic behind a real map, and nothing else.
 *
 * WHY THERE IS A MAP AT ALL
 *
 * `SCALE-AND-TRACKING.md` §6.2 made the tracking screen text-first for one
 * honest reason: an embedded Google/Mapbox map needs an SDK and a **billing API
 * key**, and a key in a shipped app is a key anyone can lift (`AGENTS.md` §9.6).
 * The owner has since asked for a map.
 *
 * This is the map that needs no key. It is OpenStreetMap tiles — plain 256×256
 * PNGs over HTTPS — composed in React Native with `expo-image`, which the app
 * already uses for product photos. No map SDK, no WebView, no native config, no
 * billing account, nothing embedded.
 *
 * WHAT THIS MODULE IS
 *
 * Pure Web-Mercator arithmetic and two URL builders. It imports nothing from
 * React Native, so `scripts/check-map-tiles.mjs` can run it under bare Node and
 * assert the tile grid is the same one the phone draws. That is the whole point
 * of the split: the numbers that decide *which tile sits where* are proved on
 * every lint run, not eyeballed on a bike mount.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * - Not a router. A straight line between two points is drawn by the caller and
 *   labelled as a direction, never as a route (no road geometry exists here, and
 *   inventing one is exactly the confident lie `PRODUCTION.md` §2 refuses).
 * - Not a geocoder. A text destination stays text; the maps deep link in
 *   `lib/navigation-links.ts` is what turns an address into a search.
 * - Not a cache of tiles or a network client. `expo-image` owns caching; this
 *   module only says which URLs exist.
 */

/** Pixels per tile at every zoom. OpenStreetMap serves 256 px tiles. */
export const TILE_SIZE = 256;

/** Zoom levels this map will use. 19 is OSM's own ceiling. */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

/**
 * Latitude is clamped short of ±90 because the Mercator formula divides by
 * zero there. ±85.0511 is where the projection reaches the top of the world.
 */
export const MAX_LAT = 85.05112878;

/** The tile template. One constant, so the source can be swapped in one place. */
export const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** What OSM's licence requires us to show. Not optional, not a nicety. */
export const TILE_ATTRIBUTION = '© OpenStreetMap contributors';

export type LatLng = { lat: number; lng: number };

/**
 * A fix this map is willing to place: finite, inside the world, and **not the
 * null island**. `(0, 0)` is what a failed GPS fix reports on many phones, and
 * putting a rider's dot in the Gulf of Guinea is worse than showing nothing —
 * the same rule `rider_positions` enforces in SQL.
 */
export function isValidLatLng(value: LatLng | null | undefined): value is LatLng {
  if (!value) return false;
  const { lat, lng } = value;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -MAX_LAT &&
    lat <= MAX_LAT &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

export function clampLat(lat: number): number {
  return Math.min(MAX_LAT, Math.max(-MAX_LAT, lat));
}

/** Longitude wraps, it does not clamp: 190° is −170°. */
export function wrapLng(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/**
 * Web Mercator, in **world pixels** at a zoom level: the whole earth is
 * `TILE_SIZE × 2^zoom` pixels wide, and every tile is a 256 px square cut out
 * of it. This is the single projection the map uses; the UI does no arithmetic
 * of its own.
 */
export function project(point: LatLng, zoom: number): { x: number; y: number } {
  const z = clampZoom(zoom);
  const scale = TILE_SIZE * Math.pow(2, z);
  const lat = clampLat(point.lat);
  const lng = wrapLng(point.lng);
  const siny = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale,
  };
}

/** The inverse of `project`, for "what is at this pixel?". */
export function unproject(x: number, y: number, zoom: number): LatLng {
  const z = clampZoom(zoom);
  const scale = TILE_SIZE * Math.pow(2, z);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI * (1 - 2 * (y / scale));
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng: wrapLng(lng) };
}

export function tileUrl(zoom: number, x: number, y: number): string {
  return TILE_URL_TEMPLATE.replace('{z}', String(clampZoom(zoom)))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** A tile to draw, already positioned on screen. */
export type MapTile = {
  url: string;
  /** CSS pixels from the map's top-left corner. */
  left: number;
  top: number;
  size: number;
};

/**
 * Every tile that shows in a viewport of `width` × `height` centred on `center`,
 * with its top-left corner already offset in screen pixels.
 *
 * The grid is padded by one tile so a pan that starts mid-screen still has
 * tiles to reveal, and the returned count is bounded by the viewport — a map
 * view never asks for the world. Tiles outside the world (there is no tile at
 * x = −1 or y = 2^zoom) are skipped rather than wrapped, because a Kunigal
 * customer is nowhere near the antimeridian and a wrapped tile would silently
 * draw the wrong half of the earth.
 */
export function tilesFor(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
  pad = 1,
): MapTile[] {
  const z = clampZoom(zoom);
  const origin = project(center, z);
  const left0 = origin.x - width / 2;
  const top0 = origin.y - height / 2;

  const firstX = Math.floor(left0 / TILE_SIZE) - pad;
  const lastX = Math.floor((left0 + width) / TILE_SIZE) + pad;
  const firstY = Math.floor(top0 / TILE_SIZE) - pad;
  const lastY = Math.floor((top0 + height) / TILE_SIZE) + pad;

  const tiles: MapTile[] = [];
  for (let ty = firstY; ty <= lastY; ty += 1) {
    if (ty < 0 || ty >= Math.pow(2, z)) continue;
    for (let tx = firstX; tx <= lastX; tx += 1) {
      if (tx < 0 || tx >= Math.pow(2, z)) continue;
      tiles.push({
        url: tileUrl(z, tx, ty),
        left: tx * TILE_SIZE - left0,
        top: ty * TILE_SIZE - top0,
        size: TILE_SIZE,
      });
    }
  }
  return tiles;
}

/** Where a point lands inside a viewport, in screen pixels from its top-left. */
export function screenPosition(
  point: LatLng,
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
): { left: number; top: number } {
  const p = project(point, zoom);
  const o = project(center, zoom);
  return { left: p.x - o.x + width / 2, top: p.y - o.y + height / 2 };
}

/**
 * Zoom in or out while holding a screen point still, so tapping "＋" on the
 * rider marker keeps the rider under the finger. Without the anchor a zoom
 * button drifts the map by half a screen each press.
 *
 * Takes the zoom being left as well as the one being arrived at: the point
 * under the finger has to be found **at the old zoom** before it can be held
 * still at the new one. Projecting the old centre at the new zoom was the first
 * version and it drifted, which is exactly what this function exists to stop.
 */
export function zoomAround(args: {
  center: LatLng;
  zoom: number;
  nextZoom: number;
  anchor: { x: number; y: number };
  width: number;
  height: number;
}): { center: LatLng; zoom: number } {
  const from = clampZoom(args.zoom);
  const to = clampZoom(args.nextZoom);
  if (to === from) return { center: { lat: clampLat(args.center.lat), lng: wrapLng(args.center.lng) }, zoom: to };

  const origin = project(args.center, from);
  const anchorWorld = {
    x: origin.x + args.anchor.x - args.width / 2,
    y: origin.y + args.anchor.y - args.height / 2,
  };
  const held = unproject(anchorWorld.x, anchorWorld.y, from);
  const heldAtNext = project(held, to);
  const nextCenter = unproject(
    heldAtNext.x - args.anchor.x + args.width / 2,
    heldAtNext.y - args.anchor.y + args.height / 2,
    to,
  );
  return { center: { lat: clampLat(nextCenter.lat), lng: wrapLng(nextCenter.lng) }, zoom: to };
}

/**
 * Points along the straight line between two fixes, in world pixels — the
 * caller turns them into a drawn "direction". Linear in latitude/longitude,
 * which is *not* a great circle: over Kunigal's few kilometres the difference
 * is far below a tile, and the line is labelled as a direction anyway.
 */
export function directionPoints(
  from: LatLng,
  to: LatLng,
  zoom: number,
  steps = 16,
): { x: number; y: number }[] {
  const a = project(from, zoom);
  const b = project(to, zoom);
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return points;
}

/** Metres on the ground per screen pixel at a latitude. Used for a scale bar. */
export function metresPerPixel(lat: number, zoom: number): number {
  const z = clampZoom(zoom);
  return (156543.03392 * Math.cos((clampLat(lat) * Math.PI) / 180)) / Math.pow(2, z);
}
