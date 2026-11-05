import { focusManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Refresh the shelf when the customer comes back (register A7).
 *
 * THE PROBLEM. React Query's "window focus" concept is a web idea: on the web,
 * switching tabs and returning is a free signal that the data may be old. A
 * phone app is backgrounded dozens of times a day, and none of that was reaching
 * React Query — `refetchOnWindowFocus` was explicitly `false` in
 * `lib/query-persistence.ts`, so a customer who checked a price, locked the
 * phone, and came back an hour later saw the hour-old price. In a shop whose
 * whole promise is "is it on the shelf today?", that is the wrong answer.
 *
 * THE RULE. `focusManager` is React Query's own bridge for exactly this: tell it
 * when the app is focused, and it will refetch only the queries whose `staleTime`
 * has passed. The shelf's is 5 minutes (`SHELF_STALE_MS`), so a quick glance at
 * the notification shade costs nothing, while a real return refreshes the
 * catalogue, the shop's open/closed state and the product page.
 *
 * WHY NOT `invalidateQueries` ON EVERY RESUME. That would throw away good data
 * and show a spinner for a two-second glance at the clock, on the patchy
 * connection this app is built for. Staleness is the honest test, and React
 * Query already owns it.
 *
 * This is device behaviour, not arithmetic, so there is no pure function to
 * test here; the wiring is proved by typecheck + the fact that it compiles into
 * the root layout. **It has not been seen on a phone yet** — see HANDOFF §6.3.
 */
export function useRefreshOnResume(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });

    // This hook mounts while the app is already running, so seed the state once
    // rather than waiting for the first background→active transition.
    focusManager.setFocused(AppState.currentState === 'active');

    return () => subscription.remove();
  }, []);
}
