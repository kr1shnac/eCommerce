-- =============================================================================
-- 07 · Bad shop settings and bad pincodes are refused by the database.
--
-- 20261003000002_db_constraints.sql added:
--     store_settings_min_order_ge_zero      min_order_value_paise >= 0
--     store_settings_delivery_fee_ge_zero   delivery_fee_paise >= 0
--     store_settings_free_delivery_ge_zero  free_delivery_above_paise is null or >= 0
--     store_settings.low_stock_threshold    >= 0   (column added by the same migration)
--     delivery_zones_pincode_6_digits       pincode ~ '^[0-9]{6}$'
--     delivery_zones_fee_ge_zero            delivery_fee_paise is null or >= 0
--     delivery_zones_eta_ge_zero            eta_minutes is null or > 0
--
-- The pincode rule is the strictest of the lot and the easiest to get wrong by
-- accident: a pincode is six digits and nothing else. Not five, not seven, not
-- ' 571915' with a leading space, not '571915\n'. A zone row that slips through
-- with a bad pincode is a pincode that silently never matches an address, so the
-- customer is told "we do not deliver to your area" for a street the shop
-- actually delivers to. The check is therefore anchored (^) and closed ($).
--
-- As in 06: every refusal is pinned to sqlstate 23514 (check_violation), and
-- every "this is allowed" case is checked for real with test_result.inserted(),
-- so the file cannot pass by rejecting everything.
-- =============================================================================

select test_result.begin_suite('07a store_settings constraints');

-- -----------------------------------------------------------------------------
-- Money-shaped settings cannot go negative
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a negative minimum order value is rejected',
  $$
  update public.store_settings set min_order_value_paise = -1
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

select test_result.refused(
  'a negative delivery fee is rejected',
  $$
  update public.store_settings set delivery_fee_paise = -2500
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

select test_result.refused(
  'a negative free-delivery threshold is rejected',
  $$
  update public.store_settings set free_delivery_above_paise = -1
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

select test_result.refused(
  'a negative low-stock threshold is rejected',
  $$
  update public.store_settings set low_stock_threshold = -1
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

-- A zero fee and a zero minimum are legitimate: "free delivery" and "no minimum"
-- are things a shop can genuinely choose.
select test_result.inserted(
  'a zero delivery fee is allowed',
  $$
  update public.store_settings set delivery_fee_paise = 0
    where store_id = '00000000-0000-4000-8000-000000000001'
  returning id
  $$
);

select test_result.inserted(
  'a zero minimum order value is allowed',
  $$
  update public.store_settings set min_order_value_paise = 0
    where store_id = '00000000-0000-4000-8000-000000000001'
  returning id
  $$
);

select test_result.inserted(
  'a NULL free-delivery threshold is allowed (never free)',
  $$
  update public.store_settings set free_delivery_above_paise = null
    where store_id = '00000000-0000-4000-8000-000000000001'
  returning id
  $$
);

-- The constraint that was already here before 20261003000002: the shop cannot
-- close at 6am and open at 10pm.
select test_result.refused(
  'opening hours that run backwards are rejected',
  $$
  update public.store_settings set open_time = '22:00', close_time = '06:00'
    where store_id = '00000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

select test_result.eq(
  'and opening hours were left alone by the attempt',
  (select to_char(open_time, 'HH24:MI') || '-' || to_char(close_time, 'HH24:MI')
     from public.store_settings
     where store_id = '00000000-0000-4000-8000-000000000001'),
  '00:00-23:59'
);

-- Put the seeded values back; later files assume them.
update public.store_settings
set min_order_value_paise     = 10000,
    delivery_fee_paise        = 2500,
    free_delivery_above_paise = 50000,
    is_open                   = true,
    open_time                 = '00:00',
    close_time                = '23:59'
where store_id = '00000000-0000-4000-8000-000000000001';

-- =============================================================================
-- Pincodes
-- =============================================================================

select test_result.begin_suite('07b delivery zone pincode and fee constraints');

-- Too short.
select test_result.refused(
  'a five digit pincode is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '57191', 'Too Short', 'ಬಹಳ ಕಡಿಮೆ', 1500)
  $$,
  '23514'
);

-- Too long. Without the trailing $ this would pass and then never match.
select test_result.refused(
  'a seven digit pincode is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '5719155', 'Too Long', 'ಬಹಳ ಉದ್ದ', 1500)
  $$,
  '23514'
);

select test_result.refused(
  'a pincode that is not digits at all is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', 'abcdef', 'Not A Pincode', 'ಪಿನ್ ಕೋಡ್ ಅಲ್ಲ', 1500)
  $$,
  '23514'
);

-- The anchored ^ matters here. Without it this six-digit-plus-space pincode
-- would sail through and quietly never match an address.
select test_result.refused(
  'a pincode with a leading space is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', ' 571916', 'Leading Space', 'ಮುಂದ ಜಾಗ', 1500)
  $$,
  '23514'
);

select test_result.refused(
  'a pincode with a trailing space is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '571917 ', 'Trailing Space', 'ಹಿಂದ ಜಾಗ', 1500)
  $$,
  '23514'
);

select test_result.refused(
  'an empty pincode is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '', 'Empty', 'ಖಾಲಿ', 1500)
  $$,
  '23514'
);

-- The good case, so the pincode rule above is not passing because everything is
-- rejected. 573001 is the same pincode the refused inserts in 05 tried to add,
-- so this also proves that one really was the database's idea and not a typo.
select test_result.inserted(
  'a plain six digit pincode is allowed',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise, eta_minutes)
  values ('00000000-0000-4000-8000-000000000001', '573001', 'Test Area', 'ಟೆಸ್ಟ್ ಪ್ರದೇಶ', 1500, 25)
  returning id
  $$
);

-- Fees and ETAs on the same table.
select test_result.refused(
  'a negative zone delivery fee is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '573002', 'Negative Fee', 'ಋಣ ಶುಲ್ಕ', -1)
  $$,
  '23514'
);

select test_result.inserted(
  'a NULL zone delivery fee is allowed — it means "use the shop default"',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise)
  values ('00000000-0000-4000-8000-000000000001', '573003', 'Shop Default Fee', 'ಅಂಗಡಿ ಶುಲ್ಕ', null)
  returning id
  $$
);

