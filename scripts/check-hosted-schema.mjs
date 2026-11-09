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
 *   that has a REST-visible object. Three migrations have no such object —
 *   `20261002000006` (RLS policies only), `20261013000002` (a publication) and
 *   the three index-only files — and the script says so rather than pretending
 *   to have checked them. The database suite is the proof for those.
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
  { file: '20261021000003_product_guard.sql', probe: ['POST', '/rest/v1/rpc/update_product_from_shop', {}] },
  { file: '20261021000004_pack_sizes.sql', probe: ['GET', '/rest/v1/products?select=sold_by&limit=1'] },
  { file: '20261021000005_create_product.sql', probe: ['POST', '/rest/v1/rpc/create_product_from_shop', {}] },
  { file: '20261021000006_my_name.sql', probe: ['POST', '/rest/v1/rpc/set_my_name', { p_full_name: 'probe' }] },
  { file: '20261026000001_rider_positions.sql', probe: ['GET', '/rest/v1/rider_positions?select=order_id&limit=1'] },
  { file: '20261106000001_order_feedback.sql', probe: ['GET', '/rest/v1/order_feedback?select=order_id&limit=1'] },
  { file: '20261106000002_refund_due.sql', probe: ['GET', '/rest/v1/orders?select=refund_due_paise&limit=1'] },
  { file: '20261106000003_delivery_otp.sql', probe: ['GET', '/rest/v1/order_delivery_codes?select=order_id&limit=1'] },
  { file: '20261107000001_door_pin.sql', probe: ['GET', '/rest/v1/addresses?select=lat&limit=1'] },
  { file: '20261108000001_shop_feedback.sql', probe: ['POST', '/rest/v1/rpc/shop_feedback_totals', {}] },
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
