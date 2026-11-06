-- =============================================================================
-- 27 · The delivery code: the handover is proved, not assumed.
--
-- Rule 9.7: a table, a function and a guard trigger are not done until a test
-- proves the FORBIDDEN case fails. The claims this file has to make true:
--
--   1. a code is issued when an order goes out for delivery, and destroyed when
--      it leaves that state (delivered, failed, or closed by the owner);
--   2. the customer reads their OWN code, and no one else can:
--        * another customer is refused,
--        * the assigned rider is refused (otherwise the code proves nothing),
--        * the owner MAY read it, to help on the phone;
--   3. no client can read or write the table directly;
--   4. a rider cannot reach `delivered` by updating the order, even with the
--      right timestamp — the code must go through complete_delivery();
--   5. a wrong code fails, is counted, and after five tries the code locks;
--   6. a non-4-digit entry does not burn a try;
--   7. the transaction-local proof is bound to ONE order id, so a code verified
--      for order A cannot close order B;
--   8. the right code closes the delivery, records the time, and destroys the
--      code; the owner can still close an order directly (the escape hatch).
-- =============================================================================

select test_result.begin_suite('27 delivery otp');

-- -----------------------------------------------------------------------------
-- Setup. As the table owner, with the admin signed in so orders_guard_insert
-- does not force every inserted order back to `placed`.
--
-- Six deliveries, each with one job:
--   otp1  Asha's, rider 4444, out  -> wrong code, then the successful close
--   otp2  Ravi's, rider 4444, out  -> the code is bound to one order
--   otp3  Asha's, rider 5555, out  -> the other rider cannot close it
--   otp4  Asha's, rider 4444, out  -> five wrong tries, then the owner closes
--   otp5  Asha's, placed, no rider -> the code appears on the way out
--   otp6  Asha's, rider 4444, out  -> a failure destroys the code too
-- -----------------------------------------------------------------------------

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
reset role;

insert into auth.users (id, phone, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', '+919800000005',
   '{"full_name":"Rider Two"}')
on conflict (id) do nothing;

update public.profiles
set role = 'delivery' where id = '55555555-5555-5555-5555-555555555555';

insert into public.orders (
  id, user_id, store_id, address_id, delivery_address,
  status, payment_method, payment_status,
  subtotal_paise, delivery_fee_paise, discount_paise, total_paise,
  assigned_to, assigned_at
)
values
  ('90000000-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 5000, 0, 0, 5000,
   '44444444-4444-4444-4444-444444444444', now()),
  ('90000000-0000-4000-8000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000004',
   '{"line1":"45, Nehru Nagar","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 6000, 0, 0, 6000,
   '44444444-4444-4444-4444-444444444444', now()),
  ('90000000-0000-4000-8000-000000000003',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 7000, 0, 0, 7000,
   '55555555-5555-5555-5555-555555555555', now()),
  ('90000000-0000-4000-8000-000000000004',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 8000, 0, 0, 8000,
   '44444444-4444-4444-4444-444444444444', now()),
  ('90000000-0000-4000-8000-000000000005',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'placed', 'cod', 'pending', 9000, 0, 0, 9000, null, null),
  ('90000000-0000-4000-8000-000000000006',
   '11111111-1111-1111-1111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   '{"line1":"12, Gandhi Road","pincode":"572130"}'::jsonb,
   'out_for_delivery', 'cod', 'pending', 10000, 0, 0, 10000,
   '44444444-4444-4444-4444-444444444444', now())
on conflict (id) do nothing;

-- =============================================================================
-- 1. The code exists, and only for a live delivery.
-- =============================================================================

select test_result.eq(
  'each out-for-delivery order got a code, and the placed one did not',
  (select count(*)::text from public.order_delivery_codes
    where order_id in ('90000000-0000-4000-8000-000000000001',
                       '90000000-0000-4000-8000-000000000002',
                       '90000000-0000-4000-8000-000000000003',
                       '90000000-0000-4000-8000-000000000004',
                       '90000000-0000-4000-8000-000000000005',
                       '90000000-0000-4000-8000-000000000006')),
  '5'
);

select test_result.ok(
  'every issued code is exactly four digits',
  (select bool_and(code ~ '^[0-9]{4}$')
     from public.order_delivery_codes
    where order_id in ('90000000-0000-4000-8000-000000000001',
                       '90000000-0000-4000-8000-000000000002',
                       '90000000-0000-4000-8000-000000000003',
                       '90000000-0000-4000-8000-000000000004',
                       '90000000-0000-4000-8000-000000000006'))
);

select test_result.ok(
  'an order still being packed has no code to read yet',
  not exists (select 1 from public.order_delivery_codes
               where order_id = '90000000-0000-4000-8000-000000000005')
);

-- =============================================================================
-- 2. No client can touch the table directly.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot read the code table directly',
  $$select count(*) from public.order_delivery_codes$$,
  '42501'
);

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'a rider cannot read the code table directly',
  $$select count(*) from public.order_delivery_codes$$,
  '42501'
);

