import { formatPaise } from '@/lib/money';
import type { Invoice, InvoiceLine, PaymentMethod } from '@/types/database';

/**
 * The invoice as a printable document.
 *
 * WHAT THIS FILE DOES NOT DO: it does not compute tax. Every money figure below
 * comes from `order_invoice()` (migration 20261112000001), which is the single
 * place the arithmetic lives. This file's only jobs are layout and language.
 * That is deliberate — two implementations of GST rounding is how a shop ends
 * up issuing a document that does not match its own books.
 *
 * The one number it derives is the per-rate summary's grouping, which is a SUM
 * of the database's own per-line figures. It is asserted (defensively) to add up
 * to the database's totals before it is printed.
 *
 * Language: the document is written in the language the customer is using, with
 * the legal document class ("TAX INVOICE" / "BILL OF SUPPLY") also printed in
 * English, because that is what an officer looks for. Shop and product names come
 * from the snapshot on the order, never from today's catalogue.
 */

export type InvoiceTranslate = (
  key: string,
  options?: Record<string, string | number>,
) => string;

export type InvoiceLanguage = 'en' | 'kn';

/** Escape text that came from a customer or a database row. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A timestamp as an Indian reader expects it: `DD/MM/YYYY, HH:MM` in IST.
 *
 * Hand-rolled rather than `Intl`, for the same reason `formatPaise` is: Hermes
 * on Android and iOS do not ship identical locale data, and an invoice date
 * that changes shape between phones is not acceptable on a document. IST has no
 * daylight saving, so a fixed +05:30 is exact.
 */
export function istDateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';

  const ist = new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

