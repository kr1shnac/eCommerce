-- =============================================================================
-- 36 · GST billing
--
-- The invoice is the document a customer keeps and an officer can ask for. This
-- suite proves the properties that make it trustworthy:
--
--   1. the tax is EXTRACTED from an inclusive price, and
--      taxable + tax equals exactly what the customer paid — on every line,
--      and in the totals, including when a coupon discount does not divide
--      evenly across the lines;
--   2. the rate and HSN are FROZEN on the line at the moment of sale, so a
--      later shelf edit cannot rewrite an issued invoice;
--   3. an unregistered shop issues a bill of supply (no CGST/SGST printed),
--      never a tax invoice with no GSTIN;
--   4. an intra-state delivery splits into CGST + SGST that add up to the tax;
--      an inter-state one uses IGST;
--   5. the invoice number is a financial-year serial, not a random string;
--   6. only the order's owner or staff may read it — everybody else is told
--      "not found", not "forbidden", so an order id cannot be probed.
-- =============================================================================

select test_result.begin_suite('36 GST billing');

reset role;

-- -----------------------------------------------------------------------------
-- Fixture: a registered shop, and two products at different rates.
-- The GSTIN is a TEST value that matches the format check; it is not a real
-- registration and is put back to NULL at the end of this file.
-- -----------------------------------------------------------------------------

update public.stores
   set gstin = '29ABCDE1234F1Z5',
       state_code = '29',
       state_name = 'Karnataka',
       address_line = 'Main Road, near Bus Stand',
       city = 'Kunigal'
 where id = '00000000-0000-4000-8000-000000000001';

update public.products set stock_qty = 40, is_active = true, price_paise = 1800, gst_rate_bp = 0, hsn_code = '0702'
  where id = '20000000-0000-4000-8000-000000000001';   -- Tomato, 0%
update public.products set stock_qty = 60, is_active = true, price_paise = 2600, gst_rate_bp = 500, hsn_code = '0703'
  where id = '20000000-0000-4000-8000-000000000002';   -- Onion, 5%

-- Asha's home is intra-state (Karnataka), the normal case.
update public.addresses
   set state = 'Karnataka'
 where id = '50000000-0000-4000-8000-000000000001';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- =============================================================================
-- 1. The arithmetic, on a real order.
--
-- 2 x Tomato 1800 = 3600 @ 0%   -> taxable 3600, tax    0
-- 3 x Onion  2600 = 7800 @ 5%   -> taxable 7429, tax  371   (round 7428.57)
-- delivery        1500 @ 18%    -> taxable 1271, tax  229   (round 1271.19)
--                                  ------------------------------
--                       taxable 12300, tax 600, total 12900
-- =============================================================================

do $$
declare
  v_placed jsonb;
  v_inv    jsonb;
  v_lines  jsonb;
  v_tomato jsonb;
  v_onion  jsonb;
