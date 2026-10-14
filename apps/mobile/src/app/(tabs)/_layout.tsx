import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { KannadaFonts } from '@/constants/fonts';
import { Elevation } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { selectCartCount, useCartStore } from '@/store/cart-store';
import { useLanguageStore } from '@/store/language-store';

export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  // The bag's unit count, so a customer can see "there is something in there"
  // from any tab. Capped so a huge number does not stretch the badge.
  const cartCount = useCartStore(selectCartCount);
  const language = useLanguageStore((state) => state.language);

  // Tab labels are painted by the navigator, not by `ThemedText`, so they need
  // the Kannada face explicitly. A bundled face must not also carry a
  // `fontWeight`, so the two languages pick their weight differently.
  const labelFont =
    language === 'kn'
      ? { fontFamily: KannadaFonts.bold, fontWeight: 'normal' as const }
      : { fontWeight: '700' as const };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          ...Elevation.floating,
          shadowColor: theme.shadow,
        },
        // Icons fill in when active, so the current tab is obvious without
        // reading the label (KUNIGAL.md §2).
        tabBarLabelStyle: { fontSize: 12, ...labelFont },
        tabBarItemStyle: { paddingVertical: 4 },
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'storefront' : 'storefront-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: t('tabs.cart'),
          tabBarBadge: cartCount > 0 ? (cartCount > 99 ? '99+' : cartCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.secondary, color: theme.onSecondary },
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused || Platform.OS === 'ios' ? 'cart' : 'cart-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('tabs.orders'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
