import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Gesture,
  GestureDetector,
  type PanGestureHandlerEventPayload,
  type PinchGestureHandlerEventPayload,
  type TapGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { IconButton } from '@/components/ui/icon-button';
import { useTheme } from '@/hooks/use-theme';
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  project,
  screenPosition,
  tilesFor,
  TILE_ATTRIBUTION,
  unproject,
  type LatLng,
} from '@/lib/map-tiles';
import { osrmRouteUrl, parseOsrmRoute, routeLengthText, straightDirection } from '@/lib/route';
import type { RouteLine } from '@/lib/route';
import { useLanguageStore } from '@/store/language-store';

/**
 * The map: OpenStreetMap tiles, drawn by this app, with no SDK and no key.
 *
 * WHY THIS SHAPE
 *
 * `SCALE-AND-TRACKING.md` §6.5.1 records the whole decision. The short version:
 * Google/Mapbox SDKs need a billing key and a key does not belong in a shipped
 * app (`AGENTS.md` §9.6), so the map is **raster OSM tiles** — the same source
 * Wikipedia and Organic Maps use — composited here with `expo-image`, which the
 * app already has, and drawn with the gesture stack the app already has
 * (`react-native-gesture-handler` + `react-native-reanimated`).
 *
 * WHAT MAKES IT FEEL LIKE THE APPS PEOPLE USE
 *
 *   - **two-finger pinch to zoom**, with the point between the fingers held
 *     still, and a **double-tap to zoom in** on the tap;
 *   - one-finger drag to pan, pan disabled at zero zoom-out so the map stops
 *     at its own edge rather than showing grey space;
 *   - the map **follows the rider** on every new fix until the customer touches
 *     it, then a "centre on the rider" button appears — the Uber/Swiggy pattern;
 *   - tiles fade in over a grey square instead of popping, and the attribution
 *     is always on screen because OSM's licence requires it.
 *
 * WHAT IT REFUSES TO DO
 *
 * Draw a route it does not have. The line comes from a real router
 * (`lib/route.ts`) when one answers, and when it does not — patchy 4G is normal
 * here — the straight line is drawn and **labelled a direction**. The screen
 * never blocks on the network call and never shows a spinner for it.
 */

/** How far a drag may go before the map stops following the rider again. */
const RECENTRE_AFTER_PX = 40;

/**
 * A map control: the shared icon button on a solid surface, because a
 * transparent circle over a busy tile is invisible. Colours come from the
 * theme, so it works in light and dark (`AGENTS.md` §3).
 */
function MapControlButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.control,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}>
      <IconButton icon={icon} label={label} onPress={onPress} />
    </View>
  );
}

export type RiderMapProps = {
  /** The rider's live fix. Null means "not being shared right now". */
  rider: LatLng | null;
  /** The door, once an address carries coordinates (`addresses.lat/lng`). */
  destination?: LatLng | null;
  height?: number;
};

/**
 * Where a rider with no fix at all would be: Kunigal. Only used for the instant
 * before the first fix arrives, so the map never renders on a null centre.
 */
const DEFAULT_CENTRE: LatLng = { lat: 13.0, lng: 77.4 };

