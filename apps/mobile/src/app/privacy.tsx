import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useStore } from '@/hooks/use-shop';

/**
 * Privacy and terms, inside the app.
 *
 * WHY THIS IS A SCREEN AND NOT JUST A LINK
 *
 * Both stores demand a privacy policy URL, and the shop will host one. But a URL
 * is a web page in a browser, in whatever language that page happens to be in —
 * which in this town means English, and roughly a third of our customers cannot
 * read a full sentence of it. The DPDP Act 2023 s.6(3) and the DPDP Rules 2025
 * Rule 3 say the notice must be accessible in English **or an Eighth Schedule
 * language**, and Kannada is one. So the notice lives here, as translated
 * content that renders offline, in the same warm voice as every other string
 * (KUNIGAL.md).
 *
 * The shop's real-world identity — its name, its street, its phone and its
 * FSSAI number — is the part a person actually checks, so it sits at the top
 * rather than buried at the bottom like a footer on a website.
 */
export default function PrivacyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shop = useStore();

  const store = shop.data;

  // Each section is a title plus one or more paragraphs, so the screen reads as
  // a short explanation rather than a legal wall.
  const sections: { heading: string; body: string[] }[] = [
    { heading: t('privacy.whatWeCollectTitle'), body: [t('privacy.whatWeCollectBody')] },
    { heading: t('privacy.whyTitle'), body: [t('privacy.whyBody')] },
    { heading: t('privacy.whoSeesTitle'), body: [t('privacy.whoSeesBody')] },
    { heading: t('privacy.consentTitle'), body: [t('privacy.consentBody')] },
    { heading: t('privacy.keepTitle'), body: [t('privacy.keepBody')] },
    { heading: t('privacy.rightsTitle'), body: [t('privacy.rightsBody')] },
    { heading: t('privacy.termsTitle'), body: [t('privacy.termsBody')] },
    { heading: t('privacy.questionsTitle'), body: [t('privacy.questionsBody')] },
  ];

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <IconButton
          icon="arrow-back"
          label={t('common.back')}
          onPress={() => router.back()}
        />
        <ThemedText type="subtitle" style={styles.headerTitle}>
          {t('account.privacyTitle')}
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        {/* Who you are dealing with. A neighbour, not a website. */}
        {store ? (
          <Card style={styles.shopCard}>
            <View style={styles.shopRow}>
              <Ionicons name="storefront-outline" size={22} color={theme.accent} />
              <ThemedText type="bodyStrong">{store.name}</ThemedText>
            </View>
            {store.address_line ? (
              <ThemedText type="small" themeColor="textSecondary">
                {store.address_line}
                {store.city ? `, ${store.city}` : ''}
              </ThemedText>
            ) : null}
            {store.phone || store.grievance_phone ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('privacy.grievanceLabel')}: {store.grievance_phone ?? store.phone}
              </ThemedText>
            ) : null}
            {/*
              The FSSAI number is shown when the shop has recorded one. It is not
              invented here: an empty string means the shop has not set it yet,
              and a placeholder number would be worse than none (register H6).
            */}
            {store.fssai_number ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('privacy.fssaiLabel')}: {store.fssai_number}
              </ThemedText>
            ) : null}
            {store.gstin ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('privacy.gstinLabel')}: {store.gstin}
              </ThemedText>
            ) : null}
          </Card>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary" style={styles.updated}>
          {t('privacy.lastUpdated')}
        </ThemedText>

        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <SectionHeader title={section.heading} />
            <Card style={styles.sectionCard}>
              {section.body.map((paragraph, index) => (
                <ThemedText key={index} type="small" themeColor="textSecondary">
                  {paragraph}
                </ThemedText>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerTitle: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  shopCard: { gap: Spacing.one },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  updated: { marginTop: Spacing.one },
  section: { gap: Spacing.one },
  sectionCard: { gap: Spacing.two },
});
