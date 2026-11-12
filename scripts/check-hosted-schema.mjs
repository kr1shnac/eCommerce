#!/usr/bin/env node
/**
 * check-hosted-schema.mjs — does the HOSTED Supabase project have the migrations?
 *
 * Run:  npm run check:hosted
 *
 * WHY THIS EXISTS
 *
 * `npm run test:db` proves every migration applies cleanly to a *throwaway*
 * PostgreSQL. It says nothing about the project the app actually talks to, and
 * on 2026-11-08 those had drifted apart badly: the hosted project was missing
 * fourteen migrations, so the app quietly fell back to placeholders there
 * ("your rider", a ₹0.00 refund) and nothing anywhere complained. The next
 * session then had to re-derive the whole probe by hand, and `AGENTS.md` /
 * `HANDOFF.md` had the boundary wrong by fourteen files.
 *
 * This script is that probe, made repeatable, with one marker per migration so
 * the answer is "which migrations are missing", not just "something is".
 *
 * WHAT IT PROVES
 *
 *   A marker object exists on the hosted project (or not), for each migration
 *   that has a REST-visible object. Some files have no such object — RLS
 *   policies only, a publication, indexes/constraints only, or a function body
 *   that was replaced without changing its shape — and the script says so
 *   rather than pretending to have checked them. The database suite is the
 *   proof for those.
 *
 * WHAT IT DOES NOT PROVE
 *
 *   That the *bodies* are right (policies, triggers, function logic) — only
 *   that the object is there. And it cannot see through RLS: a marker present
 *   means the schema has it, not that the app can read it.
 *
 * WHY IT IS NOT IN THE LINT CHAIN
 *
 *   It needs the network and `apps/mobile/.env`, which is deliberately not in
 *   Git and not on CI. Run it before a live test and after every `db push`.
 *
 * Secrets: this reads only the publishable key, prints none of it, and never
 * writes the `.env` anywhere. Exit code 1 = at least one migration is missing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ *
 * One marker per migration, in filename order. Any REST-visible object
 * works; a *column* probe is the cheapest reliable "did this migration
 * run", because PostgREST answers 42703 for a missing column whether or
 * not the caller may read the table.
 * ------------------------------------------------------------------ */