select test_result.refused(
  'an ETA of zero minutes is rejected — a zone cannot be both served and instant',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise, eta_minutes)
  values ('00000000-0000-4000-8000-000000000001', '573004', 'Instant', 'ತಕ್ಷಣ', 1500, 0)
  $$,
  '23514'
);

select test_result.refused(
  'a negative ETA is rejected',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise, eta_minutes)
  values ('00000000-0000-4000-8000-000000000001', '573005', 'Backwards Time', 'ಹಿಂದ ಸಮಯ', 1500, -10)
  $$,
  '23514'
);

select test_result.inserted(
  'a NULL ETA is allowed — some zones simply have no promise yet',
  $$
  insert into public.delivery_zones (store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise, eta_minutes)
  values ('00000000-0000-4000-8000-000000000001', '573006', 'No Promise', 'ಭರವಸೆ ಇಲ್ಲ', 1500, null)
  returning id
  $$
);

-- Updating a pincode into a bad shape must fail too, not just inserting one.
select test_result.refused(
  'an existing zone cannot be edited into a five digit pincode',
  $$
  update public.delivery_zones set pincode = '57191'
    where id = '30000000-0000-4000-8000-000000000001'
  $$,
  '23514'
);

select test_result.eq(
  'and that zone kept its real pincode',
  (select pincode from public.delivery_zones where id = '30000000-0000-4000-8000-000000000001'),
  '571915'
);

-- -----------------------------------------------------------------------------
-- Clean up after ourselves and prove the refusals left nothing behind.
-- -----------------------------------------------------------------------------

delete from public.delivery_zones where pincode in ('573001','573003','573006');

select test_result.eq(
  'exactly the four seeded zones are left, and none of the test ones',
  (select count(*) from public.delivery_zones where store_id = '00000000-0000-4000-8000-000000000001'),
  4
);

select test_result.eq(
  'and not one malformed pincode got stored',
  (select count(*) from public.delivery_zones where pincode !~ '^[0-9]{6}$'),
  0
);