begin
  v_placed := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":3}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'gst-invoice-key-0001'
  );

  perform test_result.ok('an order is placed', v_placed ->> 'ok' = 'true', v_placed::text);

  v_inv := public.order_invoice((v_placed ->> 'order_id')::uuid);
  v_lines := v_inv -> 'lines';

  -- Selected by rate, not by array position: the document's order is
  -- alphabetical by name, and a test that depends on position would break the
  -- day a product is renamed.
  select l into v_tomato from jsonb_array_elements(v_lines) l
   where (l ->> 'gst_rate_bp')::integer = 0;
  select l into v_onion from jsonb_array_elements(v_lines) l
   where (l ->> 'gst_rate_bp')::integer = 500;

  perform test_result.ok('the invoice is returned', v_inv ->> 'ok' = 'true', v_inv::text);
  perform test_result.eq('it is a TAX invoice when the shop has a GSTIN',
    v_inv ->> 'is_tax_invoice', 'true');
  perform test_result.eq('the seller GSTIN is printed',
    v_inv #>> '{seller,gstin}', '29ABCDE1234F1Z5');
  perform test_result.eq('the buyer is the order''s address',
    v_inv #>> '{buyer,full_name}', 'Asha');

  perform test_result.eq('0% tomato line: taxable is the line total',
    (v_tomato ->> 'taxable_paise')::bigint, 3600);
  perform test_result.eq('0% tomato line: no tax',
    (v_tomato ->> 'tax_paise')::bigint, 0);
  perform test_result.eq('the frozen HSN rides on the line',
    v_tomato ->> 'hsn_code', '0702');

  perform test_result.eq('5% onion line: taxable is extracted, not added',
    (v_onion ->> 'taxable_paise')::bigint, 7429);
  perform test_result.eq('5% onion line: tax is the remainder',
    (v_onion ->> 'tax_paise')::bigint, 371);
  perform test_result.eq('5% onion line: rate is frozen at 500 bp',
    (v_onion ->> 'gst_rate_bp')::bigint, 500);

  perform test_result.eq('delivery is taxed at 18%: taxable',
    (v_inv #>> '{delivery,taxable_paise}')::bigint, 1271);
  perform test_result.eq('delivery is taxed at 18%: tax',
    (v_inv #>> '{delivery,tax_paise}')::bigint, 229);

  perform test_result.eq('total taxable',
    (v_inv #>> '{totals,taxable_paise}')::bigint, 12300);
  perform test_result.eq('total tax',
    (v_inv #>> '{totals,tax_paise}')::bigint, 600);
  perform test_result.eq('CGST is half',
    (v_inv #>> '{totals,cgst_paise}')::bigint, 300);
  perform test_result.eq('SGST is the other half',
    (v_inv #>> '{totals,sgst_paise}')::bigint, 300);
  perform test_result.eq('no IGST inside the state',
    (v_inv #>> '{totals,igst_paise}')::bigint, 0);

  perform test_result.eq('taxable + tax is EXACTLY what was paid',
    (v_inv #>> '{totals,taxable_paise}')::bigint
      + (v_inv #>> '{totals,tax_paise}')::bigint,
    (v_inv #>> '{totals,total_paise}')::bigint);

  perform test_result.ok('the invoice number is a financial-year serial',
    (v_inv ->> 'invoice_number') ~ '^INV/[0-9]{4}-[0-9]{2}/[0-9]{6}$',
    v_inv ->> 'invoice_number');

  -- Session scope (`false`), not transaction scope: this file runs as a series
  -- of autocommitted statements, so a local setting would vanish here.
  perform set_config('kunigal.test_order_id', v_placed ->> 'order_id', false);
end;
$$;

reset role;
update public.products set gst_rate_bp = 1800 where id = '20000000-0000-4000-8000-000000000002';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a later rate change does not rewrite the issued line',
  (select (l ->> 'gst_rate_bp')::bigint
     from jsonb_array_elements(
       public.order_invoice(current_setting('kunigal.test_order_id')::uuid) -> 'lines'
     ) l
    where (l ->> 'gst_rate_bp')::integer = 500),
  500
);

-- =============================================================================
-- 2. A coupon discount that does not divide evenly.
--
-- The allocation gives the rounding remainder to the last line, so the sum of
-- the line discounts is EXACTLY the order discount. That is the property that
-- keeps taxable + tax = total.
-- =============================================================================

do $$
declare
  v_placed jsonb;
begin
  v_placed := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":3},
      {"product_id":"20000000-0000-4000-8000-000000000002","quantity":2}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'gst-discount-key-0001'
  );

  perform test_result.ok('a second order is placed', v_placed ->> 'ok' = 'true', v_placed::text);
  perform set_config('kunigal.test_discount_order', v_placed ->> 'order_id', false);
end;
$$;

-- An odd discount, set by the shop, because a coupon that happens to divide
-- evenly would not prove the remainder rule. The guard reads the JWT role, not
-- the SQL role, so this must be done AS THE OWNER even while running as the
-- table owner.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');
reset role;
update public.orders
   set discount_paise = 333,
       total_paise = subtotal_paise + delivery_fee_paise - 333
 where id = current_setting('kunigal.test_discount_order')::uuid;

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_inv   jsonb;
  v_lines jsonb;
  v_disc  bigint;
  v_net   bigint;
begin
  v_inv := public.order_invoice(current_setting('kunigal.test_discount_order')::uuid);
  v_lines := v_inv -> 'lines';

  select coalesce(sum((l ->> 'discount_paise')::bigint), 0) into v_disc
    from jsonb_array_elements(v_lines) l;
  select coalesce(sum((l ->> 'net_paise')::bigint), 0) into v_net
    from jsonb_array_elements(v_lines) l;

  perform test_result.eq('the line discounts add up to the order discount', v_disc, 333);
  perform test_result.eq('the line nets add up to subtotal - discount', v_net, 10600 - 333);
  perform test_result.eq('and taxable + tax is still the grand total',
    (v_inv #>> '{totals,taxable_paise}')::bigint
      + (v_inv #>> '{totals,tax_paise}')::bigint,
    (v_inv #>> '{totals,total_paise}')::bigint);
end;
$$;

-- =============================================================================
-- 3. An unregistered shop issues a bill of supply, not a false tax invoice.
-- =============================================================================

reset role;
update public.stores set gstin = null where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'no GSTIN means not a tax invoice',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) ->> 'is_tax_invoice'),
  'false'
);
select test_result.eq(
  'and no CGST is printed',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) #>> '{totals,cgst_paise}')::bigint,
  0
);
select test_result.eq(
  'the grand total is unchanged — the price was always inclusive',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) #>> '{totals,total_paise}')::bigint,
  12900
);

reset role;
update public.stores set gstin = '29ABCDE1234F1Z5' where id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- =============================================================================
-- 4. Inter-state supply uses IGST.
-- =============================================================================

reset role;
update public.addresses
   set state = 'Maharashtra'
 where id = '50000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_placed jsonb;
  v_inv    jsonb;
begin
  v_placed := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'gst-interstate-key-01'
  );

  perform test_result.ok('an inter-state order is placed', v_placed ->> 'ok' = 'true', v_placed::text);

  v_inv := public.order_invoice((v_placed ->> 'order_id')::uuid);

  perform test_result.eq('the supply is marked inter-state', v_inv ->> 'is_intra_state', 'false');
  perform test_result.eq('IGST carries the whole tax',
    (v_inv #>> '{totals,igst_paise}')::bigint,
    (v_inv #>> '{totals,tax_paise}')::bigint);
  perform test_result.eq('CGST is zero', (v_inv #>> '{totals,cgst_paise}')::bigint, 0);
  perform test_result.eq('SGST is zero', (v_inv #>> '{totals,sgst_paise}')::bigint, 0);
end;
$$;

reset role;
update public.addresses set state = 'Karnataka' where id = '50000000-0000-4000-8000-000000000001';

-- =============================================================================
-- 5. Who may read the invoice.
-- =============================================================================

set role authenticated;
select test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi

select test_result.eq(
  'another customer is told "not found", not shown the invoice',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) ->> 'error'),
  'not_found'
);

select test_result.sign_out();
select test_result.eq(
  'a signed-out visitor is refused',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) ->> 'error'),
  'not_logged_in'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- the owner
select test_result.ok(
  'the shop can read any order''s invoice',
  (public.order_invoice(current_setting('kunigal.test_order_id')::uuid) ->> 'ok') = 'true'
);

-- =============================================================================
-- 6. The write path for a rate.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha
select test_result.refused(
  'a customer cannot set a product''s GST rate',
  $$select public.set_product_gst('20000000-0000-4000-8000-000000000001', 500)$$,
  '42501'
);

select test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi
select test_result.refused(
  'nor can another customer',
  $$select public.set_product_gst('20000000-0000-4000-8000-000000000001', 500)$$,
  '42501'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.refused(
  'the shop cannot invent a 7% rate',
  $$select public.set_product_gst('20000000-0000-4000-8000-000000000001', 700)$$,
  '22023'
);
select test_result.refused(
  'the shop cannot send a malformed HSN',
  $$select public.set_product_gst('20000000-0000-4000-8000-000000000001', 500, 'ABC')$$,
  '22023'
);

select test_result.eq(
  'the shop sets a valid rate and HSN, and gets the stored row back',
  (select gst_rate_bp::text || '/' || hsn_code
     from public.set_product_gst('20000000-0000-4000-8000-000000000001', 500, '07020000')),
  '500/07020000'
);

-- =============================================================================
-- 7. The financial-year label, at the boundaries that matter.
-- =============================================================================

select test_result.eq('31 March is the old year',
  public.financial_year_label('2027-03-31 23:30:00+05:30'::timestamptz), '2026-27');
select test_result.eq('1 April is the new year',
  public.financial_year_label('2027-04-01 00:30:00+05:30'::timestamptz), '2027-28');
select test_result.eq('today is 2026-27',
  public.financial_year_label('2026-11-12 12:00:00+05:30'::timestamptz), '2026-27');

-- =============================================================================
-- Put the fixture back.
-- =============================================================================

reset role;
update public.stores set gstin = null where id = '00000000-0000-4000-8000-000000000001';
update public.products set gst_rate_bp = 0, hsn_code = null
  where id in ('20000000-0000-4000-8000-000000000001',
               '20000000-0000-4000-8000-000000000002');
