import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { LoadingState, StateMessage } from '@/components/state-message';
import { ThemedText } from '@/components/themed-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Spacing } from '@/constants/theme';
import { useInvoice } from '@/hooks/use-invoice';
import { useTheme } from '@/hooks/use-theme';
import {
  buildInvoiceHtml,
  gstPercentLabel,
  istDateTimeLabel,
  type InvoiceTranslate,
} from '@/lib/invoice-html';
import { localizedName } from '@/lib/localized';
import { formatPaise } from '@/lib/money';
import { useLanguageStore } from '@/store/language-store';

/**
 * The invoice, as a document the customer can keep.
 *
 * Every figure on this screen comes from `order_invoice()` — the same function
 * the PDF is built from — so the preview and the file can never disagree. The
 * screen renders it natively (readable on a cheap phone, in the chosen language,
 * in light and dark) and the buttons turn the SAME data into a printable A4 PDF.
 *
 * Why a PDF at all, in a town where most customers use a phone: a GST invoice is
 * often needed by somebody else — an office reimbursement, a shop's own books, a
 * tax officer. The customer keeps the app screen; the PDF is what they can hand
 * over.
 */
export default function InvoiceScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();

  const orderId = typeof params.id === 'string' ? params.id : null;
  const invoice = useInvoice(orderId);
  const language = useLanguageStore((state) => state.language);

  const [busy, setBusy] = useState<'share' | 'print' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = invoice.data && invoice.data.ok ? invoice.data : null;
  const notFound = invoice.data && !invoice.data.ok;

  /**
   * The HTML for the PDF. Built once per action from the same invoice the screen
   * is showing; `t` is passed in so the document is in the customer's language.
   */
  const html = () =>
    data
      ? buildInvoiceHtml(data, language, t as unknown as InvoiceTranslate)
      : '';

  const onShare = async () => {
    if (!data || busy) return;
    setActionError(null);
    setBusy('share');
    try {
      const { uri } = await Print.printToFileAsync({ html: html() });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: t('invoice.shareTitle'),
        });
      } else {
        // No share sheet (rare on Android, absent on some emulators): still give
        // the customer the file through the print dialog rather than nothing.
        await Print.printAsync({ uri });
      }
    } catch (error) {
      console.warn('[invoice] could not share the PDF', error);
      setActionError('invoice.shareFailed');
    } finally {
      setBusy(null);
    }
  };

  const onPrint = async () => {
    if (!data || busy) return;
    setActionError(null);
    setBusy('print');
    try {
      await Print.printAsync({ html: html() });
    } catch (error) {
      console.warn('[invoice] could not open the print dialog', error);
      setActionError('invoice.printFailed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      <OfflineBanner />

      <View style={styles.headerRow}>
        <IconButton
          icon="arrow-back"
          label={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/orders'))}
        />
        <ThemedText type="subtitle" style={styles.flex} numberOfLines={1}>
          {t('invoice.screenTitle')}
        </ThemedText>
        {data ? (
          <Badge
            label={data.is_tax_invoice ? t('invoice.title.tax') : t('invoice.title.supply')}
            tone="neutral"
            icon="document-text-outline"
          />
        ) : null}
      </View>

      {invoice.isLoading ? (
        <LoadingState label={t('invoice.loading')} />
      ) : invoice.isError || notFound || !data ? (
        <StateMessage
          title={t('invoice.errorTitle')}
          hint={t('invoice.errorHint')}
          onRetry={invoice.refetch}
          tone="danger"
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
          <Card style={styles.section}>
            <View style={styles.docHead}>
              <View style={styles.flex}>
                <ThemedText type="bodyStrong">{data.seller.name}</ThemedText>
                {data.seller.address_line ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {data.seller.address_line}
                    {data.seller.city ? `, ${data.seller.city}` : ''}
                  </ThemedText>
                ) : null}
                {data.seller.phone ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('invoice.phone')}: {data.seller.phone}
                  </ThemedText>
                ) : null}
                {data.seller.gstin ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('invoice.gstin')}: {data.seller.gstin}
                  </ThemedText>
                ) : null}
                {data.seller.fssai_number ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('invoice.fssai')}: {data.seller.fssai_number}
                  </ThemedText>
                ) : null}
              </View>
              <Ionicons name="receipt-outline" size={28} color={theme.accent} />
            </View>

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

            <Row label={t('invoice.invoiceNo')} value={data.invoice_number} mono />
            <Row label={t('invoice.date')} value={istDateTimeLabel(data.placed_at)} />
            <Row label={t('invoice.orderNo')} value={data.order_number} />
            <Row
              label={t('invoice.payment')}
              value={`${t(`invoice.method.${data.payment_method}`)} · ${t(`invoice.status.${data.payment_status}`)}`}
            />
            {data.payment_reference ? (
              <Row label={t('invoice.reference')} value={data.payment_reference} mono />
            ) : null}
          </Card>

          <ThemedText type="heading" style={styles.sectionTitle}>
            {t('invoice.buyer')}
          </ThemedText>
          <Card style={styles.section}>
            <ThemedText type="bodyStrong">{data.buyer.full_name ?? '—'}</ThemedText>
            <ThemedText type="small">
              {[data.buyer.line1, data.buyer.line2, data.buyer.landmark, data.buyer.city, data.buyer.pincode]
                .filter(Boolean)
                .join(', ')}
            </ThemedText>
            {data.buyer.phone ? (
              <ThemedText type="small" themeColor="textSecondary">
                {data.buyer.phone}
              </ThemedText>
            ) : null}
          </Card>

          <ThemedText type="heading" style={styles.sectionTitle}>
            {t('invoice.itemsTitle')}
          </ThemedText>
          <Card style={styles.section}>
            {data.lines.map((line, index) => (
              <View key={`${line.name_en}-${index}`} style={styles.lineRow}>
                <View style={styles.flex}>
                  <ThemedText type="small" numberOfLines={2}>
                    {line.quantity} × {localizedName(line, language)}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {line.hsn_code ? `HSN ${line.hsn_code} · ` : ''}
                    {t('invoice.gstRate', { rate: gstPercentLabel(line.gst_rate_bp) })}
                    {line.discount_paise > 0
                      ? ` · ${t('invoice.lineDiscount', { amount: formatPaise(line.discount_paise) })}`
                      : ''}
                  </ThemedText>
                </View>
                <View style={styles.lineMoney}>
                  <ThemedText type="small">{formatPaise(line.net_paise)}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {t('invoice.taxOf', { amount: formatPaise(line.tax_paise) })}
                  </ThemedText>
                </View>
              </View>
            ))}

            {data.delivery.fee_paise > 0 ? (
              <View style={styles.lineRow}>
                <View style={styles.flex}>
                  <ThemedText type="small">
                    {t('invoice.delivery')}
                    {data.is_express ? ` · ${t('invoice.express')}` : ''}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {t('invoice.gstRate', {
                      rate: gstPercentLabel(data.delivery.gst_rate_bp),
                    })}
                  </ThemedText>
                </View>
                <ThemedText type="small">{formatPaise(data.delivery.fee_paise)}</ThemedText>
              </View>
            ) : null}

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

            <Row label={t('invoice.subtotal')} value={formatPaise(data.totals.subtotal_paise)} />
            {data.totals.discount_paise > 0 ? (
              <Row
                label={t('invoice.discount')}
                value={`-${formatPaise(data.totals.discount_paise)}`}
              />
            ) : null}
            <Row label={t('invoice.totalTaxable')} value={formatPaise(data.totals.taxable_paise)} />
            {data.is_tax_invoice && data.is_intra_state ? (
              <>
                <Row label={t('invoice.cgst')} value={formatPaise(data.totals.cgst_paise)} />
                <Row label={t('invoice.sgst')} value={formatPaise(data.totals.sgst_paise)} />
              </>
            ) : null}
            {data.is_tax_invoice && !data.is_intra_state ? (
              <Row label={t('invoice.igst')} value={formatPaise(data.totals.igst_paise)} />
            ) : null}
            <Row label={t('invoice.total')} value={formatPaise(data.totals.total_paise)} strong />
          </Card>

          {!data.is_tax_invoice ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              {t('invoice.billOfSupplyNote')}
            </ThemedText>
          ) : null}

          {data.notes ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              {t('invoice.notes')}: {data.notes}
            </ThemedText>
          ) : null}

          {actionError ? (
            <ThemedText type="small" style={{ color: theme.danger, textAlign: 'center' }}>
              {t(actionError)}
            </ThemedText>
          ) : null}

          <Button
            label={busy === 'share' ? t('common.pleaseWait') : t('invoice.share')}
            icon="download-outline"
            size="lg"
            fullWidth
            busy={busy === 'share'}
            disabled={busy !== null}
            onPress={() => void onShare()}
            style={styles.action}
          />
          <Button
            label={busy === 'print' ? t('common.pleaseWait') : t('invoice.print')}
            icon="print-outline"
            variant="outline"
            size="lg"
            fullWidth
            busy={busy === 'print'}
            disabled={busy !== null}
            onPress={() => void onPrint()}
            style={styles.action}
          />

          <ThemedText type="caption" themeColor="textSecondary" style={styles.note}>
            {t('invoice.computerGenerated')}
          </ThemedText>
        </ScrollView>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor={strong ? 'text' : 'textSecondary'} style={styles.flex}>
        {label}
      </ThemedText>
      <ThemedText type={strong ? 'bodyStrong' : 'small'} style={mono ? styles.mono : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  section: { gap: Spacing.one },
  sectionTitle: { marginTop: Spacing.two },
  docHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 2,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  lineMoney: { alignItems: 'flex-end' },
  mono: { fontVariant: ['tabular-nums'] },
  note: { textAlign: 'center' },
  action: { marginTop: Spacing.one },
});
