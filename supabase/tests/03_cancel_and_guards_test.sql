-- =============================================================================
-- 03 · cancel_order(), and proof that the older guard triggers still work.
--
-- The guard triggers are the reason this file exists. Dropping an RLS policy
-- must not be the only thing standing between a customer and a fake order, so
-- these tests deliberately step past RLS (acting as the table owner) and check
-- that the TRIGGER still catches the attempt.
-- =============================================================================

reset role;

update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';   -- Tomato
update public.products set stock_qty = 48, is_active = true, price_paise = 2700
  where id = '20000000-0000-4000-8000-000000000006';   -- Milk
update public.store_settings
   set is_open = true, open_time = '00:00', close_time = '23:59'
 where store_id = '00000000-0000-4000-8000-000000000001';

select test_result.begin_suite('03 cancel_order');

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

-- =============================================================================
-- 1. Cancelling puts the stock back, to the exact number
-- =============================================================================

do $$
declare
  v_result     jsonb;
  v_order_id   uuid;
  v_before     bigint;
begin
  v_before := (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":4}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'cancel-test-key-0031'
  );
  v_order_id := (v_result ->> 'order_id')::uuid;

  perform test_result.eq('cancel: order placed, 4 x Milk = 10800', (v_result ->> 'subtotal_paise')::bigint, 10800);
  perform test_result.eq('cancel: stock went down by 4', (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006'), v_before - 4);

  v_result := public.cancel_order(v_order_id);

  perform test_result.ok('cancel: ok', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('cancel: status is cancelled', (select status::text from public.orders where id = v_order_id), 'cancelled');
  perform test_result.eq('cancel: stock came back exactly', (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006'), v_before);
  perform test_result.eq('cancel: the total was not touched by cancelling', (select total_paise from public.orders where id = v_order_id), 12300);

  -- Cancelling again must do nothing at all: no negative stock, no double credit.
  v_result := public.cancel_order(v_order_id);
  perform test_result.eq('cancel twice: refused', v_result ->> 'error', 'cannot_cancel');
  perform test_result.eq('cancel twice: it says what the status is now', v_result ->> 'status', 'cancelled');
  perform test_result.eq('cancel twice: stock was NOT credited a second time', (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006'), v_before);
end;
$$;

-- =============================================================================
-- 2. Only while the order is still 'placed'
--    Asha places an order, then the rider picks it up, then she tries to cancel.
-- =============================================================================

do $$
declare
  v_order_id uuid;
begin
  v_order_id := (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'confirm-test-key-0032'
  ) ->> 'order_id')::uuid;

  perform test_result.ok('confirm: the order was placed', v_order_id is not null);
end;
$$;

-- The shop accepts it. Signed in as the owner, because that is who does this in
-- the admin panel, and because guard_order_update only relaxes for a real admin.
-- (PL/pgSQL cannot run SET ROLE, so this has to sit outside the DO block.)
set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- shop owner

update public.orders set status = 'confirmed'
 where id = (select id from public.orders
              where user_id = '11111111-1111-1111-1111-111111111111'
                and idempotency_key = 'confirm-test-key-0032');

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- back to Asha

do $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_tomato_before bigint;
  v_tomato_after  bigint;
begin
  select id into v_order_id from public.orders
   where idempotency_key = 'confirm-test-key-0032';

  perform test_result.eq('the order really is confirmed now', (select status::text from public.orders where id = v_order_id), 'confirmed');

  v_tomato_before := (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001');

  v_result := public.cancel_order(v_order_id);
  perform test_result.eq('an order the shop has confirmed cannot be cancelled', v_result ->> 'error', 'cannot_cancel');
  perform test_result.eq('and the status is reported back so the app can explain', v_result ->> 'status', 'confirmed');

  perform test_result.eq(
    'a refused cancellation leaves the stock alone',
    (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
    v_tomato_before
  );
end;
$$;

-- =============================================================================
-- 3. Not your order, and not signed in
-- =============================================================================

do $$
declare
  v_result jsonb;
  v_asha_order uuid;
begin
  -- Place a fresh one so this test does not depend on earlier files.
  v_asha_order := (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":4}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'privacy-cancel-key-0033'
  ) ->> 'order_id')::uuid;

  perform test_result.ok('there is an order to test with', v_asha_order is not null);

  perform test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi
  v_result := public.cancel_order(v_asha_order);
  perform test_result.eq('Ravi cannot cancel Asha''s order', v_result ->> 'error', 'order_not_found');
  perform test_result.ok('and Ravi cannot even see the row (0 rows visible)',
    not exists (select 1 from public.orders where id = v_asha_order));

  perform test_result.sign_out();
  v_result := public.cancel_order(v_asha_order);
  perform test_result.eq('a signed-out visitor cannot cancel', v_result ->> 'error', 'not_logged_in');

  perform test_result.sign_in('11111111-1111-1111-1111-111111111111');
end;
$$;

-- Checked as the table owner, because Ravi deliberately cannot see the row.
reset role;
select test_result.eq('Asha''s order is still placed after Ravi tried', (select status::text from public.orders where id = (select id from public.orders where idempotency_key = 'privacy-cancel-key-0033')), 'placed');

-- =============================================================================
-- 4. The guard triggers, with RLS deliberately bypassed
--
--    Everything below runs as the table owner, so RLS is not what stops it.
--    If these pass, the trigger is still doing its job.
-- =============================================================================

reset role;
select test_result.begin_suite('03b guard triggers (RLS bypassed on purpose)');

select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- Asha

-- guard_order_insert: a "customer" cannot smuggle in a paid, confirmed order.
do $$
declare
  v_id uuid;
begin
  insert into public.orders (
    user_id, store_id, address_id, delivery_address,
    status, payment_method, payment_status,
    subtotal_paise, delivery_fee_paise, discount_paise, total_paise
  ) values (
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    'confirmed', 'cod', 'paid',
    100, 0, 0, 100
  )
  returning id into v_id;

  perform test_result.eq(
    'guard_order_insert still forces a customer''s order to placed',
    (select status::text from public.orders where id = v_id),
    'placed'
  );
  perform test_result.eq(
    'guard_order_insert still forces payment_status to pending',
    (select payment_status::text from public.orders where id = v_id),
    'pending'
  );

  delete from public.orders where id = v_id;
end;
$$;

-- guard_order_update: a customer cannot edit the money on a live order.
select test_result.refused(
  'guard_order_update stops a customer rewriting the total',
  $$
  update public.orders
  set total_paise = 1, subtotal_paise = 1
  where id = (select id from public.orders
               where user_id = '11111111-1111-1111-1111-111111111111'
               order by placed_at desc limit 1)
  $$,
  null
);

-- ...and cannot cancel by moving it to a status that is not 'cancelled'.
select test_result.refused(
  'guard_order_update stops a customer jumping straight to delivered',
  $$
  update public.orders
  set status = 'delivered', delivered_at = now()
  where id = (select id from public.orders
               where user_id = '11111111-1111-1111-1111-111111111111'
               order by placed_at desc limit 1)
  $$
);

-- The rider may claim an unassigned order and move the status along, and only
-- the status. Since 20261013000001 a rider must own an order before advancing
-- it, so the same UPDATE that moves it also claims it (assigned_to was NULL).
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

do $$
declare
  v_id uuid;
begin
  select id into v_id from public.orders
  where user_id = '11111111-1111-1111-1111-111111111111'
  order by placed_at desc limit 1;

  update public.orders
  set assigned_to = auth.uid(), status = 'out_for_delivery'
  where id = v_id;

  perform test_result.eq(
    'the rider can claim an order and move it to out_for_delivery',
    (select status::text from public.orders where id = v_id),
    'out_for_delivery'
  );
end;
$$;

select test_result.refused(
  'but the rider cannot change the money while doing it',
  $$
  update public.orders
  set status = 'delivered', total_paise = 1, subtotal_paise = 1
  where id = (select id from public.orders
               where user_id = '11111111-1111-1111-1111-111111111111'
               order by placed_at desc limit 1)
  $$
);

-- guard_order_item_insert: a cancelled order's basket stays frozen, and the
-- line price is taken from the product row whatever the caller sent.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_cancelled  uuid;
  v_placed     uuid;
  v_fake_price integer;
begin
  select id into v_cancelled from public.orders
  where user_id = '11111111-1111-1111-1111-111111111111' and status = 'cancelled'
  limit 1;

  -- A brand new order, so this test never trips over leftovers from an earlier file.
  v_placed := (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":4}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'item-guard-key-0034'
  ) ->> 'order_id')::uuid;

  perform test_result.ok('placed a fresh order for the line item test', v_placed is not null);

  perform test_result.ok('found a cancelled order to test against', v_cancelled is not null);

  if v_cancelled is not null then
    perform test_result.refused(
      'guard_order_item_insert freezes a cancelled order''s basket',
      format($q$
        insert into public.order_items (order_id, product_id, price_paise, quantity)
        values ('%s', '20000000-0000-4000-8000-000000000001', 1, 1)
      $q$, v_cancelled),
      null
    );
  end if;

  -- A live order does accept an item, but the price is corrected to the
  -- catalogue price. This is the important half: 1 paise in, 1800 out.
  if v_placed is not null then
    insert into public.order_items (order_id, product_id, price_paise, quantity)
    values (v_placed, '20000000-0000-4000-8000-000000000001', 1, 2)
    returning price_paise into v_fake_price;

    perform test_result.eq(
      'guard_order_item_insert rewrites a fake price to the catalogue price',
      v_fake_price,
      1800
    );

    perform test_result.eq(
      'and line_total_paise is generated from the corrected price',
      (select line_total_paise from public.order_items
        where order_id = v_placed and product_id = '20000000-0000-4000-8000-000000000001'
          and quantity = 2),
      3600
    );
  end if;
end;
$$;

select test_result.sign_out();
reset role;