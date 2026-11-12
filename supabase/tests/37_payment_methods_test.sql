-- =============================================================================
-- 37 · Payment methods
--
-- The requirement is "let the customer choose". The thing that makes that
-- honest is not the list of buttons: it is that the DATABASE refuses a method
-- the shop cannot collect, and that "paid" is a fact somebody can point at.
--
--   1. with online payments off, a UPI order is refused and no row is written;
--   2. with them on, every specific method is accepted and stored;
--   3. only the shop can mark an online payment received, and only with a
--      reference;
--   4. a COD order is settled by the cash path, never by this one;
--   5. a cancelled order cannot be marked paid — that money would be a refund;
--   6. marking twice is safe and does not rewrite the reference.
-- =============================================================================

select test_result.begin_suite('37 payment methods');

reset role;

update public.store_settings
   set is_open = true, online_payments_enabled = false
 where store_id = '00000000-0000-4000-8000-000000000001';

update public.products set stock_qty = 40, is_active = true, price_paise = 1800
  where id = '20000000-0000-4000-8000-000000000001';

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

-- =============================================================================
-- 1. A method the shop cannot collect is refused before anything is written.
-- =============================================================================

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'pay-off-key-000001',
    null, null, 'upi'
  );

  perform test_result.eq('online off: UPI is refused',
    v_result ->> 'error', 'online_payment_unavailable');
  perform test_result.eq('online off: no order was written',
    (select count(*) from public.orders
      where idempotency_key = 'pay-off-key-000001')::text, '0');
end;
$$;

-- =============================================================================
-- 2. Switched on, every specific method is a real choice.
-- =============================================================================

reset role;
update public.store_settings
   set online_payments_enabled = true
 where store_id = '00000000-0000-4000-8000-000000000001';
set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
  v_id     uuid;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'pay-upi-key-000001',
    null, null, 'upi'
  );

  perform test_result.ok('UPI is accepted when enabled', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('the method comes back as UPI', v_result ->> 'payment_method', 'upi');

  v_id := (v_result ->> 'order_id')::uuid;
  perform set_config('kunigal.upi_order', v_id::text, false);

  perform test_result.eq('a new online order starts unpaid',
    (select payment_status::text from public.orders where id = v_id), 'pending');
  perform test_result.eq('and says how it will be paid',
    (select payment_method::text from public.orders where id = v_id), 'upi');
end;
$$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'pay-card-key-00001',
    null, null, 'card'
  );

  perform test_result.ok('card is accepted', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('card is stored', v_result ->> 'payment_method', 'card');
end;
$$;

-- The enum carries every method the checkout can offer.
select test_result.ok(
  'the enum has cod, upi, card, netbanking and wallet',
  (select count(*) from unnest(enum_range(null::public.payment_method)) v
    where v::text in ('cod', 'upi', 'card', 'netbanking', 'wallet')) = 5
);

-- =============================================================================
-- 3. "Paid" is a write only the shop can make, and it needs a reference.
-- =============================================================================

select test_result.refused(
  'a customer cannot mark their own payment as received',
  format('select public.mark_online_payment_paid(%L, %L)',
         current_setting('kunigal.upi_order'), 'UPI-123'),
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');   -- the rider
select test_result.refused(
  'a rider cannot either',
  format('select public.mark_online_payment_paid(%L, %L)',
         current_setting('kunigal.upi_order'), 'UPI-123'),
  '42501'
);

select test_result.sign_in('33333333-3333-3333-3333-333333333333');   -- the owner
select test_result.refused(
  'the shop must supply a reference',
  format('select public.mark_online_payment_paid(%L, %L)',
         current_setting('kunigal.upi_order'), '   '),
  '22023'
);

select test_result.eq(
  'the shop marks it paid, and the stored row comes back',
  (select payment_status::text || '/' || payment_reference
     from public.mark_online_payment_paid(
       current_setting('kunigal.upi_order')::uuid, 'UPI-20261112-001')),
  'paid/UPI-20261112-001'
);

select test_result.eq(
  'a second tap is a safe retry, not a second write',
  (select payment_status::text || '/' || payment_reference
     from public.mark_online_payment_paid(
       current_setting('kunigal.upi_order')::uuid, 'A-DIFFERENT-REFERENCE')),
  'paid/UPI-20261112-001'
);

-- =============================================================================
-- 4. Cash is settled by the cash path, not this one.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'pay-cod-key-000001'
  );

  perform test_result.ok('a COD order is placed', v_result ->> 'ok' = 'true', v_result::text);
  perform test_result.eq('COD is the default', v_result ->> 'payment_method', 'cod');
  perform set_config('kunigal.cod_order', v_result ->> 'order_id', false);
end;
$$;

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.refused(
  'a COD order cannot be marked as an online payment',
  format('select public.mark_online_payment_paid(%L, %L)',
         current_setting('kunigal.cod_order'), 'UPI-123'),
  '22023'
);

-- =============================================================================
-- 5. A cancelled order cannot become "paid" — it would be a refund on arrival.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_result jsonb;
begin
  v_result := public.place_order(
    '[{"product_id":"20000000-0000-4000-8000-000000000001","quantity":6}]',
    '00000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'pay-cancel-key-0001',
    null, null, 'netbanking'
  );

  perform test_result.ok('a net-banking order is placed', v_result ->> 'ok' = 'true', v_result::text);
  perform set_config('kunigal.cancelled_order', v_result ->> 'order_id', false);

  perform public.cancel_order((v_result ->> 'order_id')::uuid);
end;
$$;

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.refused(
  'a cancelled order cannot be marked paid',
  format('select public.mark_online_payment_paid(%L, %L)',
         current_setting('kunigal.cancelled_order'), 'UPI-999'),
  '22023'
);

-- =============================================================================
-- Put the fixture back: online payments are OFF in this shop today.
-- =============================================================================

reset role;
update public.store_settings
   set online_payments_enabled = false
 where store_id = '00000000-0000-4000-8000-000000000001';