const MARKERS = [
  { file: '20261002000001_foundation.sql', probe: ['GET', '/rest/v1/stores?select=id&limit=1'] },
  { file: '20261002000002_profiles.sql', probe: ['GET', '/rest/v1/profiles?select=id&limit=1'] },
  { file: '20261002000003_catalog.sql', probe: ['GET', '/rest/v1/categories?select=id&limit=1'] },
  { file: '20261002000004_addresses.sql', probe: ['GET', '/rest/v1/addresses?select=landmark&limit=1'] },
  { file: '20261002000005_orders.sql', probe: ['GET', '/rest/v1/orders?select=status&limit=1'] },
  { file: '20261002000006_row_level_security.sql', probe: null },
  { file: '20261002000007_grants_and_indexes.sql', probe: null },
  { file: '20261002000008_place_order.sql', probe: ['POST', '/rest/v1/rpc/cancel_order', { p_order_id: '00000000-0000-0000-0000-000000000000' }] },
  { file: '20261002000009_line_item_price_guard.sql', probe: ['GET', '/rest/v1/order_items?select=quantity&limit=1'] },
  { file: '20261003000001_images_and_history.sql', probe: ['GET', '/rest/v1/products?select=image_url&limit=1'] },
  { file: '20261003000002_db_constraints.sql', probe: ['GET', '/rest/v1/store_settings?select=low_stock_threshold&limit=1'] },
  { file: '20261013000001_rider_assignment.sql', probe: ['GET', '/rest/v1/orders?select=assigned_to&limit=1'] },
  { file: '20261013000002_realtime_orders.sql', probe: null },
  { file: '20261014000001_product_emoji.sql', probe: ['GET', '/rest/v1/products?select=emoji&limit=1'] },
  { file: '20261014000002_favourites.sql', probe: ['GET', '/rest/v1/favourites?select=product_id&limit=1'] },
  { file: '20261014000003_address_one_default.sql', probe: ['POST', '/rest/v1/rpc/set_default_address', { p_address_id: '00000000-0000-0000-0000-000000000000' }] },
  { file: '20261014000004_coupons.sql', probe: ['GET', '/rest/v1/coupons?select=code&limit=1'] },
  { file: '20261020000001_account_deletion.sql', probe: ['POST', '/rest/v1/rpc/delete_my_account', {}] },
  { file: '20261020000002_shop_identity.sql', probe: ['GET', '/rest/v1/stores?select=fssai_number&limit=1'] },
  { file: '20261021000001_order_tracker.sql', probe: ['GET', '/rest/v1/orders?select=failure_reason&limit=1'] },
  { file: '20261021000002_shop_totals.sql', probe: ['POST', '/rest/v1/rpc/shop_day_totals', {}] },
  { file: '20261021000003_product_guard.sql', probe: ['POST', '/rest/v1/rpc/update_product_from_shop', { p_product_id: '00000000-0000-0000-0000-000000000000' }] },
  { file: '20261021000004_pack_sizes.sql', probe: ['GET', '/rest/v1/products?select=sold_by&limit=1'] },
  { file: '20261021000005_create_product.sql', probe: ['POST', '/rest/v1/rpc/create_product_from_shop', { p_name_en: 'probe', p_name_kn: 'ಪರೀಕ್ಷೆ', p_price_paise: 1, p_category_id: '00000000-0000-0000-0000-000000000000' }] },
  { file: '20261021000006_my_name.sql', probe: ['POST', '/rest/v1/rpc/set_my_name', { p_full_name: 'probe' }] },
  // Split out of 20261021000001 on 2026-11-09: a new enum value cannot be USED
  // in the transaction that added it. Two CHECK constraints and one partial
  // index, so there is nothing REST-visible to probe. Proof is test 18.
  { file: '20261021000007_order_tracker_rules.sql', probe: null },
  { file: '20261026000001_rider_positions.sql', probe: ['GET', '/rest/v1/rider_positions?select=order_id&limit=1'] },
  { file: '20261106000001_order_feedback.sql', probe: ['GET', '/rest/v1/order_feedback?select=order_id&limit=1'] },
  { file: '20261106000002_refund_due.sql', probe: ['GET', '/rest/v1/orders?select=refund_due_paise&limit=1'] },
  { file: '20261106000003_delivery_otp.sql', probe: ['GET', '/rest/v1/order_delivery_codes?select=order_id&limit=1'] },
  { file: '20261107000001_door_pin.sql', probe: ['GET', '/rest/v1/addresses?select=lat&limit=1'] },
  { file: '20261108000001_shop_feedback.sql', probe: ['POST', '/rest/v1/rpc/shop_feedback_totals', {}] },
  // Replaces two existing functions and changes no shape, so there is no object
  // a REST probe can see. Its proof is `npm run test:db` (test 30).
  { file: '20261109000001_rider_erasure.sql', probe: null },
  // An anon caller is refused (42501), which still proves the function exists;
  // it cannot close the shop because the publishable key has no admin user.
  { file: '20261109000002_set_shop_open.sql', probe: ['POST', '/rest/v1/rpc/set_shop_open', { p_is_open: false }] },
  // The two money actions. An anon caller is refused, and a zero id would be
  // P0002 if it were allowed — either answer proves the function is deployed.
  { file: '20261109000003_money_desk.sql', probe: ['POST', '/rest/v1/rpc/mark_cod_collected', { p_order_id: '00000000-0000-0000-0000-000000000000' }] },
  // Per-customer coupon limit. A column on coupons + validate_coupon/place_order
  // both check it. An anon caller is refused (42501), proving the functions exist.
  { file: '20261109000004_coupon_per_customer.sql', probe: ['POST', '/rest/v1/rpc/validate_coupon', { p_store_id: '00000000-0000-4000-8000-000000000001', p_code: 'PROBE', p_subtotal_paise: 10000 }] },
  // The shop's two status actions on somebody else's order. An anon caller is
  // refused with 42501, and an unknown order would be P0002 if it were allowed —
  // either answer proves the function is deployed.
  { file: '20261109000005_admin_order_actions.sql', probe: ['POST', '/rest/v1/rpc/admin_force_complete', { p_order_id: '00000000-0000-0000-0000-000000000000' }] },
  // The offers rail's own scope. `active_offers()` is granted to anon and the
  // zero store has no offers, so a 200 with `[]` proves the new signature.
  { file: '20261109000006_offers_scope.sql', probe: ['POST', '/rest/v1/rpc/active_offers', { p_store_id: '00000000-0000-0000-0000-000000000000' }] },

  // ── 2026-11-12: GST billing, payments, radius, express ──────────────────────
  // A column on a publicly readable table: the GST rate the invoice extracts.
  { file: '20261112000001_gst_billing.sql', probe: ['GET', '/rest/v1/products?select=gst_rate_bp,hsn_code&limit=1'] },
  // An enum value, which no column probe can show. `place_order()` takes the
  // method as a `payment_method` argument, so PostgREST parses 'upi' against the
  // enum before the function runs: if the value were absent this would be
  // 22P02 "invalid input value for enum", not the 401/403 an anon caller gets.
  { file: '20261112000002_payment_methods.sql', probe: ['POST', '/rest/v1/rpc/place_order', { p_items: [], p_store_id: '00000000-0000-0000-0000-000000000000', p_address_id: '00000000-0000-0000-0000-000000000000', p_idempotency_key: 'hosted-probe-0000', p_note: null, p_coupon_code: null, p_payment_method: 'upi', p_express: false }] },
  // The switch that must stay false until the shop can settle online money.
  { file: '20261112000003_payment_settlement.sql', probe: ['GET', '/rest/v1/store_settings?select=online_payments_enabled&limit=1'] },
  // The shop's own pin, which every distance is measured from.
  { file: '20261112000004_delivery_radius.sql', probe: ['GET', '/rest/v1/stores?select=lat,lng&limit=1'] },
  // The 8-argument signature. Sending all eight names fails with PGRST202
  // ("Could not find the function") if only the old 6-argument one is deployed,
  // which is exactly the drift this line exists to catch.
  { file: '20261112000005_place_order_billing.sql', probe: ['POST', '/rest/v1/rpc/place_order', { p_items: [], p_store_id: '00000000-0000-0000-0000-000000000000', p_address_id: '00000000-0000-0000-0000-000000000000', p_idempotency_key: 'hosted-probe-0000', p_note: null, p_coupon_code: null, p_payment_method: 'cod', p_express: false }] },
  // The gateway's own order id on the order row. A customer's call is refused
  // (42501) once they are signed in, but the COLUMN is what proves the
  // migration landed; the guard and the state rules are test 39's job.
  { file: '20261112000006_razorpay.sql', probe: ['GET', '/rest/v1/orders?select=payment_provider_order_id&limit=1'] },
  // `refund_due_paise` is generated, so it is selectable but never writable —
  // the probe cannot show the expression. Its rule (not-cash, not merely
  // `online`) is proved locally by test 39 §10.
  { file: '20261112000007_refund_due_methods.sql', probe: ['GET', '/rest/v1/orders?select=refund_due_paise&limit=1'] },
  // The per-order rider directory. The view answers an anon call with 401/403
  // because its grant is `authenticated` only — which is exactly what proves
  // both halves: the object is in the schema cache (an absent view would be
  // PGRST205) and the grant has not been widened (test 40's job locally).
  { file: '20261112000008_rider_directory_scoped.sql', probe: ['GET', '/rest/v1/rider_directory?select=id&limit=1'] },
];