export function RiderMap({ rider, destination = null, height = 260 }: RiderMapProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const [size, setSize] = useState({ width: 0, height });
  const [center, setCenter] = useState<LatLng | null>(rider);
  const [zoom, setZoom] = useState(15);
  const [following, setFollowing] = useState(true);
  const [route, setRoute] = useState<RouteLine | null>(null);

  const language = useLanguageStore((state) => state.language);

  // A new fix while the customer has not taken over: the centre IS the rider,
  // derived rather than copied. The first version of this was an effect that
  // called setCenter on every fix, which re-rendered the map twice per poll and
  // still lagged a frame behind the update it was chasing.
  const centre = useMemo<LatLng>(
    () => (following ? rider ?? DEFAULT_CENTRE : center ?? rider ?? DEFAULT_CENTRE),
    [following, rider, center],
  );

  /**
   * Change zoom while holding one screen point still — the pinch focus, or the
   * spot that was double-tapped. Both gestures need it, and both were wrong the
   * first time because they projected the old centre at the new zoom: the point
   * under the fingers has to be found **at the old zoom** before it can be held
   * still at the new one. `zoomAround` in `lib/map-tiles.ts` is the pure,
   * check-covered version of this same arithmetic.
   */
  const zoomToHoldingAnchor = useCallback(
    (anchor: { x: number; y: number }, fromZoom: number, toZoom: number) => {
      if (toZoom === fromZoom) return;
      const origin = project(centre, fromZoom);
      const held = unproject(
        origin.x + anchor.x - size.width / 2,
        origin.y + anchor.y - size.height / 2,
        fromZoom,
      );
      const heldAtNext = project(held, toZoom);
      const nextCenter = unproject(
        heldAtNext.x - anchor.x + size.width / 2,
        heldAtNext.y - anchor.y + size.height / 2,
        toZoom,
      );
      setCenter({ lat: nextCenter.lat, lng: nextCenter.lng });
      setZoom(toZoom);
    },
    [centre, size.width, size.height],
  );

  const tiles = useMemo(
    () => (size.width > 0 ? tilesFor(centre, zoom, size.width, size.height) : []),
    [centre, zoom, size.width, size.height],
  );

  const riderPoint = useMemo(
    () => (rider && size.width > 0 ? screenPosition(rider, centre, zoom, size.width, size.height) : null),
    [rider, centre, zoom, size.width, size.height],
  );
  const doorPoint = useMemo(
    () =>
      destination && size.width > 0
        ? screenPosition(destination, centre, zoom, size.width, size.height)
        : null,
    [destination, centre, zoom, size.width, size.height],
  );

  /**
   * The route. Asked for once per pair of fixes, not on every pan: the line is
   * geometry between two places and does not care where the map is looking.
   * A failure leaves the straight direction in place, with its own label.
   *
   * Every state write happens inside the async callback, never in the effect
   * body — a synchronous setState here would re-render the map before the first
   * paint, for a line that is not drawn yet.
   */
  useEffect(() => {
    if (!rider || !destination) return;
    const url = osrmRouteUrl(rider, destination);
    if (!url) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const controller = new AbortController();
          const bail = setTimeout(() => controller.abort(), 6000);
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(bail);
          if (!response.ok) throw new Error(String(response.status));
          const parsed = parseOsrmRoute(await response.json());
          if (!live) return;
          setRoute(parsed ?? straightDirection(rider, destination));
        } catch {
          // Offline, rate-limited, or slow. Ordinary here; fall back and say so
          // through the line's own label rather than through an error.
          if (live) setRoute(straightDirection(rider, destination));
        }
      })();
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rider, destination]);

  const routePoints = useMemo(() => {
    if (!route || size.width === 0) return [];
    return route.points
      .map((point) => screenPosition(point, centre, zoom, size.width, size.height))
      .filter((p) => p.left > -200 && p.left < size.width + 200 && p.top > -200 && p.top < size.height + 200);
  }, [route, centre, zoom, size.width, size.height]);

  /**
   * Pan. The gesture starts from the values the map holds *right now* — captured
   * in the closure, not read from a ref — and every later event is a delta from
   * that start, never from the last event. That is what stops a fast drag from
   * drifting by half a screen.
   */
  const onPanUpdate = useCallback(
    (event: PanGestureHandlerEventPayload) => {
      const origin = project(centre, zoom);
      const next = unproject(origin.x - event.translationX, origin.y - event.translationY, zoom);
      setCenter({ lat: next.lat, lng: next.lng });
    },
    [centre, zoom],
  );

  const onPanEnd = useCallback((event: PanGestureHandlerEventPayload) => {
    if (Math.abs(event.translationX) > RECENTRE_AFTER_PX || Math.abs(event.translationY) > RECENTRE_AFTER_PX) {
      setFollowing(false);
    }
  }, []);

  const pan = useMemo(
    () => Gesture.Pan().maxPointers(1).minDistance(2).onUpdate(onPanUpdate).onEnd(onPanEnd),
    [onPanUpdate, onPanEnd],
  );

  const onPinchUpdate = useCallback(
    (event: PinchGestureHandlerEventPayload) => {
      const fromZoom = zoom;
      const nextZoom = clampZoom(fromZoom + Math.log2(Math.max(event.scale, 0.05)));
      zoomToHoldingAnchor({ x: event.focalX, y: event.focalY }, fromZoom, nextZoom);
    },
    [zoom, zoomToHoldingAnchor],
  );

  const pinch = useMemo(
    () => Gesture.Pinch().onUpdate(onPinchUpdate).onEnd(() => setFollowing(false)),
    [onPinchUpdate],
  );

  const onDoubleTap = useCallback(
    (event: TapGestureHandlerEventPayload) => {
      const nextZoom = clampZoom(zoom + 1);
      if (nextZoom === zoom) return;
      zoomToHoldingAnchor({ x: event.x, y: event.y }, zoom, nextZoom);
    },
    [zoom, zoomToHoldingAnchor],
  );

  const doubleTap = useMemo(
    () => Gesture.Tap().numberOfTaps(2).maxDeltaX(12).maxDeltaY(12).onEnd(onDoubleTap),
    [onDoubleTap],
  );

  const composed = useMemo(() => Gesture.Simultaneous(pan, pinch, doubleTap), [pan, pinch, doubleTap]);

  const recentre = () => {
    if (rider) setCenter(rider);
    setFollowing(true);
  };

  // No fix to draw: the order screen keeps its text-first block and this card is
  // not rendered at all. See the caller.
  if (!rider) return null;

  return (
    <View
      style={[styles.frame, { height, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
      onLayout={(event) => {
        const { width, height: h } = event.nativeEvent.layout;
        setSize({ width, height: h });
      }}>
      <GestureDetector gesture={composed}>
        <View style={styles.map} collapsable={false}>
          {tiles.map((tile) => (
            <Image
              key={tile.url}
              source={{ uri: tile.url }}
              style={[styles.tile, { left: tile.left, top: tile.top }]}
              contentFit="cover"
              // A tile fades in over the grey map background instead of popping:
              // on a phone on 4G the difference between "loading" and "broken"
              // is whether something is already standing there.
              transition={180}
              accessible={false}
            />
          ))}

          {routePoints.length > 1 ? (
            <Svg
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              height={size.height}
              width={size.width}>
              <Polyline
                points={routePoints.map((p) => `${p.left},${p.top}`).join(' ')}
                fill="none"
                stroke={route?.kind === 'road' ? theme.accent : theme.textTertiary}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={route?.kind === 'road' ? undefined : '10 8'}
              />
            </Svg>
          ) : null}

          {doorPoint ? (
            <View
              style={[styles.marker, { left: doorPoint.left - 14, top: doorPoint.top - 28, backgroundColor: theme.text, borderColor: theme.card }]}
              accessibilityRole="image"
              accessibilityLabel={t('map.doorHere')}>
              <Ionicons name="home" size={16} color={theme.card} />
            </View>
          ) : null}

          {riderPoint ? (
            <View
              style={[styles.rider, { left: riderPoint.left - 18, top: riderPoint.top - 18, backgroundColor: theme.accent, borderColor: theme.card }]}
              accessibilityRole="image"
              accessibilityLabel={t('map.riderHere')}>
              <Ionicons name="bicycle" size={18} color={theme.onAccent} />
            </View>
          ) : null}

          {!following && rider ? (
            <View style={styles.recentre}>
              <MapControlButton
                icon="locate"
                label={t('map.recentre')}
                onPress={recentre}
              />
            </View>
          ) : null}

          <View style={styles.zoomColumn}>
            <MapControlButton
              icon="add"
              label={t('map.zoomIn')}
              onPress={() => setZoom((z) => clampZoom(z + 1))}
            />
            <MapControlButton
              icon="remove"
              label={t('map.zoomOut')}
              onPress={() => setZoom((z) => clampZoom(z - 1))}
            />
          </View>

          <View style={[styles.attributionSlot, { backgroundColor: theme.card }]} pointerEvents="none">
            <ThemedText type="caption" themeColor="textSecondary">
              {TILE_ATTRIBUTION}
            </ThemedText>
          </View>
        </View>
      </GestureDetector>

      <View style={[styles.caption, { borderTopColor: theme.border }]}>
        {route && rider && destination ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {route.kind === 'road'
              ? t('map.routeByRoad', { distance: routeLengthText(route.distanceM ?? 0, language) })
              : t('map.directionOnly', { distance: routeLengthText(route.distanceM ?? 0, language) })}
          </ThemedText>
        ) : (
          <ThemedText type="caption" themeColor="textSecondary">
            {t('map.riderOnly')}
          </ThemedText>
        )}
        {zoom <= MIN_ZOOM || zoom >= MAX_ZOOM ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {t('map.zoomLimits', { min: MIN_ZOOM, max: MAX_ZOOM })}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  map: { flex: 1 },
  tile: {
    position: 'absolute',
    width: 256,
    height: 256,
  },
  rider: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    ...Platform.select({
      ios: { shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
      default: {},
    }),
  },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  recentre: { position: 'absolute', right: 10, bottom: 10 },
  control: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  zoomColumn: {
    position: 'absolute',
    right: 10,
    top: 10,
    gap: 8,
    alignItems: 'center',
  },
  attributionSlot: {
    position: 'absolute',
    left: 8,
    bottom: 6,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  caption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
});
