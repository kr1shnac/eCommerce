import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { KannadaFonts } from '@/constants/fonts';
import { Elevation } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguageStore } from '@/store/language-store';

/**
 * The shop owner's face: a live order board, the team list, and the shelf and
 * offer tools. It lives in the app (not the web panel) so the owner can run the
 * shop from a phone, standing at the counter. The web panel stays only as an
 * optional desk tool for bulk catalogue edits.
 */
export default function AdminLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((state) => state.language);

  // See `(tabs)/_layout.tsx`: tab labels are the navigator's text, not
  // `ThemedText`, so Kannada needs the bundled face named here.
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
        tabBarLabelStyle: { fontSize: 12, ...labelFont },
        sceneStyle: { backgroundColor: theme.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('admin.board'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: t('admin.today'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'cash' : 'cash-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="coupons"
        options={{
          title: t('admin.coupons'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'pricetags' : 'pricetags-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shelf"
        options={{
          title: t('admin.shelf'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'pricetag' : 'pricetag-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="photos"
        options={{
          title: t('admin.photos'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'images' : 'images-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: t('admin.team'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