/** The three answers a probe can honestly give. */
const PRESENT = 'PRESENT';
const MISSING = 'MISSING';
const UNPROVEN = 'no REST-visible object';

function readEnv() {
  const path = join(root, 'apps', 'mobile', '.env');
  if (!existsSync(path)) {
    console.error(`check:hosted — no ${path}. This needs the same .env the app uses,`);
    console.error('which is deliberately not in Git. Copy it from the old laptop first.');
    process.exit(2);
  }
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.+)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return vars;
}

/**
 * MISSING means "the schema cache has no such object": PGRST202 for an RPC,
 * PGRST205 for a table/view, 42703 for a column. Anything else — 200, 401
 * (the object exists but wants a real user, as `set_default_address` does),
 * 403, a constraint violation — means PRESENT.
 */
async function probe(url, key, [method, path, body]) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const init = { method, headers, signal: AbortSignal.timeout(20000) };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url + path, init);
  const text = await res.text();
  let message = '';
  try {
    const json = JSON.parse(text);
    message = json.message || json.error?.message || json.details || '';
  } catch {
    message = text;
  }
  if (/PGRST202|PGRST205|42703|Could not find the|does not exist|schema cache/.test(message)) {
    return { verdict: MISSING, detail: message.split('\n')[0].slice(0, 72) };
  }
  if (res.status === 200 || res.status === 204 || res.status === 401 || res.status === 403) {
    return { verdict: PRESENT, detail: '' };
  }
  return { verdict: PRESENT, detail: `HTTP ${res.status} ${message.slice(0, 60)}` };
}

async function main() {
  const env = readEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('check:hosted — apps/mobile/.env has no EXPO_PUBLIC_SUPABASE_URL / publishable key.');
    process.exit(2);
  }

  console.log('Hosted Supabase schema vs the migrations in this repo');
  console.log(`  project: ${url}`);
  console.log(`  local migrations: ${MARKERS.length}\n`);

  const missing = [];
  const unproven = [];
  const applied = [];

  for (const marker of MARKERS) {
    const file = marker.file;
    if (!marker.probe) {
      unproven.push(file);
      console.log(`  ${UNPROVEN.padEnd(24)} ${file}`);
      continue;
    }
    let result;
    try {
      result = await probe(url, key, marker.probe);
    } catch (error) {
      console.log(`  ${'UNREACHABLE'.padEnd(24)} ${file} — ${error.message}`);
      console.error('\ncheck:hosted — could not reach the project. Nothing was proven.');
      process.exit(2);
    }
    if (result.verdict === MISSING) {
      missing.push(file);
      console.log(`  ${'MISSING'.padEnd(24)} ${file} — ${result.detail}`);
    } else {
      applied.push(file);
      console.log(`  ${'PRESENT'.padEnd(24)} ${file}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  }

  console.log('');
  console.log(`  applied (proved):  ${applied.length}`);
  console.log(`  missing:           ${missing.length}`);
  console.log(`  unproven here:     ${unproven.length} (RLS/publication/index-only — proved by npm run test:db)`);

  if (missing.length > 0) {
    console.log('\nApply these, in filename order, then re-run this check:');
    for (const file of missing) console.log(`  supabase/migrations/${file}`);
    console.log('\nRESULT: the hosted project is behind this repo.');
    process.exit(1);
  }
  console.log('\nRESULT: the hosted project carries every migration with a REST-visible object.');
}

main().catch((error) => {
  console.error('check:hosted failed:', error.message);
  process.exit(2);
});