/** `500` basis points -> `"5%"`, `1250` -> `"12.5%"`. */
export function gstPercentLabel(rateBp: number): string {
  const percent = rateBp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, '')}%`;
}

function paymentMethodLabel(method: PaymentMethod, t: InvoiceTranslate): string {
  switch (method) {
    case 'cod':
      return t('invoice.method.cod');
    case 'upi':
      return t('invoice.method.upi');
    case 'card':
      return t('invoice.method.card');
    case 'netbanking':
      return t('invoice.method.netbanking');
    case 'wallet':
      return t('invoice.method.wallet');
    default:
      return t('invoice.method.online');
  }
}

function paymentStatusLabel(invoice: Invoice, t: InvoiceTranslate): string {
  const base = t(`invoice.status.${invoice.payment_status}`);
  return invoice.payment_reference
    ? `${base} · ${invoice.payment_reference}`
    : base;
}

function lineName(line: InvoiceLine, language: InvoiceLanguage): string {
  if (language === 'kn' && line.name_kn) return line.name_kn;
  return line.name_en;
}

/** One rate group for the tax summary. */
type RateGroup = {
  rateBp: number;
  taxablePaise: number;
  taxPaise: number;
};

/**
 * Group the database's per-line figures by rate. Sums only — no rounding, no
 * re-derivation — so the summary can never disagree with the lines above it.
 * The delivery line is included as its own group, because it is taxed too.
 */
export function groupTaxByRate(invoice: Invoice): RateGroup[] {
  const groups = new Map<number, RateGroup>();

  const add = (rateBp: number, taxablePaise: number, taxPaise: number) => {
    const existing = groups.get(rateBp) ?? { rateBp, taxablePaise: 0, taxPaise: 0 };
    existing.taxablePaise += taxablePaise;
    existing.taxPaise += taxPaise;
    groups.set(rateBp, existing);
  };

  for (const line of invoice.lines) {
    add(line.gst_rate_bp, line.taxable_paise, line.tax_paise);
  }

  if (invoice.delivery.fee_paise > 0) {
    add(
      invoice.delivery.gst_rate_bp,
      invoice.delivery.taxable_paise,
      invoice.delivery.tax_paise,
    );
  }

  return [...groups.values()].sort((a, b) => a.rateBp - b.rateBp);
}

/**
 * Build the whole document as one self-contained HTML string.
 *
 * Self-contained on purpose: `expo-print` renders it in a WebView with no
 * network, and an invoice must not depend on a CDN being reachable from a shop
 * in Kunigal. No external fonts, no images, no scripts.
 */
export function buildInvoiceHtml(
  invoice: Invoice,
  language: InvoiceLanguage,
  t: InvoiceTranslate,
): string {
  const groups = groupTaxByRate(invoice);
  const summaryTaxable = groups.reduce((sum, group) => sum + group.taxablePaise, 0);
  const summaryTax = groups.reduce((sum, group) => sum + group.taxPaise, 0);

  // A defensive check, not a second calculation: if the summary ever stopped
  // adding up to the database's totals, printing it would put a wrong number on
  // a legal document. The lines and totals below are printed from the database
  // regardless; only the summary is withheld.
  const summaryIsConsistent =
    summaryTaxable === invoice.totals.taxable_paise &&
    summaryTax === invoice.totals.tax_paise;

  const documentTitle = invoice.is_tax_invoice
    ? t('invoice.title.tax')
    : t('invoice.title.supply');

  const sellerAddress = [invoice.seller.address_line, invoice.seller.city]
    .filter(Boolean)
    .join(', ');

  const buyerAddress = [
    invoice.buyer.line1,
    invoice.buyer.line2,
    invoice.buyer.landmark,
    invoice.buyer.city,
    invoice.buyer.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  const rows = invoice.lines
    .map((line, index) => {
      const name = lineName(line, language);
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(name)}</div>
            ${line.unit ? `<div class="item-unit">${escapeHtml(line.unit)}</div>` : ''}
          </td>
          <td class="mono">${line.hsn_code ? escapeHtml(line.hsn_code) : '—'}</td>
          <td class="num">${line.quantity}</td>
          <td class="num">${formatPaise(line.price_paise)}</td>
          <td class="num">${formatPaise(line.net_paise)}</td>
          <td class="num">${gstPercentLabel(line.gst_rate_bp)}</td>
          <td class="num">${formatPaise(line.tax_paise)}</td>
          <td class="num strong">${formatPaise(line.net_paise)}</td>
        </tr>`;
    })
    .join('');

  const deliveryRow =
    invoice.delivery.fee_paise > 0
      ? `
        <tr>
          <td class="num">${invoice.lines.length + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(t('invoice.delivery'))}</div>
            ${invoice.is_express ? `<div class="item-unit">${escapeHtml(t('invoice.express'))}</div>` : ''}
          </td>
          <td class="mono">9968</td>
          <td class="num">1</td>
          <td class="num">${formatPaise(invoice.delivery.fee_paise)}</td>
          <td class="num">${formatPaise(invoice.delivery.taxable_paise)}</td>
          <td class="num">${gstPercentLabel(invoice.delivery.gst_rate_bp)}</td>
          <td class="num">${formatPaise(invoice.delivery.tax_paise)}</td>
          <td class="num strong">${formatPaise(invoice.delivery.fee_paise)}</td>
        </tr>`
      : '';

  const summaryRows = summaryIsConsistent
    ? groups
        .map(
          (group) => `
        <tr>
          <td class="num">${gstPercentLabel(group.rateBp)}</td>
          <td class="num">${formatPaise(group.taxablePaise)}</td>
          <td class="num">${formatPaise(group.taxPaise)}</td>
        </tr>`,
        )
        .join('')
    : '';

  const taxSplit = invoice.is_tax_invoice
    ? invoice.is_intra_state
      ? `
        <tr><td>${escapeHtml(t('invoice.cgst'))}</td><td class="num">${formatPaise(invoice.totals.cgst_paise)}</td></tr>
        <tr><td>${escapeHtml(t('invoice.sgst'))}</td><td class="num">${formatPaise(invoice.totals.sgst_paise)}</td></tr>`
      : `
        <tr><td>${escapeHtml(t('invoice.igst'))}</td><td class="num">${formatPaise(invoice.totals.igst_paise)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(documentTitle)} ${escapeHtml(invoice.invoice_number)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Noto Sans Kannada', 'Nirmala UI', -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #16181d;
    font-size: 11px;
    line-height: 1.45;
  }
  .sheet { padding: 4px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #16181d; padding-bottom: 10px; }
  .shop-name { font-size: 20px; font-weight: 800; letter-spacing: 0.2px; }
  .shop-meta { margin-top: 3px; color: #4a4f5a; font-size: 10.5px; }
  .doc { text-align: right; }
  .doc-title { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; }
  .doc-title-en { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 2px; }
  .doc-number { margin-top: 6px; font-family: 'Courier New', monospace; font-size: 11px; }
  .parties { display: flex; gap: 18px; margin-top: 12px; }
  .party { flex: 1; }
  .party-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.9px; color: #6b7280; margin-bottom: 3px; }
  .party-name { font-weight: 700; font-size: 12px; }
  .party-line { color: #3f4450; }
  .meta { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 10.5px; }
  .meta span b { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  thead th { background: #eef0f4; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #3f4450; padding: 6px 5px; border-bottom: 1px solid #c9ced8; text-align: left; }
  tbody td { padding: 6px 5px; border-bottom: 1px solid #e4e7ee; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .mono { font-family: 'Courier New', monospace; }
  .strong { font-weight: 700; }
  .item-name { font-weight: 600; }
  .item-unit { color: #6b7280; font-size: 9.5px; }
  .summary { margin-top: 14px; display: flex; gap: 18px; align-items: flex-start; }
  .summary-table { flex: 1; margin-top: 0; }
  .summary-table thead th { font-size: 8.5px; }
  .totals { width: 46%; margin-left: auto; }
  .totals table { margin-top: 0; }
  .totals td { padding: 4px 5px; border-bottom: 1px solid #e4e7ee; }
  .totals tr.grand td { border-top: 2px solid #16181d; border-bottom: none; font-size: 14px; font-weight: 800; padding-top: 7px; }
  .totals tr.tax td { color: #3f4450; }
  .note { margin-top: 10px; font-size: 9.5px; color: #6b7280; }
  .foot { margin-top: 16px; border-top: 1px solid #c9ced8; padding-top: 8px; display: flex; justify-content: space-between; gap: 12px; font-size: 9.5px; color: #6b7280; }
</style>
</head>
<body>
<div class="sheet">
  <div class="head">
    <div>
      <div class="shop-name">${escapeHtml(invoice.seller.name)}</div>
      ${sellerAddress ? `<div class="shop-meta">${escapeHtml(sellerAddress)}</div>` : ''}
      <div class="shop-meta">
        ${invoice.seller.phone ? `${escapeHtml(t('invoice.phone'))}: ${escapeHtml(invoice.seller.phone)}` : ''}
        ${invoice.seller.gstin ? ` &nbsp;·&nbsp; GSTIN: <b>${escapeHtml(invoice.seller.gstin)}</b>` : ''}
        ${invoice.seller.fssai_number ? ` &nbsp;·&nbsp; FSSAI: ${escapeHtml(invoice.seller.fssai_number)}` : ''}
      </div>
    </div>
    <div class="doc">
      <div class="doc-title">${escapeHtml(documentTitle)}</div>
      <div class="doc-title-en">${invoice.is_tax_invoice ? 'Tax Invoice' : 'Bill of Supply'}</div>
      <div class="doc-number">${escapeHtml(invoice.invoice_number)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <div class="party-label">${escapeHtml(t('invoice.buyer'))}</div>
      <div class="party-name">${escapeHtml(invoice.buyer.full_name ?? '—')}</div>
      <div class="party-line">${escapeHtml(buyerAddress)}</div>
      ${invoice.buyer.phone ? `<div class="party-line">${escapeHtml(t('invoice.phone'))}: ${escapeHtml(invoice.buyer.phone)}</div>` : ''}
    </div>
    <div class="party">
      <div class="party-label">${escapeHtml(t('invoice.details'))}</div>
      <div class="party-line">${escapeHtml(t('invoice.orderNo'))}: <b>${escapeHtml(invoice.order_number)}</b></div>
      <div class="party-line">${escapeHtml(t('invoice.date'))}: ${escapeHtml(istDateTimeLabel(invoice.placed_at))}</div>
      <div class="party-line">${escapeHtml(t('invoice.placeOfSupply'))}: ${escapeHtml(invoice.place_of_supply_state_code ?? '29')}</div>
      <div class="party-line">${escapeHtml(t('invoice.payment'))}: ${escapeHtml(paymentMethodLabel(invoice.payment_method, t))} · ${escapeHtml(paymentStatusLabel(invoice, t))}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num" style="width:22px">#</th>
        <th>${escapeHtml(t('invoice.col.item'))}</th>
        <th style="width:52px">${escapeHtml(t('invoice.col.hsn'))}</th>
        <th class="num" style="width:34px">${escapeHtml(t('invoice.col.qty'))}</th>
        <th class="num" style="width:64px">${escapeHtml(t('invoice.col.rate'))}</th>
        <th class="num" style="width:66px">${escapeHtml(t('invoice.col.taxable'))}</th>
        <th class="num" style="width:40px">${escapeHtml(t('invoice.col.gstRate'))}</th>
        <th class="num" style="width:58px">${escapeHtml(t('invoice.col.gst'))}</th>
        <th class="num" style="width:68px">${escapeHtml(t('invoice.col.amount'))}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      ${deliveryRow}
    </tbody>
  </table>

  <div class="summary">
    ${
      summaryIsConsistent
        ? `<div class="summary-table">
      <div class="party-label">${escapeHtml(t('invoice.rateSummary'))}</div>
      <table>
        <thead>
          <tr>
            <th class="num">${escapeHtml(t('invoice.col.gstRate'))}</th>
            <th class="num">${escapeHtml(t('invoice.col.taxable'))}</th>
            <th class="num">${escapeHtml(t('invoice.col.gst'))}</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>`
        : '<div class="summary-table"></div>'
    }
    <div class="totals">
      <table>
        <tbody>
          <tr><td>${escapeHtml(t('invoice.subtotal'))}</td><td class="num">${formatPaise(invoice.totals.subtotal_paise)}</td></tr>
          ${invoice.totals.discount_paise > 0 ? `<tr><td>${escapeHtml(t('invoice.discount'))}</td><td class="num">−${formatPaise(invoice.totals.discount_paise)}</td></tr>` : ''}
          <tr class="tax"><td>${escapeHtml(t('invoice.totalTaxable'))}</td><td class="num">${formatPaise(invoice.totals.taxable_paise)}</td></tr>
          ${taxSplit}
          <tr class="grand"><td>${escapeHtml(t('invoice.total'))}</td><td class="num">${formatPaise(invoice.totals.total_paise)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  ${invoice.notes ? `<div class="note">${escapeHtml(t('invoice.notes'))}: ${escapeHtml(invoice.notes)}</div>` : ''}
  ${invoice.is_tax_invoice ? '' : `<div class="note">${escapeHtml(t('invoice.billOfSupplyNote'))}</div>`}

  <div class="foot">
    <div>${escapeHtml(t('invoice.thankYou'))}</div>
    <div>${escapeHtml(t('invoice.computerGenerated'))}</div>
  </div>
</div>
</body>
</html>`;
}
