-- =============================================================================
-- 06 · The database refuses prices and stock that make no sense.
--
-- Migration 20261003000002_db_constraints.sql added these:
--     products_price_paise_gt_zero     price_paise > 0
--     products_mrp_paise_ge_price      mrp_paise is null or mrp_paise >= price_paise
--     products_stock_qty_ge_zero       stock_qty >= 0
--
-- Why they matter to a customer: a price of 0 or negative is not a discount, it
-- is a refund. An MRP below the selling price makes every "X% off" badge in the
-- app lie, because discountPercent() divides the wrong way round. Negative stock
-- means the shop can sell what it does not have.
--
-- These run as the table owner on purpose. Rule 9.1 is that money is never
-- trusted from the client, and a CHECK constraint belongs to the table, not to a
-- role: the last group below proves the shop OWNER cannot get past it either,
-- which is the whole point of putting it in the database rather than in the app.
--
-- Every expectation is pinned to a sqlstate. '23514' is check_violation. Without
-- it a NOT NULL failure would count as "the constraint worked", and the test
-- would be quietly testing the wrong thing.
-- =============================================================================

select test_result.begin_suite('06a products price and stock constraints');

-- -----------------------------------------------------------------------------
-- price_paise must be greater than zero
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a price of 0 paise is rejected',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Free Tomato', 'ಉಚಿತ ಟೊಮೇಟೊ', 0, '500 g')
  $$,
  '23514'
);

select test_result.refused(
  'a negative price is rejected',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Priced At A Loss', 'ಋಣ ಬೆಲೆಯಲ್ಲಿ', -500, '1 kg')
  $$,
  '23514'
);

-- The boundary itself must be allowed: Rs 0.01 is a real price, just a silly one.
select test_result.inserted(
  'a price of exactly 1 paise is allowed',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'One Paisa', 'ಒಂದು ಪೈಸೆ', 1, '1 kg')
  returning id
  $$
);

-- The same constraint on UPDATE, not only INSERT. A product inserted at a valid
-- price must not be walkable to an invalid one afterwards.
select test_result.refused(
  'an existing product cannot be repriced to 0',
  $$
  update public.products set price_paise = 0
    where id = '20000000-0000-4000-8000-000000000003'
  $$,
  '23514'
);

-- -----------------------------------------------------------------------------
-- mrp_paise must be at least price_paise
-- -----------------------------------------------------------------------------

select test_result.refused(
  'an MRP below the selling price is rejected',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Backwards Discount', 'ತಿರುಗಿಯುವ ರಿಯಾಯಿತು', 5000, 4999, '1 kg')
  $$,
  '23514'
);

select test_result.inserted(
  'an MRP equal to the selling price is allowed (no discount, not a bad one)',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'No Discount', 'ಯಾವುದೂ ರಿಯಾಯಿತು ಇಲ್ಲ', 3000, 3000, '1 kg')
  returning id
  $$
);

select test_result.inserted(
  'a NULL MRP is still allowed (a product with no "was" price)',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'No MRP At All', 'ಎಂದಿಗೂ MRP ಇಲ್ಲ', 3000, null, '1 kg')
  returning id
  $$
);

select test_result.refused(
  'lowering the selling price below the MRP is fine, raising it above is not',
  $$
  update public.products set price_paise = 9000
    where id = '20000000-0000-4000-8000-000000000001'   -- seeded at price 1800, mrp 2400
  $$,
  '23514'
);

-- -----------------------------------------------------------------------------
-- stock_qty cannot go negative
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a product cannot be created with negative stock',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, stock_qty, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Imported From Nowhere', 'ಎಲ್ಲಿಂದೋ ಆಮದು', 1000, -5, '1 kg')
  $$,
  '23514'
);

select test_result.refused(
  'an existing product cannot be set to negative stock',
  $$
  update public.products set stock_qty = -1
    where id = '20000000-0000-4000-8000-000000000003'
  $$,
  '23514'
);

select test_result.inserted(
  'zero stock is allowed — that is how "sold out" is spelled',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, stock_qty, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Sold Out', 'ಮುಗಿದಿದೆ', 1000, 0, '1 kg')
  returning id
  $$
);

-- =============================================================================
-- The owner cannot get past them either.
--
-- A CHECK constraint is not a permission. It applies to the shop owner, to a
-- rider who somehow has write access, and to anybody running a migration. If the
-- only thing standing between the catalogue and a negative price were an admin
-- panel's input validation, one bad deploy would put a negative price on the
-- shelf. This group is the reason these tests exist.
-- =============================================================================

select test_result.begin_suite('06b constraints bind the shop owner too');

set role authenticated;
select test_result.sign_in('33333333-3333-3333-3333-333333333333');

select test_result.refused(
  'the shop owner cannot insert a product priced at 0',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Owner Freebie', 'ಮಾಲಿಕರ ಉಚಿತ', 0, '1 kg')
  $$,
  '23514'
);

select test_result.refused(
  'the shop owner cannot insert a product with negative stock',
  $$
  insert into public.products (store_id, category_id, name_en, name_kn, price_paise, stock_qty, unit)
  values ('00000000-0000-4000-8000-000000000001', null,
          'Owner Backorder', 'ಮಾಲಿಕರ ಹಿಂಚಾಲೆ', 1000, -3, '1 kg')
  $$,
  '23514'
);

select test_result.refused(
  'the shop owner cannot set an MRP under the selling price',
  $$
  update public.products set mrp_paise = 100
    where id = '20000000-0000-4000-8000-000000000003'
  $$,
  '23514'
);

reset role;

-- -----------------------------------------------------------------------------
-- And the good rows from above really are in the table, so the "allowed" half of
-- this file is not passing because the INSERT silently did nothing.
-- -----------------------------------------------------------------------------

select test_result.eq(
  'the four deliberately valid products were really created',
  (select count(*) from public.products
     where name_en in ('One Paisa', 'No Discount', 'No MRP At All', 'Sold Out')),
  4
);

select test_result.eq(
  'and none of the invalid ones got in',
  (select count(*) from public.products
     where name_en in ('Free Tomato', 'Priced At A Loss', 'Backwards Discount',
                       'Imported From Nowhere', 'Owner Freebie', 'Owner Backorder')),
  0
);
