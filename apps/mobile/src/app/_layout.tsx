import '@/i18n';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useProfile } from '@/hooks/use-profile';
import { RealtimeOrdersProvider } from '@/hooks/use-realtime-orders';
import { useRefreshOnResume } from '@/hooks/use-refresh-on-resume';
import { useResolvedScheme, useTheme } from '@/hooks/use-theme';
import {
  setCrashReportingUser,
  startCrashReporting,
  wrapWithCrashReporting,
} from '@/lib/crash-reporting';
import { persistOptions, queryClient } from '@/lib/query-persistence';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { useLanguageStore } from '@/store/language-store';
import { useThemeStore } from '@/store/theme-store';

SplashScreen.preventAutoHideAsync();

// Started at module scope, before the first component renders, so an error thrown
// while the tree is being built is still captured. A no-op when no DSN is set.
startCrashReporting();

function RootLayout() {
  const scheme = useResolvedScheme();
  const theme = useTheme();
  const hydrate = useLanguageStore((state) => state.hydrate);
  const isReady = useLanguageStore((state) => state.isReady);
  const themeReady = useThemeStore((state) => state.isReady);

  // A7: the shelf refreshes when the customer comes back to the app, once the
  // data is older than its `staleTime`. See the hook for why this is not an
  // invalidate-everything.
  useRefreshOnResume();

  // The Kannada face is bundled (assets/fonts) so the language looks the same on
  // every phone. Latin keeps the system font; only `ThemedText` in Kannada
  // switches. Loading happens once, before the first frame, so no text flashes
  // in the wrong shape.
  const [fontsLoaded, fontError] = useFonts({
    'NotoSansKannada-Regular': require('../../assets/fonts/NotoSansKannada-Regular.ttf'),
    'NotoSansKannada-SemiBold': require('../../assets/fonts/NotoSansKannada-SemiBold.ttf'),
    'NotoSansKannada-Bold': require('../../assets/fonts/NotoSansKannada-Bold.ttf'),
    'NotoSansKannada-ExtraBold': require('../../assets/fonts/NotoSansKannada-ExtraBold.ttf'),
  });
  // A font that fails to load is not fatal: the system face still draws Kannada.
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontError) console.warn('[fonts] could not load Noto Sans Kannada', fontError);
  }, [fontError]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (isReady && fontsReady) void SplashScreen.hideAsync();
  }, [isReady, fontsReady]);

  // The navigation container paints behind every screen during a transition.
  // Left on React Navigation's defaults it would flash stark white (light) or
  // pure black (dark) between our cream and charcoal screens, so it is built
  // from the same palette the screens use.
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme.background,
        card: theme.card,
        text: theme.text,
        border: theme.border,
        primary: theme.accent,
        notification: theme.secondary,
      },
    };
  }, [scheme, theme]);

  // Keep the splash screen up until the saved language is known, so the first
  // paint is already in the right language.
  const authHydrate = useAuthStore((state) => state.setReady);
  const onSession = useAuthStore((state) => state.onSession);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      onSession(data.session ?? null);
      setCrashReportingUser(data.session?.user.id ?? null);
      authHydrate();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      onSession(session ?? null);
      // Crash reports are tied to an opaque user id, never a name or a phone
      // number. Cleared on sign-out so the next person's crashes are not filed
      // under the previous person's account.
      setCrashReportingUser(session?.user.id ?? null);
    });

    // Keep the token fresh even if the app returns from the background.
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void supabase.auth.getSession().then(({ data }) => onSession(data.session ?? null));
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
      appStateListener.remove();
    };
  }, [authHydrate, onSession]);

  const authReady = useAuthStore((state) => state.isReady);

  // Hold the splash one beat longer until the saved language, the saved
  // light/dark choice AND the Kannada font are all known, so nothing flashes on
  // the first frame.
  if (!isReady || !authReady || !themeReady || !fontsReady) return null;

  return (
    // `PersistQueryClientProvider` restores the saved catalogue before the first
    // paint, so a customer opening the app in a dead spot sees the shelves rather
    // than a spinner. Only public shop data is written — see query-persistence.ts.
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {/* The rider map (components/rider-map.tsx) is built on the gesture
          handler, and Android requires its root view above anything that
          recognises a gesture. */}
      <GestureHandlerRootView style={styles.root}>
        <ThemeProvider value={navTheme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <RealtimeOrdersProvider>
            <RootNavigator />
          </RealtimeOrdersProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </PersistQueryClientProvider>
  );
}

/**
 * Which face of the app you get is decided by `profiles.role`, and nothing else.
 *
 * The app only decides what to SHOW. What is ALLOWED is still decided by
 * Postgres (RLS + the guard triggers), so a mistake here changes the look of the
 * screen, never the permissions behind it. See ROADMAP §2.
 *
 *   delivery -> the deliveries screen (no shop tabs, no checkout)
 *   admin    -> the shop board, and the customer view on request
 *   everyone else (customer or signed out) -> the normal shop
 */
function RootNavigator() {
  const theme = useTheme();
  const session = useAuthStore((state) => state.session);
  const profile = useProfile();

  const role = profile.data?.role ?? null;

  // A signed-in person whose role we have not read yet: hold one moment rather
  // than flashing the shop and then jumping to a different face.
  //
  // This is an OVERLAY, not an early return. Returning early unmounts the whole
  // <Stack>, and expo-router rebuilds its state on the way back up — which threw
  // away the URL the person opened. Measured, headless Chrome, signed in:
  // opening /product/<id> rendered the product screen, then this branch ran,
  // then the app came back on `/address?id=<id>` and from there on `/`. The
  // board behaved the same way: /admin/today came back on /admin. So a deep
  // link — a push notification's "see your order", next on the roadmap — would
  // have dropped the person on the home screen with no explanation. The navigator
  // stays mounted; the spinner covers it for a moment instead.
  const holding = Boolean(session && profile.isLoading);

  const riderGuard = role === 'delivery';
  const adminGuard = role === 'admin';
  // The shop is the fallback face: signed-out visitors, plain customers, and the
  // owner (who keeps a "customer view" to see the app as their buyers do).
  const customerGuard = !session || role === null || role === 'customer' || role === 'admin';

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Protected guard={riderGuard}>
          <Stack.Screen name="rider" />
        </Stack.Protected>
        <Stack.Protected guard={adminGuard}>
          <Stack.Screen name="admin" />
        </Stack.Protected>
        <Stack.Protected guard={customerGuard}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>

      {holding ? (
        <View style={[styles.holding, { backgroundColor: theme.background }]}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
    </>
  );
}

/**
 * The wrapped export. `Sentry.wrap` is what turns an unhandled render error into
 * a report instead of a white screen. When no DSN is configured this is the
 * identity function — `RootLayout` exactly as written.
 */
export default wrapWithCrashReporting(RootLayout);

const styles = StyleSheet.create({
  // Covers the navigator while the role is read, so the app never flashes the
  // shop and then jumps to a different face. Absolute, because the navigator
  // below must stay mounted for the URL to survive.
  holding: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1 },
});
