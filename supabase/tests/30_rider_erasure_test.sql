-- =============================================================================
-- 30 — A rider carrying a delivery can erase their account, and the shop's
--       books survive it.
--
-- The bug this file exists for (found 2026-11-06, fixed by migration
-- 20261109000001): a rider assigned to an order could not delete their account
-- at all. `delete_my_account()` ends by deleting the `auth.users` row, which
-- cascades to the profile row, which makes `orders.assigned_to`
-- (`on delete set null`) issue its own UPDATE — long after the caller stopped
-- being a rider, so `guard_order_update()` refused it and the whole erasure
-- rolled back.
--
-- The claims this file has to make true:
--
--   1. a LIVE rider still cannot hand an order back by hand — the fix is a door
--      through the erasure, not a hole in the guard (rule 9.7: prove the
--      forbidden case still fails);
--   2. the rider CAN erase their account while carrying a delivery;
--   3. the person goes: profile, auth user and addresses;
--   4. the order they were carrying keeps its CUSTOMER, its money, its status
--      and its order number — an erasure must never rewrite another person's
--      order history — and loses only the assignment, with `assigned_at` too,
--      because a claim time with nobody attached is a lie;
--   5. the rider's OWN order is still anonymised to the tombstone, exactly as
--      test 16 proves for a customer;
--   6. the shop keeps working: another rider can claim the handed-back order
--      straight afterwards.
-- =============================================================================

select test_result.begin_suite('30 rider erasure');

-- -----------------------------------------------------------------------------
-- A rider of our own. Deliberately NOT one of the shared fixtures: this file
-- deletes the account at the end, and a later file (or a re-run) should not
-- find a fixture missing.
-- -----------------------------------------------------------------------------