select test_result.refused(
  'a rider cannot reset the attempt counter',
  $$update public.order_delivery_codes set attempts = 0
     where order_id = '90000000-0000-4000-8000-000000000001'$$,
  '42501'
);

select test_result.refused(
  'a rider cannot plant a code of their own',
  $$insert into public.order_delivery_codes (order_id, code)
    values ('90000000-0000-4000-8000-000000000001', '1111')$$,
  '42501'
);

-- =============================================================================
-- 3. Who may read the code: the customer, and the owner. Nobody else.
-- =============================================================================

select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'Asha can read the code for her own delivery',
  (public.my_delivery_code('90000000-0000-4000-8000-000000000001') ->> 'ok'),
  'true'
);

select test_result.ok(
  'what she reads is a real four-digit code',
  (public.my_delivery_code('90000000-0000-4000-8000-000000000001') ->> 'code')
    ~ '^[0-9]{4}$'
);

-- Remember two real codes for the assertions below. A session setting is used
-- rather than a temp table because the code table itself is unreadable from
-- every client role — which is the point.
select set_config(
  'test.otp_one',
  coalesce(public.my_delivery_code('90000000-0000-4000-8000-000000000001') ->> 'code', ''),
  false
);
select set_config(
  'test.otp_four',
  coalesce(public.my_delivery_code('90000000-0000-4000-8000-000000000004') ->> 'code', ''),
  false
);
-- A wrong guess derived from the real code, so this test cannot flake on a
-- 1-in-10000 coincidence.
select set_config(
  'test.otp_wrong_one',
  case when current_setting('test.otp_one') = '0000' then '1111' else '0000' end,
  false
);
select set_config(
  'test.otp_wrong_four',
  case when current_setting('test.otp_four') = '0000' then '1111' else '0000' end,
  false
);

-- The assigned rider must NOT be able to read it, or the handover would prove
-- nothing: the phone that delivers could read its own answer.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'the assigned rider cannot read the customer''s code',
  $$select public.my_delivery_code('90000000-0000-4000-8000-000000000001')$$,
  '42501'
);

-- Another customer must not read it either.
select test_result.sign_in('22222222-2222-2222-2222-222222222222');

select test_result.refused(
  'another customer cannot read somebody else''s code',
  $$select public.my_delivery_code('90000000-0000-4000-8000-000000000001')$$,
  '42501'
);

-- The owner may, to help a customer whose screen has died.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.eq(
  'the shop owner can read a code to help on the phone',
  (public.my_delivery_code('90000000-0000-4000-8000-000000000003') ->> 'ok'),
  'true'
);

-- =============================================================================
-- 4. A rider cannot say "delivered" by updating the order.
-- =============================================================================

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'the assigned rider cannot mark delivered with only a timestamp',
  $$
  update public.orders
     set status = 'delivered', delivered_at = now()
   where id = '90000000-0000-4000-8000-000000000001'
  $$,
  '42501'
);

select test_result.eq(
  'and the order is still out for delivery',
  (select status::text from public.orders
    where id = '90000000-0000-4000-8000-000000000001'),
  'out_for_delivery'
);

-- Another rider cannot complete an order that is not theirs.
select test_result.sign_in('55555555-5555-5555-5555-555555555555');

select test_result.refused(
  'a rider cannot complete somebody else''s delivery',
  $$select public.complete_delivery(
      '90000000-0000-4000-8000-000000000001',
      current_setting('test.otp_one'))$$,
  '42501'
);

-- A customer cannot use the rider's function at all.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.refused(
  'a customer cannot complete a delivery',
  $$select public.complete_delivery(
      '90000000-0000-4000-8000-000000000001',
      current_setting('test.otp_one'))$$,
  '42501'
);

-- =============================================================================
-- 5. The wrong code fails, is counted, and does not leak the right one.
-- =============================================================================

select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.eq(
  'a wrong code is refused as a wrong code',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001',
     current_setting('test.otp_wrong_one')) ->> 'error'),
  'wrong_code'
);

select test_result.eq(
  'the rider is told how many tries are left',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001',
     current_setting('test.otp_wrong_one')) ->> 'attempts_left'),
  '3'
);

select test_result.ok(
  'a failed attempt never returns the real code',
  not (public.complete_delivery(
         '90000000-0000-4000-8000-000000000001',
         current_setting('test.otp_wrong_one')) ? 'code')
);

-- A non-4-digit entry is a typo, not a guess: it must not burn a try. Three
-- wrong guesses have happened, so two tries must still be left — before and
-- after the typo.
select test_result.eq(
  'a non-numeric entry is reported as invalid',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001', 'abcd') ->> 'error'),
  'invalid_code'
);

select test_result.eq(
  'and the typo did not count as an attempt',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001', 'abcd') ->> 'attempts_left'),
  '2'
);

reset role;
select test_result.eq(
  'the counter really moved: three wrong guesses',
  (select attempts::text from public.order_delivery_codes
    where order_id = '90000000-0000-4000-8000-000000000001'),
  '3'
);
set role authenticated;

