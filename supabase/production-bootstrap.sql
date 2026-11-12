-- =============================================================================
-- PRODUCTION BOOTSTRAP — the shop itself, and nothing else
-- =============================================================================
-- Run ONCE against a fresh hosted project, AFTER every migration has applied:
--
--   supabase db push --remote --yes
--   supabase db query --remote --file supabase/production-bootstrap.sql
--
-- NEVER run `seed.sql`, `demo.sql`, `demo-accounts.sql` or `demo-images.sql`
-- against production. Those are development fixtures: fake phone numbers, 34
-- sample products, 25 sample orders and demo logins. This file is the opposite
-- of that — the smallest set of rows the app needs to open its doors, with no
-- invented business facts.
--
-- WHAT THIS CREATES
--   1. One store row, with a WORKING NAME and no phone or street address.
--   2. One store_settings row with the pilot defaults (Rs 100 minimum,
--      Rs 25 delivery, free above Rs 500, 6am-10pm).
--   3. One delivery zone: pincode 572130 (Kunigal), Rs 25, 20 minutes.
--   4. The eight category headings, in English and Kannada, with their emoji.
--
-- WHAT IT DELIBERATELY DOES NOT CREATE
--   * products — the owner adds them from the Shelf tab, in Kannada, at real
--     prices. An empty shelf is honest; a seeded one is a lie about stock.
--   * orders, favourites, coupons, customer or rider accounts.
--   * a phone number, a street address, FSSAI or GST numbers. Those are the
--     owner's to supply (AGENTS.md: never invent a licence number).
--
-- IT IS IDEMPOTENT. Re-running it changes nothing: it never overwrites a shop
-- the owner has renamed, never resets settings, and never duplicates a category.
-- The one thing it will not do is add a SECOND store; if a store already
-- exists, that store is the shop.
-- =============================================================================

-- 1. The shop. `name` is a working name taken from the app's own title; the
--    owner should replace it with the real shop name before launch. `phone`,
--    `address_line` and the identity numbers stay NULL until they are real.
insert into public.stores (name, slug, city, is_active)
select 'Kunigal Grocery', 'kunigal-grocery', 'Kunigal', true
where not exists (select 1 from public.stores);

-- 2. Shop-wide knobs. Rs 100 minimum, Rs 25 delivery, free above Rs 500,
--    open 06:00-22:00. `support_phone` stays NULL: the app shows nothing
--    rather than a number nobody answers.
insert into public.store_settings (
  store_id,
  min_order_value_paise,
  delivery_fee_paise,
  free_delivery_above_paise,
  open_time,
  close_time,
  is_open,
  support_phone
)
select s.id, 10000, 2500, 50000, '06:00', '22:00', true, null
from (select id from public.stores where is_active order by created_at limit 1) s
on conflict (store_id) do nothing;

-- 3. The one pincode we can state without guessing: Kunigal itself (572130).
--    Every other pincode is the owner's decision, because a zone is a promise
--    that a rider will come.
insert into public.delivery_zones (
  store_id,
  pincode,
  area_name_en,
  area_name_kn,
  delivery_fee_paise,
  eta_minutes,
  is_active
)
select s.id, '572130', 'Kunigal', 'ಕುಣಿಗಲ್', 2500, 20, true
from (select id from public.stores where is_active order by created_at limit 1) s
on conflict (store_id, pincode) do nothing;

-- 4. The eight headings a grocery shop is organised by. These are structure,
--    not merchandise, and the Kannada is the voice documented in KUNIGAL.md.
insert into public.categories (store_id, name_en, name_kn, icon, sort_order, is_active)
select s.id, v.name_en, v.name_kn, v.icon, v.sort_order, true
from (select id from public.stores where is_active order by created_at limit 1) s
cross join (values
  ('Fruits & Vegetables',       'ಹಣ್ಣು ಮತ್ತು ತರಕಾರಿ',        '🥬', 1),
  ('Dairy & Milk',              'ಹಾಲು ಮತ್ತು ಡೈರಿ',           '🥛', 2),
  ('Rice, Grains & Pulses',     'ಅಕ್ಕಿ, ಧಾನ್ಯ ಮತ್ತು ಬೇಳೆ',   '🌾', 3),
  ('Cooking Oil & Spices',      'ಎಣ್ಣೆ ಮತ್ತು ಮಸಾಲೆ',         '🫙', 4),
  ('Snacks & Namkeen',          'ತಿಂಡಿ ಮತ್ತು ಖಾರಾ',          '🍪', 5),
  ('Tea, Coffee & Drinks',      'ಟೀ, ಕಾಫಿ ಮತ್ತು ಪಾನೀಯ',      '☕', 6),
  ('Bakery & Breakfast',        'ಬ್ರೆಡ್ ಮತ್ತು ಉಪಾಹಾರ',       '🍞', 7),
  ('Household & Personal Care', 'ಮನೆ ಮತ್ತು ವೈಯಕ್ತಿಕ ಸಾಮಗ್ರಿ', '🧴', 8)
) as v(name_en, name_kn, icon, sort_order)
on conflict (store_id, name_en) do nothing;

-- What the bootstrap left behind, so the run can be read rather than assumed.
select
  (select count(*) from public.stores)         as stores,
  (select count(*) from public.store_settings) as settings,
  (select count(*) from public.delivery_zones) as zones,
  (select count(*) from public.categories)     as categories,
  (select count(*) from public.products)       as products;