insert into auth.users (id, phone, raw_user_meta_data) values
  ('66666666-6666-6666-6666-666666666666', '+919800000066',
   '{"full_name":"Leaving Rider"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery'
where id = '66666666-6666-6666-6666-666666666666';

insert into public.addresses
  (id, user_id, label, full_name, phone, line1, city, pincode, is_default)
values
  ('50000000-0000-4000-8000-000000000066',
   '66666666-6666-6666-6666-666666666666',
   'Home', 'Leaving Rider', '+919800000066', '1, Rider Lane', 'Kunigal',
   '572130', true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Two orders. ONE is somebody else's — the delivery this rider is carrying.
-- TWO is the rider's own shopping. Both are inserted as the owner, which
-- `orders_guard_insert` treats as a customer, so both start `placed`
-- (the same lesson test 24 learned the hard way).
--
-- The Kannada name is the seed's own word for tomato, reused rather than
-- invented: this file has no business writing new customer-facing Kannada.
-- -----------------------------------------------------------------------------

insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise,
   unit, stock_qty, sort_order)
values
  ('30000000-0000-4000-8000-000000000030',
   '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   'Erasure Test Tomato', 'ಟೊಮೆಟೊ', 1800, 2400, '500 g', 40, 99)
on conflict (id) do update set stock_qty = excluded.stock_qty;

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise
)
values
  -- Somebody else's shopping, in this rider's hands.
  ('90000000-0000-4000-8000-000000000030',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 5000, 0, 0, 5000),
  -- The rider's own shopping.
  ('90000000-0000-4000-8000-000000000031',
   '66666666-6666-6666-6666-666666666666',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000066',
   '{"line1":"1, Rider Lane","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 7000, 0, 0, 7000)
on conflict (id) do nothing;

-- The claim, as the owner's own account: an admin action by definition.
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.orders
set assigned_to = '66666666-6666-6666-6666-666666666666',
    assigned_at = now()
where id = '90000000-0000-4000-8000-000000000030';

select test_result.sign_out();
reset role;

-- Remember everything that must survive, so "unchanged" is a comparison
-- against evidence rather than a feeling.
create temporary table before_erasure as
select id, user_id, order_number, status, payment_status,
       subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
       placed_at, delivered_at, assigned_to
  from public.orders
 where id in ('90000000-0000-4000-8000-000000000030',
              '90000000-0000-4000-8000-000000000031');

-- =============================================================================
-- 1. The forbidden case, first. A live rider still cannot hand a delivery back.
-- =============================================================================

set role authenticated;
select test_result.sign_in('66666666-6666-6666-6666-666666666666');

select test_result.refused(
  'a live rider cannot hand an assigned delivery back by hand',
  $$update public.orders
       set assigned_to = null, assigned_at = null
     where id = '90000000-0000-4000-8000-000000000030'$$,
  '42501'
);

-- =============================================================================
-- 2. The allowed case: erase while carrying a delivery.
-- =============================================================================

do $$
begin
  perform public.delete_my_account();
  perform test_result.ok('a rider carrying a delivery can erase their account',
                         true);
exception
  when others then
    perform test_result.ok('a rider carrying a delivery can erase their account',
                           false, 'wrong error: ' || sqlerrm);
end;
$$;

reset role;

-- =============================================================================
-- 3. The person is gone.
-- =============================================================================

select test_result.eq(
  'the profile row is gone entirely',
  (select count(*)::text from public.profiles
    where id = '66666666-6666-6666-6666-666666666666'),
  '0'
);

select test_result.eq(
  'the auth user is gone (the number can sign up again)',
  (select count(*)::text from auth.users
    where id = '66666666-6666-6666-6666-666666666666'),
  '0'
);

select test_result.eq(
  'the rider''s address is gone',
  (select count(*)::text from public.addresses
    where user_id = '66666666-6666-6666-6666-666666666666'),
  '0'
);

-- =============================================================================
-- 4. The delivery they were carrying: the customer's order, still the
--    customer's. Only the assignment is gone.
-- =============================================================================

select test_result.eq(
  'the carried order still belongs to its own customer',
  (select o.user_id::text from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000030'),
  (select b.user_id::text from before_erasure b
    where b.id = '90000000-0000-4000-8000-000000000030')
);

select test_result.ok(
  '...and it is not the tombstone',
  (select o.user_id is distinct from public.deleted_customer_id()
     from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000030')
);

select test_result.ok(
  'the carried order is not anonymised',
  (select (o.delivery_address ->> 'erased') is distinct from 'true'
     from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000030')
);

select test_result.eq(
  'the assignment is gone',
  (select o.assigned_to::text from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000030'),
  null::text
);

select test_result.eq(
  'and so is the claim time — a claim with nobody attached is a lie',
  (select o.assigned_at::text from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000030'),
  null::text
);

-- `placed_at` and `delivered_at` are timestamptz; their text form differs from
-- `before_erasure`'s only by timezone rendering, so the comparison is done on
-- the epoch instead. Everything else is a plain integer/uuid equality.
select test_result.ok(
  'the carried order kept its money, status and number',
  (select b.status = o.status
       and b.payment_status = o.payment_status
       and b.subtotal_paise = o.subtotal_paise
       and b.delivery_fee_paise = o.delivery_fee_paise
       and b.discount_paise = o.discount_paise
       and b.total_paise = o.total_paise
       and b.order_number = o.order_number
       and b.delivered_at is not distinct from o.delivered_at
       and extract(epoch from b.placed_at) = extract(epoch from o.placed_at)
     from public.orders o
     join before_erasure b on b.id = o.id
    where o.id = '90000000-0000-4000-8000-000000000030')
);

-- =============================================================================
-- 5. The rider's OWN order is anonymised exactly as a customer's is (test 16).
-- =============================================================================

select test_result.eq(
  'the rider''s own order belongs to the tombstone',
  (select o.user_id::text from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000031'),
  (select public.deleted_customer_id()::text)
);

select test_result.eq(
  'the rider''s own order carries the erased marker',
  (select o.delivery_address ->> 'erased' from public.orders o
    where o.id = '90000000-0000-4000-8000-000000000031'),
  'true'
);

select test_result.ok(
  'the rider''s own order kept its money and status too',
  (select b.status = o.status
       and b.subtotal_paise = o.subtotal_paise
       and b.total_paise = o.total_paise
       and b.order_number = o.order_number
     from public.orders o
     join before_erasure b on b.id = o.id
    where o.id = '90000000-0000-4000-8000-000000000031')
);

-- =============================================================================
-- 6. The shop keeps working: the handed-back order can be claimed again.
-- =============================================================================

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.touches(
  'another rider can claim the handed-back delivery',
  $$update public.orders
       set assigned_to = auth.uid(), assigned_at = now()
     where id = '90000000-0000-4000-8000-000000000030'$$,
  1
);

select test_result.eq(
  'the order is now carried by the second rider',
  (select assigned_to::text from public.orders
    where id = '90000000-0000-4000-8000-000000000030'),
  '44444444-4444-4444-4444-444444444444'
);

select test_result.sign_out();
reset role;
