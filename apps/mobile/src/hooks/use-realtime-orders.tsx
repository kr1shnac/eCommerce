import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { useProfile } from '@/hooks/use-profile';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import type { Order } from '@/types/database';

/**
 * One Supabase Realtime channel for the whole app.
 *
 * HOW IT IS USED
 *   * Every order query shares the `['orders', ...]` key prefix, so a change to
 *     any order only has to invalidate that prefix. That is the whole job here:
 *     an event is a *doorbell*, and the data is re-read through the normal
 *     RLS-protected REST call. The event payload is never rendered, so an app bug
 *     cannot turn a stream of other people's rows into an on-screen leak.
 *   * Riders and the owner also want to be *told* a new order arrived. A screen
 *     can subscribe to the raw events with `useOrderEventListener` and, say,
 *     vibrate a phone in a pocket.
 *
 * WHO HEARS WHAT
 *   Postgres Changes enforces RLS on the Realtime server. supabase-js sends the
 *   signed-in user's JWT automatically (through the Realtime client's
 *   accessToken callback), so a customer is delivered only their own orders and
 *   a signed-out socket is delivered nothing at all. This file does not relax
 *   that; it relies on it. See migration 20261013000002 and ROADMAP §11.
 *
 * WHY A CUSTOMER'S SOCKET IS ALSO FILTERED (register SCALE-1)
 *   RLS is the security boundary, but it is not free: every order change is
 *   matched against every subscriber. Riders and the owner genuinely need that
 *   (the rider screen watches the unclaimed pool, which is a query no single
 *   row's `user_id` can express), so their sockets stay broad. A customer needs
 *   exactly one person's orders, and saying so with an equality filter lets the
 *   server discard other people's changes before it does the per-subscriber
 *   work. With fifty customers watching their own lunch, a change is then
 *   interesting to one socket instead of fifty.
 *
 *   The filter is a performance measure, never a permission: it is absent for
 *   staff, and if a filter were ever wrong the omitted RLS check is still there
 *   underneath. See SCALE-AND-TRACKING.md §5.
 */

export type OrderEvent =
  | { type: 'INSERT'; order: Order }
  | { type: 'UPDATE'; order: Order }
  | { type: 'DELETE'; orderId: string };

type Listener = (event: OrderEvent) => void;
type RealtimeContextValue = { subscribe: (listener: Listener) => () => void };

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Mount once, just inside the QueryClientProvider. It opens a single websocket
 * channel for the signed-in user and drops it on sign-out.
 */
export function RealtimeOrdersProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  // The role decides whether the socket can be narrowed. It comes from the same
  // query the role gate already runs, so this costs no extra request.
  const role = useProfile().data?.role ?? null;
  const listeners = useRef(new Set<Listener>());

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    // No session: nothing to hear, and an anon socket would be sent nothing
    // anyway. And with no Supabase project configured there is no session to
    // have, so do not even try to open a socket to the placeholder URL. Wait
    // until somebody is signed in, then listen.
    if (!userId || !isSupabaseConfigured) return;

    // One equality filter for a customer, nothing for staff (see the note at the
    // top of the file). A null role means the profile has not loaded yet OR it
    // failed: subscribe unfiltered rather than not at all, because a customer
    // with no realtime is worse than one extra RLS check, and RLS still decides.
    const filter = role === 'customer' ? `user_id=eq.${userId}` : undefined;

    const channel = supabase
      .channel(`orders:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          // Invalidate first: the refetch is what actually updates the screen.
          void queryClient.invalidateQueries({ queryKey: ['orders'] });

          const event: OrderEvent =
            payload.eventType === 'DELETE'
              ? { type: 'DELETE', orderId: String((payload.old as Partial<Order>)?.id ?? '') }
              : { type: payload.eventType, order: payload.new as Order };

          listeners.current.forEach((listener) => listener(event));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role, queryClient]);

  const value = useMemo(() => ({ subscribe }), [subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * Subscribe to raw order events for as long as `enabled` is true. The listener
 * is held in a ref so a screen does not have to wrap it in `useCallback` to stop
 * the channel from being torn down and rebuilt on every render.
 *
 * Safe to call outside the provider (for example on the shop screens a
 * signed-out visitor can reach): it simply never fires.
 */
export function useOrderEventListener(listener: Listener, enabled = true) {
  const context = useContext(RealtimeContext);
  const latest = useRef(listener);

  useEffect(() => {
    latest.current = listener;
  }, [listener]);

  useEffect(() => {
    if (!context || !enabled) return;
    return context.subscribe((event) => latest.current(event));
  }, [context, enabled]);
}
