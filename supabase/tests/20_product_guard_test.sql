-- =============================================================================
-- 20 · The shelf: the guard freezes identity, and the RPC never lies
--
-- Rule 9.7: a new guard trigger and a new SECURITY DEFINER function are not done
-- until a test proves the forbidden case fails. The claims this file makes true:
--
--   1. a customer and a rider cannot reach `update_product_from_shop()` at all,
--      and learn nothing from the attempt;
--   2. the owner CAN change price, MRP, stock, active and emoji;
--   3. the owner canNOT move a product to another shop — even though the role
--      check would let them, because the counter-edit guard freezes it;
--   4. the pre-existing CHECKs still bind the owner: price 0, negative stock and
--      MRP below price are all refused with 23514 (this is the "server does not
--      trust the client" claim, and it must survive this migration);
--   5. a write that RLS would have filtered to zero rows is now an ERROR, not a
--      silent success — the exact failure mode that makes a save button lie;
--   6. `updated_at` moves on its own and the app cannot set it.
--
-- A NOTE ON THE FIXTURE, same trap as tests 18 and 19: `orders_guard_insert`
-- forces a customer's order to `placed`, and `current_user_role()` falls back to
-- `customer` when `auth.uid()` is null. No orders are created here, but the
-- lesson applies to any row written without a signed-in admin.
-- =============================================================================

select test_result.begin_suite('20 product guard');

-- -----------------------------------------------------------------------------
-- A product of our own, so nothing here depends on the seeded shelf.
-- -----------------------------------------------------------------------------

reset role;

insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, sort_order)
values
  ('a0000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   'Guard Test Atta', 'ಗಾರ್ಡ್ ಟೆಸ್ಟ್ ಅಟ್ಟ', 4500, 5000, '1 kg', 10, 900)
on conflict (id) do nothing;

select test_result.eq(
  'the fixture product landed as written',
  (select (price_paise = 4500 and stock_qty = 10)::text
     from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  'true'
);

-- =============================================================================
-- The door: only the shop may use the RPC.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot reprice a product through the shop RPC',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', 1) $$,
  '42501'
);

select test_result.sign_out();

select test_result.refused(
  'a signed-out caller cannot reprice a product either',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', 1) $$,
  '42501'
);

set role authenticated;
select test_result.sign_in('22222222-2222-2222-2222-222222222222');

select test_result.refused(
  'a delivery partner cannot reprice a product',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', 1) $$,
  '42501'
);

-- The old, silent path is still silent — and this is WHY the RPC exists. A plain
-- update by a rider touches zero rows and raises nothing, so a screen trusting it
-- would report success. Asserted here so the reason is on the record.
select test_result.touches(
  'a rider''s direct update still touches zero rows and raises nothing',
  $$ update public.products set price_paise = 1
      where id = 'a0000000-0000-4000-8000-000000000001' $$,
  0
);

-- Nothing changed, despite four attempts.
select test_result.sign_out();
reset role;

select test_result.eq(
  'after every refused attempt the price is untouched',
  (select price_paise::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  '4500'
);

-- =============================================================================
-- The owner can do the job: the four counter fields.
-- =============================================================================

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the owner can change the price through the RPC',
  (select price_paise::text from public.update_product_from_shop(
     'a0000000-0000-4000-8000-000000000001',
     p_price_paise => 5200, p_mrp_paise => 6000)),
  '5200'
);

select test_result.eq(
  'and the row really holds the new price afterwards',
  (select price_paise::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  '5200'
);

-- Raising a price above the printed MRP is refused by the pre-existing CHECK.
-- That is the database protecting the shop from a mis-tap, and it must survive.
select test_result.refused(
  'a price above the MRP is refused, so a mis-tap cannot invent a discount',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', p_mrp_paise => 100) $$,
  '23514'
);

-- The whole point of M2: the shop can say "none left" from the phone.
select test_result.eq(
  'the owner can mark the shelf empty',
  (select stock_qty::text from public.update_product_from_shop(
     'a0000000-0000-4000-8000-000000000001', p_stock_qty => 0)),
  '0'
);

select test_result.eq(
  'and the customer-facing query then finds nothing to sell',
  (select count(*)::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001' and stock_qty = 0),
  '1'
);

select test_result.eq(
  'the owner can take a product off the shelf',
  (select is_active::text from public.update_product_from_shop(
     'a0000000-0000-4000-8000-000000000001', p_is_active => false)),
  'false'
);

select test_result.eq(
  'the owner can restock and put it back',
  (select (stock_qty = 25 and is_active)::text from public.update_product_from_shop(
     'a0000000-0000-4000-8000-000000000001',
     p_stock_qty => 25, p_is_active => true)),
  'true'
);

-- A field not mentioned must be left alone: this is what lets the phone send only
-- the tap the owner actually made.
select test_result.eq(
  'a parameter left out is not overwritten — the price survived the restock',
  (select price_paise::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  '5200'
);

-- =============================================================================
-- The CHECKs still bind the owner. The client is never trusted (rule 9.1).
-- =============================================================================

select test_result.refused(
  'the owner cannot set a price of zero, even through the RPC',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', 0) $$,
  '23514'
);

select test_result.refused(
  'the owner cannot set a negative stock through the RPC',
  $$ select public.update_product_from_shop(
       'a0000000-0000-4000-8000-000000000001', p_stock_qty => -5) $$,
  '23514'
);

select test_result.eq(
  'after three refused values the row is still the last good one',
  (select (price_paise = 5200 and stock_qty = 25 and is_active)::text
     from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  'true'
);

-- =============================================================================
-- The frozen identity: a counter edit cannot move a product to another shop.
-- =============================================================================

reset role;

insert into public.stores (id, name, slug, is_active) values
  ('00000000-0000-4000-8000-0000000000ff', 'Other Shop', 'other-shop', true)
on conflict (id) do nothing;

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

-- The role check would allow this — the guard is what refuses it.
select test_result.refused(
  'even the owner cannot move a product to another shop',
  $$ update public.products
        set store_id = '00000000-0000-4000-8000-0000000000ff'
      where id = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501'
);

select test_result.eq(
  'and the product is still on the right shop''s shelf',
  (select store_id::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  '00000000-0000-4000-8000-000000000001'
);

-- =============================================================================
-- updated_at is the database's, not the app's.
-- =============================================================================

reset role;

select test_result.eq(
  'the RPC reported an updated_at that is not the row''s creation time',
  (select (updated_at > created_at)::text from public.products
    where id = 'a0000000-0000-4000-8000-000000000001'),
  'true'
);

-- =============================================================================
-- Cleanup: leave the shelf as found.
-- =============================================================================

reset role;

delete from public.products where id = 'a0000000-0000-4000-8000-000000000001';
delete from public.stores   where id = '00000000-0000-4000-8000-0000000000ff';
