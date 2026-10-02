import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const noopSubscribe = () => () => {};

/**
 * On web, static rendering happens on a server that cannot know the OS colour
 * scheme, so we must only report it once we are actually running in a browser.
 * useSyncExternalStore tells us which side we are on without the
 * setState-inside-an-effect round trip.
 */
export function useColorScheme() {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  return isClient ? colorScheme : 'light';
}