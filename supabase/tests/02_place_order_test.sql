-- =============================================================================
-- 02 · place_order() — every rule the shop depends on.
--
-- The theme throughout: the app sends product ids and quantities and NOTHING
-- else. Prices, fees, totals and stock all come from the database. If a test
-- here has to reach into a price, that is a sign the design is wrong.
-- =============================================================================

-- Start from a known shelf. This file takes stock away, so it puts it back
-- first. Done as the table owner because that is not what is under test.
reset role;

update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';   -- Tomato  Rs 18
update public.products set stock_qty = 60, is_active = true, price_paise = 2600
  where id = '20000000-0000-4000-8000-000000000002';   -- Onion   Rs 26
update public.products set stock_qty = 48, is_active = true, price_paise = 2700
  where id = '20000000-0000-4000-8000-000000000006';   -- Milk    Rs 27
update public.products set stock_qty = 0,  is_active = true, price_paise = 8000
  where id = '20000000-0000-4000-8000-000000000008';   -- Paneer  Rs 80, no stock
update public.products set stock_qty = 1, is_active = true, price_paise = 1000
  where id = '20000000-0000-4000-8000-00000000ffff';   -- test product, 1 left


;
$$;

-- =============================================================================
-- 2. Free delivery above the threshold
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  -- 20 x Milk at 2700 = 54000, which is above free_delivery_above_paise = 50000.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":20}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'free-delivery-key-0002'
  );

  perform test_result.ok('above the free threshold: ok', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('above the free threshold: subtotal', (v_result ->> 'subtotal_paise')::bigint, 54000);
  perform test_result.eq('above the free threshold: no delivery fee', (v_result ->> 'delivery_fee_paise')::bigint, 0);
  perform test_result.eq('above the free threshold: total is just the goods', (v_result ->> 'total_paise')::bigint, 54000);
end;
$$;

-- =============================================================================
-- 3. A different pincode has a different fee
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  -- Address 2 is pincode 572111, the Hunsur zone, fee 3500.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    'zone-fee-key-0003'
  );

  perform test_result.ok('other zone: ok', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('other zone: 5 x 2600', (v_result ->> 'subtotal_paise')::bigint, 13000);
  perform test_result.eq('other zone: Hunsur fee is 3500', (v_result ->> 'delivery_fee_paise')::bigint, 3500);
end;
$$;

-- =============================================================================
-- 4. The price comes from the database, not the request
-- =============================================================================

reset role;
update public.products set price_paise = 3000, mrp_paise = 3600 where id = '20000000-0000-4000-8000-000000000001';
set role authenticated;

do $$
declare
  v_result jsonb;
begin
  -- The request says nothing about price. Even if it did, this is what counts.
  -- 5 x Tomato at the new 3000 = 15000, over the 10000 minimum.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'db-price-key-0004'
  );

  perform test_result.ok('db price: the order went through', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('db price: the new price was charged', (v_result ->> 'subtotal_paise')::bigint, 15000);
  perform test_result.eq(
    'db price: the line item snapshotted the db price',
    (select price_paise from public.order_items
      where order_id = (v_result ->> 'order_id')::uuid
        and product_id = '20000000-0000-4000-8000-000000000001'),
    3000
  );
  perform test_result.eq(
    'db price: and the generated line total follows it',
    (select line_total_paise from public.order_items
      where order_id = (v_result ->> 'order_id')::uuid
        and product_id = '20000000-0000-4000-8000-000000000001'),
    15000
  );
end;
$$;

reset role;
update public.products set price_paise = 1800 where id = '20000000-0000-4000-8000-000000000001';
set role authenticated;

-- =============================================================================
-- 5. Not enough stock — and nothing else is touched
-- =============================================================================

reset role;
update public.products set stock_qty = 1 where id = '20000000-0000-4000-8000-000000000001';
set role authenticated;

do $$
declare
  v_result      jsonb;
  v_item        jsonb;
  v_before      bigint;
  v_milk_before bigint;
begin
  v_before := (select count(*) from public.orders);
  v_milk_before := (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006');

  -- Asking for 2 when only 1 is on the shelf, alongside something that is fine.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":2},
      {"product_id":"20000000-0000-4000-8000-000000000006","quantity":1}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'short-stock-key-0005'
  );

  perform test_result.ok('short stock: refused', v_result ->> 'ok' = 'false');
  perform test_result.eq('short stock: the error code', v_result ->> 'error', 'items_unavailable');

  v_item := v_result -> 'items' -> 0;
  perform test_result.eq('short stock: it names the product', v_item ->> 'product_id', '20000000-0000-4000-8000-000000000001');
  perform test_result.eq('short stock: it says what was asked for', v_item ->> 'requested', '2');
  perform test_result.eq('short stock: it says what is available', v_item ->> 'available', '1');
  perform test_result.eq('short stock: the reason', v_item ->> 'reason', 'insufficient_stock');
  perform test_result.ok('short stock: it includes the Kannada name for the message', v_item ? 'name_kn', v_item::text);

  perform test_result.eq('short stock: NO order was created', (select count(*) from public.orders), v_before);

  -- All or nothing: the good line must NOT have taken its unit off the shelf.
  perform test_result.eq(
    'short stock: the healthy line was NOT decremented',
    (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006'),
    v_milk_before
  );
  perform test_result.eq(
    'short stock: the short line kept its stock',
    (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000001'),
    1
  );
end;
$$;

-- =============================================================================
-- 6. A product with no stock at all comes back as available = 0
--    The app removes that line from the cart and tells the customer.
-- =============================================================================

do $$
declare
  v_result jsonb;
  v_item   jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000008","quantity":1}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'zero-stock-key-0006'
  );

  perform test_result.eq('no stock: refused', v_result ->> 'error', 'items_unavailable');
  v_item := v_result -> 'items' -> 0;
  perform test_result.eq('no stock: available is 0', v_item ->> 'available', '0');
  perform test_result.eq('no stock: reason', v_item ->> 'reason', 'insufficient_stock');
end;
$$;

-- =============================================================================
-- 7. A product the shop has taken off the shelf
-- =============================================================================

reset role;
update public.products set is_active = false where id = '20000000-0000-4000-8000-000000000002';
set role authenticated;

do $$
declare
  v_result jsonb;
  v_item   jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'inactive-key-0007'
  );

  perform test_result.eq('off the shelf: refused', v_result ->> 'error', 'items_unavailable');
  v_item := v_result -> 'items' -> 0;
  perform test_result.eq('off the shelf: reason is unavailable, not short', v_item ->> 'reason', 'unavailable');
  perform test_result.eq('off the shelf: available is 0', v_item ->> 'available', '0');
end;
$$;

reset role;
update public.products set is_active = true where id = '20000000-0000-4000-8000-000000000002';
set role authenticated;

-- =============================================================================
-- 8. A product id from a different shop
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"ffffffff-0000-4000-8000-000000000099","quantity":1}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'wrong-shop-key-0008'
  );

  perform test_result.eq('unknown product: refused', v_result ->> 'error', 'items_unavailable');
  perform test_result.eq(
    'unknown product: reported as unavailable',
    (v_result -> 'items' -> 0) ->> 'reason',
    'unavailable'
  );
