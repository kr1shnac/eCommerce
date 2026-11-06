/**
 * route.ts — a real route on the map, when the free router answers.
 *
 * WHY NOT THE PHONE'S OWN MAPS APP
 *
 * `lib/navigation-links.ts` already opens turn-by-turn navigation in whatever
 * maps app the phone has. That is the *instruction*. This module answers a
 * different question: **which road does the rider take**, so the line on the
 * in-app map follows streets instead of flying over rooftops. Every famous
 * delivery app draws the second one; a straight line is the thing that makes a
 * tracking screen look like a toy.
 *
 * THE CHOICE, AND WHY IT IS THIS ONE
 *
 * - Google Directions API / Mapbox Directions — need a **key**, and a key in a
 *   shipped app is a key anyone can lift (`AGENTS.md` §9.6). Refused, same as
 *   the map SDK.
 * - OSRM's public demo server — the same routing engine OSM's own site runs,
 *   **no key, no account, CORS open**, and the response is plain GeoJSON.
 *   Its published limits are honest and modest, and this shop has one rider
 *   at a time. It is the accurate choice available without a key.
 * - Self-hosting a router — the right answer at scale, wrong answer for a
 *   pilot in one town. Recorded in `SCALE-AND-TRACKING.md` §6.5.1 as the
 *   upgrade path.
 *
 * WHAT HAPPENS WHEN IT DOES NOT ANSWER
 *
 * Patchy 4G, a router that is down, a rate limit — all ordinary here. The map
 * then draws the **straight direction** it always had, and the label says
 * "direction", not "route". The screen never blocks on this call, never shows a
 * spinner for it, and never pretends a straight line is a road.
 *
 * This module is the pure half: URL building, response parsing, validation.
 * `components/rider-map.tsx` does the fetching, so this file stays testable
 * under bare Node by `scripts/check-route.mjs`.
 */

import { isValidLatLng, type LatLng } from '@/lib/map-tiles';

/**
 * OSRM's public endpoint. Not a secret and not an API key — it is a URL, which
 * is exactly why it can live in source where a key cannot.
 */
export const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/';

/** How many points a route may return before we stop drawing it. */
export const MAX_ROUTE_POINTS = 2000;

/**
 * `driving/<from>;<to>?overview=full&geometries=geojson`
 *
 * Note the order OSRM expects: **longitude first**, which is the opposite of
 * everything else in this app and the single most likely way to draw a rider in
 * the wrong district. `osrmRouteUrl` is the only place that order is written.
 */
export function osrmRouteUrl(from: LatLng, to: LatLng): string | null {
  if (!isValidLatLng(from) || !isValidLatLng(to)) return null;
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  return `${OSRM_BASE}${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
}

/** The only two shapes of route line the map knows how to draw. */
export type RouteKind = 'road' | 'direction';

export type RouteLine = {
  kind: RouteKind;
  points: LatLng[];
  /** Metres along the road, when the router told us. Null for a direction. */
  distanceM: number | null;
};

/**
 * Read an OSRM response into the coordinates the map draws.
 *
 * Returns `null` for anything that is not a usable route — not `throw`, and not
 * a partial line. The caller's answer to "no route" is the straight direction,
 * so a malformed body degrades into something honest rather than into an error.
 */
export function parseOsrmRoute(json: unknown): RouteLine | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { code?: unknown; routes?: unknown };
  if (body.code !== 'Ok') return null;
  const routes = Array.isArray(body.routes) ? body.routes : [];
  const first = routes[0] as { geometry?: unknown; distance?: unknown } | undefined;
  const geometry = first?.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!geometry || geometry.type !== 'LineString') return null;
  const raw = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const points: LatLng[] = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const [lng, lat] = pair as [number, number];
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!isValidLatLng({ lat, lng })) return null;
    points.push({ lat, lng });
    if (points.length > MAX_ROUTE_POINTS) return null;
  }
  // A route with fewer than two points is not a line.
  if (points.length < 2) return null;
  const distance = typeof first?.distance === 'number' && first.distance >= 0 ? first.distance : null;
  return { kind: 'road', points, distanceM: distance };
}

/**
 * The fallback: the straight line between two fixes, sampled so the map can
 * draw it as one path. Labelled `direction` by the caller, because that is
 * what it is — no road geometry is claimed.
 */
export function straightDirection(from: LatLng, to: LatLng, steps = 24): RouteLine | null {
  if (!isValidLatLng(from) || !isValidLatLng(to)) return null;
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
  }
  return { kind: 'direction', points, distanceM: null };
}

/**
 * Compass bearing from one fix to another, 0–360° clockwise from north. Used
 * to point the rider's marker the way they are travelling once two fixes exist;
 * today there is one fix per rider, so the marker has no arrow and this is here
 * for the day the position history lands.
 */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** "1.2 km" / "350 m" — a route length, in the customer's own units. */
export function routeLengthText(metres: number, language: 'en' | 'kn'): string {
  if (!Number.isFinite(metres) || metres < 0) return '';
  if (metres < 1000) {
    return language === 'kn'
      ? `${Math.round(metres)} ಮೀಟರ್`
      : `${Math.round(metres)} m`;
  }
  const km = Math.round(metres / 100) / 10;
  return language === 'kn' ? `${km} ಕಿಲೋಮೀಟರ್` : `${km} km`;
}
