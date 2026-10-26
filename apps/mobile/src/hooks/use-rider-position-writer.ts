import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { hasLocationConsent } from '@/lib/location-consent';
import {
  requestForegroundPermission,
  watchPosition,
} from '@/lib/location';
import { Coordinates, shouldRecordPosition } from '@/lib/tracking-rules';
import { useAuthStore } from '@/store/auth-store';
import { useMyDeliveries } from '@/hooks/use-staff-orders';

/**
 * Writes the rider's position to the database while they are carrying an order.
 *
 * This is the runtime half of the privacy promise the consent screen makes:
 * **a rider is tracked only while carrying an order, and only while the app is
 * open.** Every other layer (the RPC, the read view, the 10-minute staleness
 * filter, the 150 m accuracy cap) enforces the same promise in the database, so
 * this hook can never over-track even if it is misconfigured.
 *
 * FLOW
 * 1. Rider opens the app and agrees to share location (one tap, persisted).
 * 2. Rider claims an order that goes `out_for_delivery`.
 * 3. While the app is foregrounded and that order is active, GPS fixes arrive
 *    (balanced accuracy, at most every 10 s / 10 m). `shouldRecordPosition()`
 *    decides each one: moving writes every 25 s, parked writes every 2.5 min,
 *    jitter writes never.
 * 4. Each accepted fix goes through `record_my_position()`, which itself
 *    refuses unless the caller is a delivery partner with this exact order
 *    assigned.
 * 5. App goes to background: one final fix is written, then the subscription
 *    stops. A dot older than 10 minutes is never shown anyway.
 *
 * Nothing here talks to a map, draws a dot, or formats a string. The customer's
 * screen reads `order_rider_position` (a different query) and decides what is
 * showable.
 */
export function useRiderPositionWriter() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const mine = useMyDeliveries();

  /*
   * Foreground is both a ref and state, on purpose. The ref is what the
   * AppState listener compares against (it must see the value synchronously,
   * outside render), and the state is what `shouldTrack` is derived from —
   * a ref read during render would not re-run the start/stop effect, so the
   * watcher could keep running after the app went to the background.
   */
  const foregroundRef = useRef(true);
  const [isForeground, setIsForeground] = useState(true);
  const lastWrittenAt = useRef<number | null>(null);
  const lastFix = useRef<Coordinates | null>(null);
  const watchRef = useRef<{ stop: () => void } | null>(null);
  const permission = useRef<'unknown' | 'granted' | 'denied'>('unknown');
  const [consented, setConsented] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      setConsented(await hasLocationConsent());
    })();
  }, []);

  const hasActiveDelivery = mine.data?.some(
    (order) => order.status === 'out_for_delivery' && order.assigned_to === userId,
  );
  const shouldTrack = Boolean(hasActiveDelivery && consented && isForeground);

  const stop = useCallback(() => {
    watchRef.current?.stop();
    watchRef.current = null;
  }, []);

  const restart = useCallback(async () => {
    stop();
    if (!shouldTrack) return;
    if (permission.current === 'denied') return;
    if (permission.current === 'unknown') {
      const granted = await requestForegroundPermission();
      permission.current = granted ? 'granted' : 'denied';
      if (!granted) return;
    }

    const watch = await watchPosition((fix) => {
      if (!fix || permission.current !== 'granted') return;
      const now = Date.now();
      const decision = shouldRecordPosition({
        hasActiveDelivery: true,
        isForeground: true,
        fix,
        lastRecordedAtMs: lastWrittenAt.current,
        lastFix: lastFix.current,
        nowMs: now,
      });
      if (!decision.write) return;

      void supabase.rpc('record_my_position', {
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_accuracy_m: fix.accuracyM ?? null,
      }).then(({ error }) => {
        if (error) {
          // A refused write is still information: log it, keep the throttle.
          console.warn('[rider] position write refused', error);
          return;
        }
        lastWrittenAt.current = now;
        lastFix.current = fix;
      });
    });
    watchRef.current = watch;
  }, [shouldTrack, stop]);

  // Start or stop whenever consent, foreground state, or the active delivery
  // changes. `restart` itself is stable across renders (its deps never change
  // under it), so this effect only re-runs when `shouldTrack` does.
  useEffect(() => {
    void restart();
  }, [restart, shouldTrack]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const wasForeground = foregroundRef.current;
      const next = state === 'active';
      foregroundRef.current = next;
      setIsForeground(next);

      if (wasForeground && !next) {
        // One final fix so the customer is not left with a stale dot, then stop.
        const fix = lastFix.current;
        if (fix) {
          void supabase.rpc('record_my_position', {
            p_lat: fix.lat,
            p_lng: fix.lng,
            p_accuracy_m: fix.accuracyM ?? null,
          });
          lastWrittenAt.current = Date.now();
        }
        stop();
      }
      if (!wasForeground && next) {
        void restart();
      }
    });
    return () => sub.remove();
  }, [restart, stop]);

  return null;
}
