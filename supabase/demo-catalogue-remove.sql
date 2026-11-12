-- =============================================================================
-- Remove the demo catalogue
-- =============================================================================
-- The exact rows `demo-catalogue.sql` created, and NOTHING else.
--
-- The ids are deterministic, so this cannot delete a product the owner added by
-- hand from the Shelf tab — a real product gets a `gen_random_uuid()`, and no
-- uuid the shop generates will ever collide with one of these.
--
-- Run with:
--   supabase db query --remote --file supabase/demo-catalogue-remove.sql --yes
--
-- Safe to run twice: `where id in (...)` matches nothing the second time, and
-- `order_items` has `on delete cascade`, so no orphan line items can survive.
-- =============================================================================

delete from public.products
 where id in (
   '91000000-0000-4000-8000-00000000d1c1',
   '91000000-0000-4000-8000-00000000d1c2',
   '91000000-0000-4000-8000-00000000d1c3',
   '91000000-0000-4000-8000-00000000d1c4',
   '91000000-0000-4000-8000-00000000d1c5',
   '91000000-0000-4000-8000-00000000d1c6'
 );

-- What is left, so "is it clean?" has a one-line answer.
select count(*) as products_remaining from public.products;