end;
$$;

-- =============================================================================
-- 9. Addresses that are not yours, or not served
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',   -- Ravi's address
    'other-address-key-0009'
  );
  perform test_result.eq('another customer''s address is refused', v_result ->> 'error', 'address_not_found');

  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000003',   -- pincode 999999, not served
    'unserved-key-0010'
  );
  perform test_result.eq('an unserved pincode is refused', v_result ->> 'error', 'zone_not_served');
end;
$$;

-- =============================================================================
-- 10. The shop has to be open
-- =============================================================================

reset role;
update public.store_settings set is_open = false where store_id = '00000000-0000-4000-8000-000000000001';
set role authenticated;

do $$
declare v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'closed-key-0011'
  );
  perform test_result.eq('a closed shop refuses orders', v_result ->> 'error', 'store_closed');
end;
$$;

-- skipped subtler clock test the flag says open, but the clock says otherwise.
-- A window that starts half an hour from now, so "now" is outside it. (The
-- open_time < close_time CHECK rule means an empty window is not allowed, and
-- going via midnight is handled by the overnight branch in place_order.)
reset role;
update public.store_settings
   set is_open = true,
       open_time = ((now() at time zone 'Asia/Kolkata')::time + interval '30 minutes')::time,
       close_time = ((now() at time zone 'Asia/Kolkata')::time + interval '90 minutes')::time
 where store_id = '00000000-0000-4000-8000-000000000001';
set role authenticated;

do $$
declare v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'closed-hours-key-0012'
  );
  perform test_result.eq('outside opening hours refuses orders', v_result ->> 'error', 'store_closed');
end;
$$;

reset role;
update public.store_settings
   set is_open = true, open_time = '00:00', close_time = '23:59'
 where store_id = '00000000-0000-4000-8000-000000000001';
set role authenticated;

-- =============================================================================
-- 11. Smallest order the shop accepts
-- =============================================================================

do $$
declare
  v_result jsonb;
  v_before bigint;
begin
  v_before := (select count(*) from public.orders);

  -- 1 x Milk = 2700, below min_order_value_paise = 10000.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":1}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'too-small-key-0013'
  );

  perform test_result.eq('too small a basket is refused', v_result ->> 'error', 'below_minimum');
  perform test_result.eq('too small: it tells the app the minimum', (v_result ->> 'min_order_value_paise')::bigint, 10000);
  perform test_result.eq('too small: it tells the app the subtotal so far', (v_result ->> 'subtotal_paise')::bigint, 2700);
  perform test_result.eq('too small: NO order was created', (select count(*) from public.orders), v_before);
end;
$$;

-- =============================================================================
-- 12. The same idempotency key twice = one order
--     This is what protects against a double tap and against a retry.
-- =============================================================================

do $$
declare
  v_first  jsonb;
  v_second jsonb;
  v_before bigint;
  v_milk_before bigint;
