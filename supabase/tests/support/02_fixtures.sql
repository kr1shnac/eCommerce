-- =============================================================================
-- Test fixtures: four fake users, four addresses, one product with one unit.
--
-- Everything here is done as the table owner (no `set role`), because setting up
-- is not what is being tested — only reading it is.
-- =============================================================================

select test_result.begin_suite('fixtures');

-- -----------------------------------------------------------------------------
-- Users. Inserting into auth.users fires handle_new_user(), which creates the
-- profile automatically. That itself is worth checking.
-- -----------------------------------------------------------------------------

insert into auth.users (id, phone, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', '+919800000001', '{"full_name":"Asha"}'),
  ('22222222-2222-2222-2222-222222222222', '+919800000002', '{"full_name":"Ravi"}'),
  ('33333333-3333-3333-3333-333333333333', '+919800000003', '{"full_name":"Shop Owner"}'),
  ('44444444-4444-4444-4444-444444444444', '+919800000004', '{"full_name":"Rider"}')
on conflict (id) do nothing;

select test_result.ok(
  'handle_new_user() created a profile for Asha',
  exists (select 1 from public.profiles where id = '11111111-1111-1111-1111-111111111111')
);

update public.profiles
set role = 'admin' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles
set role = 'delivery' where id = '44444444-4444-4444-4444-444444444444';

select test_result.eq(
  'the shop owner really is admin',
  (select role::text from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'admin'
);

-- -----------------------------------------------------------------------------
-- Addresses.
--   Asha's home     -> pincode 571915, inside the shop's zone, fee 1500
--   Asha's office   -> pincode 572111, inside a zone, fee 3500
--   Asha's village  -> pincode 999999, the shop does not deliver there
--   Ravi's home     -> pincode 571915, belongs to another customer
-- -----------------------------------------------------------------------------

insert into public.addresses
  (id, user_id, label, full_name, phone, line1, city, pincode, is_default)
values
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Home', 'Asha', '+919800000001', '12, Gandhi Road', 'Kunigal', '571915', true),
  ('50000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Office', 'Asha', '+919800000001', '3rd Floor, Tech Park', 'Kunigal', '572111', false),
  ('50000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Village', 'Asha', '+919800000001', 'Near the temple', 'Narasapura', '999999', false),
  ('50000000-0000-4000-8000-000000000004', '22222222-2222-2222-2222-222222222222',
   'Home', 'Ravi', '+919800000002', '45, Nehru Nagar', 'Kunigal', '571915', true)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Product used by the "two customers want the last unit" test. Exactly 1 left.
-- -----------------------------------------------------------------------------

insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, sort_order)
values
  ('20000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000005', 'Last Unit Mango', 'ಕೊನೆಯ ಮಾಂಗೋ', 1000, 1200, '1 kg', 1, 99)
on conflict (id) do update set stock_qty = excluded.stock_qty;

-- -----------------------------------------------------------------------------
-- Neutralise the clock.
--
-- The seed says "open 06:00 to 22:00". A test that runs at 23:00 would then fail
-- for the wrong reason. So opening hours are pinned to cover the whole day, and
-- the tests that care about opening hours set them explicitly.
-- -----------------------------------------------------------------------------

update public.store_settings
set is_open = true, open_time = '00:00', close_time = '23:59'
where store_id = '00000000-0000-4000-8000-000000000001';
