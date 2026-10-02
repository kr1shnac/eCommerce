import '@/i18n';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState , useColorScheme } from 'react-native';

import { useAuthStore } from '@/store/auth-store';
import { useLanguageStore } from '@/store/language-store';
import { supabase } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const hydrate = useLanguageStore((state) => state.hydrate);
  const isReady = useLanguageStore((state) => state.isReady);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (isReady) void SplashScreen.hideAsync();
  }, [isReady]);

  // Keep the splash screen up until the saved language is known, so the first
  // paint is already in the right language.
  const authHydrate = useAuthStore((state) => state.setReady);
  const onSession = useAuthStore((state) => state.onSession);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      onSession(data.session ?? null);
      authHydrate();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      onSession(session ?? null);
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
  if (!isReady || !authReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}