begin
  v_before := (select count(*) from public.orders);
  v_milk_before := (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006');

  v_first := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'double-tap-key-0014'
  );
  perform test_result.ok('idempotency: first call placed the order', v_first ->> 'ok' = 'true', v_first::text);
  perform test_result.eq('idempotency: it was a fresh order, not a replay', v_first ->> 'replayed', 'false');

  v_second := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'double-tap-key-0014'
  );

  perform test_result.ok('idempotency: the retry also says ok', v_second ->> 'ok' = 'true', v_second::text);
  perform test_result.eq('idempotency: it is flagged as a replay', v_second ->> 'replayed', 'true');
  perform test_result.eq('idempotency: same order id both times', v_second ->> 'order_id', v_first ->> 'order_id');
  perform test_result.eq('idempotency: still only ONE new order', (select count(*) from public.orders), v_before + 1);

  -- And the idempotency one, which also depends on the current stock:
  perform test_result.eq(
    'idempotency: stock was decremented ONCE, not twice',
    (select stock_qty from public.products where id = '20000000-0000-4000-8000-000000000006'),
    v_milk_before - 5
  );
end;
$$;

-- =============================================================================
-- 13. Different customers may use the same key
--     The unique index is on (user_id, idempotency_key), not the key alone.
-- =============================================================================

do $$
declare
  v_asha  jsonb;
  v_ravi  jsonb;
  v_ravi_address uuid;
begin
  v_asha := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'shared-key-0015'
  );
  perform test_result.ok('shared key: Asha placed hers', v_asha ->> 'ok' = 'true', v_asha::text);

  perform test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi
  select id into v_ravi_address from public.addresses
   where user_id = '22222222-2222-2222-2222-222222222222' limit 1;

  v_ravi := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000002","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    v_ravi_address,
    'shared-key-0015'
  );
  perform test_result.ok('shared key: Ravi placed his own order', v_ravi ->> 'ok' = 'true', v_ravi::text);
  perform test_result.ok('shared key: and it is a DIFFERENT order', v_ravi ->> 'order_id' <> v_asha ->> 'order_id');
end;
$$;

-- =============================================================================
-- 14. Silly or hostile input is refused before it reaches a table
-- =============================================================================

select test_result.begin_suite('02c malformed input');

select test_result.sign_in('11111111-1111-1111-1111-111111111111');   -- back to Asha

do $$
declare
  v_result jsonb;
begin
  perform test_result.eq('no items at all', (public.place_order(
    '[]'::jsonb, '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'empty-cart-key-0016')) ->> 'error', 'empty_cart');

  perform test_result.eq('quantity of zero', (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":0}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'zero-qty-key-0017')) ->> 'error', 'invalid_items');

  perform test_result.eq('negative quantity', (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":-5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'neg-qty-key-0018')) ->> 'error', 'invalid_items');

  perform test_result.eq('fractional quantity', (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":2.5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'frac-qty-key-0019')) ->> 'error', 'invalid_items');

  perform test_result.eq('absurd quantity (over 99)', (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":1000}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'huge-qty-key-0020')) ->> 'error', 'invalid_items');

  perform test_result.eq('product_id that is not a uuid', (public.place_order(
    '[{"product_id":"1; drop table public.products","quantity":1}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'sql-ish-key-0021')) ->> 'error', 'invalid_items');

  perform test_result.eq('items that are not even a list', (public.place_order(
    '{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}'::jsonb,
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'not-array-key-0022')) ->> 'error', 'invalid_items');

  perform test_result.eq('a missing idempotency key', (public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001', 'short')) ->> 'error', 'invalid_idempotency_key');

  -- A hostile price in the payload is simply ignored, because the function
  -- never reads it.
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5,
       "price_paise":1,"discount_paise":99999}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'hostile-price-key-0023'
  );
  perform test_result.ok('a price in the payload is ignored, not obeyed', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('a fake price does not lower the total', (v_result ->> 'subtotal_paise')::bigint, 13500);
end;
$$;

-- =============================================================================
-- 15. Nobody is signed in
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  perform test_result.sign_out();
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000006","quantity":5}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'anonymous-key-0024'
  );
  perform test_result.eq('a signed-out visitor cannot place an order', v_result ->> 'error', 'not_logged_in');
end;
$$;

-- =============================================================================
-- 16. One customer cannot read another customer's orders
-- =============================================================================

reset role;
select test_result.begin_suite('02b order privacy');
set role authenticated;

select test_result.sign_in('22222222-2222-2222-2222-222222222222');   -- Ravi

do $$
declare
  v_count bigint;
  v_leak  text;
begin
  select count(*) into v_count from public.orders;
  perform test_result.ok('Ravi sees only his own orders, not Asha''s', v_count > 0 and v_count <= 2,
                         format('Ravi can see %s order(s)', v_count));

  select coalesce(string_agg(distinct user_id::text, ','), '') into v_leak
  from public.orders;

  perform test_result.ok('and none of them belong to Asha',
    not exists (
      select 1 from public.orders
      where user_id = '11111111-1111-1111-1111-111111111111'
    ),
    v_leak
  );
end;
$$;

select test_result.sign_out();
reset role;