import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * One translated banner for the whole app when there is no internet (rule 9.3).
 *
 * Deliberately a hook and not a modal: a customer on a patchy connection in Kunigal
 * should see "you are offline" and keep shopping, not have to dismiss a dialog.
 *
 * `isInternetReachable` is null while NetInfo is still asking, so treat that as
 * "assume online" and never flash a banner on a cold start.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setIsOnline(reachable === false ? false : state.isConnected !== false);
    });

    // Ask once immediately, otherwise the banner only appears after the first
    // failed request.
    void NetInfo.fetch().then((state) => {
      const reachable = state.isInternetReachable;
      setIsOnline(reachable === false ? false : state.isConnected !== false);
    });

    return unsubscribe;
  }, []);

  return isOnline;
}