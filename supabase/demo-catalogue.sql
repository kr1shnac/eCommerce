-- =============================================================================
-- DEMO CATALOGUE — a handful of products so the app can be looked at on a phone
-- =============================================================================
-- ⚠️  THIS IS TEST DATA. IT IS NOT THE SHOP'S SHELF.  ⚠️
--
-- WHY IT EXISTS
--
-- `AGENTS.md` says production is bootstrapped with `production-bootstrap.sql`
-- and never seeded, because an empty shelf is honest and a seeded one is a lie
-- about stock. That is still true — this file is deliberately a SEPARATE,
-- clearly-named, one-command-reversible exception, created because the next
-- milestone is a device run (register C4) and every screen in the app — the
-- shelf, the product page, the cart, checkout, the offers rail, the ETA — is
-- empty and unrenderable without it.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   * no invented FSSAI / GST / packer / net-ququantity (migration
--     `20261020000002`: an absent number shows nothing; a fake one is a false
--     statutory claim);
--   * no `image_url` — photos are the owner's, and a placeholder image would
--     look like a real product photo;
--   * no touch on `products.price_paise` for any real product, because these
--     IDs are unique and the delete is `where id in (...)`, exact.
--
-- HOW TO REMOVE IT IN ONE COMMAND
--
--   supabase db query --remote --file supabase/demo-catalogue-remove.sql --yes
--
-- Every row uses a DETERMINISTIC uuid (the same convention as `seed.sql`), so
-- the removal does not have to guess and cannot delete a real product.
--
-- IDEMPOTENT: safe to run twice — `on conflict (id) do update` rewrites the
-- same rows, it never duplicates.
--
-- The Kannada wording follows the voice in `KUNIGAL.md`; the English is the
-- shop's own plain register, not marketing copy.
-- =============================================================================

-- The six IDs this file owns. Anything else in `products` is real.
--   91000000-0000-4000-8000-00000000d1c1  Tomato          1 kg
--   91000000-0000-4000-8000-00000000d1c2  Milk            500 ml
--   91000000-0000-4000-8000-00000000d1c3  Toor dal        1 kg
--   91000000-0000-4000-8000-00000000d1c4  Sunflower oil   1 L
--   91000000-0000-4000-8000-00000000d1c5  Banana          1 dozen
--   91000000-0000-4000-8000-00000000d1c6  Crowd chilli powder 200 g

insert into public.products (
  id, store_id, category_id,
  name_en, name_kn,
  price_paise, mrp_paise, unit,
  stock_qty, sort_order, is_active,
  sold_by, pack_size, pack_unit
)
select
  v.id::uuid,
  s.id,
  c.id,
  v.name_en,
  v.name_kn,
  v.price_paise,
  v.mrp_paise,
  v.unit,
  v.stock_qty,
  v.sort_order,
  true,
  v.sold_by::public.product_sold_by,
  v.pack_size::numeric,
  v.pack_unit::public.pack_unit
from (select id from public.stores where is_active order by created_at limit 1) s
cross join (values
  -- ── Fruits & Vegetables ────────────────────────────────────────────────────
  ('91000000-0000-4000-8000-00000000d1c1', 'f3d97059-1cb2-4258-834e-51986b1ee8ae',
   'Tomato', 'ಟೊಮೆಟೊ', 4000, 5000, 'kg', 40, 1,
   'measure', 1, 'kg'),

  -- `piece`, not a measure: the pack_unit enum has no "dozen", and a banana is
  -- bought by the dozen, not by weight. The unit stays free text ('dozen').
  ('91000000-0000-4000-8000-00000000d1c5', 'f3d97059-1cb2-4258-834e-51986b1ee8ae',
   'Banana', 'ಬಾಳೆಹಣ್ಣು', 4800, null, 'dozen', 25, 2,
   'piece', null, null),

  -- ── Dairy & Milk ───────────────────────────────────────────────────────────
  ('91000000-0000-4000-8000-00000000d1c2', '8c92e0c6-ff4f-4566-8f8c-9976b6f6945c',
   'Milk', 'ಹಾಲು', 2600, 2800, '500 ml packet', 60, 1,
   'measure', 500, 'ml'),

  -- ── Rice, Grains & Pulses ──────────────────────────────────────────────────
  ('91000000-0000-4000-8000-00000000d1c3', 'f0313ba5-996d-42ef-90c9-47d23354a35d',
   'Toor dal', 'ತೊಗರಿ ಬೇಳೆ', 13500, 15000, 'kg', 30, 1,
   'measure', 1, 'kg'),

  -- ── Cooking Oil & Spices ───────────────────────────────────────────────────
  ('91000000-0000-4000-8000-00000000d1c4', 'f93f457a-0b08-49cc-9bea-6cd2289bbd15',
   'Sunflower oil', 'ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ', 14500, 16000, 'litre', 20, 1,
   'measure', 1, 'l'),

  ('91000000-0000-4000-8000-00000000d1c6', 'f93f457a-0b08-49cc-9bea-6cd2289bbd15',
   'Chilli powder', 'ಖಾರದ ಪುಡಿ', 9000, null, '200 g packet', 35, 2,
   'measure', 200, 'g')
) as v(id, category_id, name_en, name_kn, price_paise, mrp_paise, unit,
      stock_qty, sort_order, sold_by, pack_size, pack_unit)
join public.categories c on c.id = v.category_id::uuid
on conflict (id) do update set
  store_id      = excluded.store_id,
  category_id   = excluded.category_id,
  name_en       = excluded.name_en,
  name_kn       = excluded.name_kn,
  price_paise   = excluded.price_paise,
  mrp_paise     = excluded.mrp_paise,
  unit          = excluded.unit,
  stock_qty     = excluded.stock_qty,
  sort_order    = excluded.sort_order,
  is_active     = true,
  sold_by       = excluded.sold_by,
  pack_size     = excluded.pack_size,
  pack_unit     = excluded.pack_unit;

-- Read back what landed, so the run can be checked rather than assumed.
select p.name_en,
       p.name_kn,
       p.price_paise,
       p.stock_qty,
       c.name_en as category
  from public.products p
  join public.categories c on c.id = p.category_id
 where p.id in (
   '91000000-0000-4000-8000-00000000d1c1',
   '91000000-0000-4000-8000-00000000d1c2',
   '91000000-0000-4000-8000-00000000d1c3',
   '91000000-0000-4000-8000-00000000d1c4',
   '91000000-0000-4000-8000-00000000d1c5',
   '91000000-0000-4000-8000-00000000d1c6'
 )
 order by c.sort_order, p.sort_order;