-- =============================================================================
-- 6. The proof is bound to one order: a code verified for A cannot close B.
-- =============================================================================
-- This simulates a client that could set the transaction-local flag itself. It
-- still cannot close a different order, because the flag carries the order id.
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.refused(
  'a flag set for one order cannot deliver another',
  $sql$
  do $do$
  begin
    perform set_config('delivery.otp_verified',
                       '90000000-0000-4000-8000-000000000001', true);
    update public.orders
       set status = 'delivered', delivered_at = now()
     where id = '90000000-0000-4000-8000-000000000002';
  end
  $do$;
  $sql$,
  '42501'
);

-- =============================================================================
-- 7. Five wrong tries lock the code. The owner can still close the order.
-- =============================================================================

do $$
begin
  for i in 1..5 loop
    perform public.complete_delivery(
      '90000000-0000-4000-8000-000000000004',
      current_setting('test.otp_wrong_four'));
  end loop;
end;
$$;

select test_result.eq(
  'after five wrong tries the code is locked',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000004',
     current_setting('test.otp_four')) ->> 'error'),
  'locked'
);

select test_result.eq(
  'and the order is still out for delivery',
  (select status::text from public.orders
    where id = '90000000-0000-4000-8000-000000000004'),
  'out_for_delivery'
);

reset role;
select test_result.eq(
  'the lock really is stored at five attempts',
  (select attempts::text from public.order_delivery_codes
    where order_id = '90000000-0000-4000-8000-000000000004'),
  '5'
);

-- The documented escape hatch: the owner closes it directly.
select test_result.sign_in('33333333-3333-3333-3333-333333333333');
set role authenticated;
select test_result.touches(
  'the shop owner can close a locked delivery directly',
  $$
  update public.orders
     set status = 'delivered', delivered_at = now()
   where id = '90000000-0000-4000-8000-000000000004'
  $$,
  1
);

reset role;
select test_result.ok(
  'closing the order destroys the locked code as well',
  not exists (select 1 from public.order_delivery_codes
               where order_id = '90000000-0000-4000-8000-000000000004')
);

-- =============================================================================
-- 8. The right code closes the delivery, and the code is gone afterwards.
-- =============================================================================

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.eq(
  'the right code completes the delivery',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001',
     current_setting('test.otp_one')) ->> 'ok'),
  'true'
);

select test_result.eq(
  'the order is delivered and the time is recorded',
  (select (status = 'delivered' and delivered_at is not null)::text
     from public.orders where id = '90000000-0000-4000-8000-000000000001'),
  'true'
);

select test_result.eq(
  'a delivered order cannot be completed again',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000001',
     current_setting('test.otp_one')) ->> 'error'),
  'not_out_for_delivery'
);

-- The customer's screen must stop offering a code the moment it is spent.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

select test_result.eq(
  'the customer can no longer read a code for the delivered order',
  (public.my_delivery_code('90000000-0000-4000-8000-000000000001') ->> 'error'),
  'not_available'
);

reset role;
select test_result.ok(
  'the spent code is deleted from the table',
  not exists (select 1 from public.order_delivery_codes
               where order_id = '90000000-0000-4000-8000-000000000001')
);

-- =============================================================================
-- 9. A failed attempt destroys the code too, and cannot be spent afterwards.
-- =============================================================================

set role authenticated;
select test_result.sign_in('44444444-4444-4444-4444-444444444444');

select test_result.touches(
  'the rider fails the sixth delivery honestly',
  $$
  update public.orders
     set status = 'failed', failure_reason = 'not_home'
   where id = '90000000-0000-4000-8000-000000000006'
  $$,
  1
);

select test_result.eq(
  'a failed order cannot be completed with its old code',
  (public.complete_delivery(
     '90000000-0000-4000-8000-000000000006',
     current_setting('test.otp_one')) ->> 'error'),
  'not_out_for_delivery'
);

reset role;
select test_result.ok(
  'the failed delivery has no code left behind',
  not exists (select 1 from public.order_delivery_codes
               where order_id = '90000000-0000-4000-8000-000000000006')
);

-- =============================================================================
-- 10. A code appears on the way out, and is destroyed on the way through.
-- =============================================================================
-- The owner moves this one: order 5 has no rider, so nobody else could.

select test_result.sign_in('33333333-3333-3333-3333-333333333333');

update public.orders
set status = 'out_for_delivery'
where id = '90000000-0000-4000-8000-000000000005';

select test_result.ok(
  'moving an order out for delivery issues a code',
  exists (select 1 from public.order_delivery_codes
           where order_id = '90000000-0000-4000-8000-000000000005')
);

update public.orders
set status = 'delivered', delivered_at = now()
where id = '90000000-0000-4000-8000-000000000005';

select test_result.ok(
  'an owner-closed delivery takes its code with it',
  not exists (select 1 from public.order_delivery_codes
               where order_id = '90000000-0000-4000-8000-000000000005')
);
