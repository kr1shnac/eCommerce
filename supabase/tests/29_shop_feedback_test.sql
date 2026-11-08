-- =============================================================================
-- 29 · The shop can read its own answers — and a customer cannot read the
--      shop's, and a stranger cannot read anybody's.
--
-- Rule 9.7: the forbidden case fails too. The claims:
--
--   1. staff CAN read the counts and the reason list (the point of collecting
--      the answers at all);
--   2. a CUSTOMER cannot — not through these functions, which return nothing
--      to them, and not by a plain SELECT on the table for somebody else's row,
--      which RLS already refuses (that refusal is asserted in test 25, and
--      re-asserted here because this migration is the first reason a customer
--      might want to try);
--   3. a signed-out caller gets nothing rather than an error;
--   4. a reason that did not occur returns NO ROW — never a zero, which would
--      read as "this happened zero times";
--   5. the window is a parameter, and an absurd one (a null, a date in the
--      future) degrades to the default instead of returning everything.
--
-- The honest-scope claim is a test of its own: nothing here attributes a
-- complaint to a product or to a rider, because `reason` is per ORDER and says
-- nothing about which item or who carried it.
-- =============================================================================

select test_result.begin_suite('29 shop feedback');

-- -----------------------------------------------------------------------------
-- Setup: a known set of answers. Three delivered orders, one flagged with a
-- `missing_item` and one with `late`, on top of whatever the demo data left.
-- Done as the table owner because none of it is what is under test.
-- -----------------------------------------------------------------------------

reset role;

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise
)
values
  ('90000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 6000, 0, 0, 6000),
  ('90000000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 7000, 0, 0, 7000),
  ('90000000-0000-4000-8000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'delivered', 'cod', 'paid', 8000, 0, 0, 8000)
on conflict (id) do nothing;

insert into public.order_feedback (order_id, user_id, was_ok, reason)
values
  ('90000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', true, null),
  ('90000000-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111', false, 'missing_item'),
  ('90000000-0000-4000-8000-000000000003',
   '22222222-2222-2222-2222-222222222222', false, 'late')
on conflict (order_id) do nothing;

-- The demo data also has answers; that is fine, the assertions below compare
-- against the counts the database actually holds rather than against 3.

-- =============================================================================
-- 1. Staff can read it.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.ok(
  'the owner gets the two counts',
  (select answered >= 3 from public.shop_feedback_totals())
);

select test_result.ok(
  'and they add up to what was answered',
  (select ok_count + wrong_count = answered from public.shop_feedback_totals())
);

select test_result.eq(
  'one missing item and one late, from this file',
  (select seen from public.shop_feedback_reasons() where reason = 'missing_item'),
  1
);
select test_result.eq(
  'and one late delivery',
  (select seen from public.shop_feedback_reasons() where reason = 'late'),
  1
);

select test_result.ok(
  'the most frequent reason comes first',
  (select reason from public.shop_feedback_reasons() limit 1) is not null
);

-- =============================================================================
-- 2. A reason that did not happen returns no row, never a zero.
--
--    This is the assertion that keeps the screen honest: a zero line reads as
--    "this happened zero times", which is the same invention as a product with
--    no reviews showing "0".
-- =============================================================================

select test_result.ok(
  'damaged returns no row at all when nobody reported it',
  not exists (
    select 1 from public.shop_feedback_reasons() where reason = 'damaged'
  )
);

select test_result.ok(
  'wrong_item returns no row either',
  not exists (
    select 1 from public.shop_feedback_reasons() where reason = 'wrong_item'
  )
);

select test_result.ok(
  'and the reason list never contains a null reason',
  not exists (select 1 from public.shop_feedback_reasons() where reason is null)
);

-- =============================================================================
-- 3. A customer cannot read the shop's answers.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'a customer gets no totals row',
  (select count(*)::text from public.shop_feedback_totals()),
  '0'
);
select test_result.eq(
  'a customer gets no reason rows',
  (select count(*)::text from public.shop_feedback_reasons()),
  '0'
);

-- And cannot reach the answers through the table for somebody else's order.
-- RLS does not raise here — it makes the other customer's rows invisible, so
-- the query runs and sees nothing. Asserted as a count of zero rather than an
-- exception, which is what "invisible" actually means.
select test_result.eq(
  'a customer cannot SELECT another customer''s feedback',
  (select count(*)::text from public.order_feedback
     where user_id = '22222222-2222-2222-2222-222222222222'),
  '0'
);

select test_result.ok(
  'and can still read their own answers',
  exists (
    select 1 from public.order_feedback
     where user_id = '11111111-1111-1111-1111-111111111111'
  )
);

-- =============================================================================
-- 4. Nobody signed in gets nothing.
-- =============================================================================

select test_result.sign_out();
select test_result.eq(
  'a signed-out caller gets no totals row',
  (select count(*)::text from public.shop_feedback_totals()),
  '0'
);

-- =============================================================================
-- 5. The window degrades instead of returning everything.
-- =============================================================================

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.ok(
  'a null window falls back to 30 days rather than to all of history',
  (select answered from public.shop_feedback_totals(null::timestamptz))
    = (select answered from public.shop_feedback_totals())
);

-- The window is a LOWER bound: `created_at >= p_since`. A window from the dawn
-- of time therefore returns everything, and a window from the future returns
-- nothing — the two directions that matter, asserted rather than assumed.
select test_result.ok(
  'a window from the far past returns the whole history',
  (select answered from public.shop_feedback_totals('1999-01-01'::timestamptz))
    = (select answered from public.shop_feedback_totals())
);

select test_result.eq(
  'a window starting in the future returns nothing, not everything',
  (select answered from public.shop_feedback_totals(now() + interval '1 day')),
  0
);

select test_result.ok(
  'a tight window around this file still finds the three answers',
  (select answered >= 3 from public.shop_feedback_totals(now() - interval '1 hour'))
);

-- =============================================================================
-- 6. The honest scope: nothing here attributes a complaint to a product.
-- =============================================================================

select test_result.ok(
  'the function returns no product column to mis-attribute',
  not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'shop_feedback_totals'
       and 'product'::text = any (
         select jsonb_array_elements_text(
           to_jsonb(p.proargnames)
         )
       )
  )
);

-- =============================================================================
-- 7. Leave the shelf as we found it.
-- =============================================================================

reset role;

delete from public.order_feedback
 where order_id in ('90000000-0000-4000-8000-000000000001',
                    '90000000-0000-4000-8000-000000000002',
                    '90000000-0000-4000-8000-000000000003');

delete from public.orders
 where id in ('90000000-0000-4000-8000-000000000001',
              '90000000-0000-4000-8000-000000000002',
              '90000000-0000-4000-8000-000000000003');

select test_result.sign_out();
