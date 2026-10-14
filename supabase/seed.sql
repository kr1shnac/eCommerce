-- =============================================================================
-- Seed data — one shop, 8 categories, 34 products (English + Kannada)
-- =============================================================================
-- HOW TO RUN
--   Option A (easiest): Supabase dashboard -> SQL Editor -> New query ->
--                       paste this whole file -> Run.
--   Option B:          supabase db reset      (local Supabase)
--                       supabase db push       (hosted project)
--
-- This file is safe to run more than once: every row has a fixed id and uses
-- ON CONFLICT DO UPDATE.
--
-- PRICE RULE: every *_paise value below is an integer. 1800 means Rs 18.00.
--
-- PICTURES: image_url is deliberately NULL — this shop has no product photos.
-- Instead every product carries an `emoji`, which the app draws on the tile.
-- That is not a stopgap, it is a design decision: one in three adults in
-- Kunigal cannot comfortably read a product name, so a tomato has to look like
-- a tomato (see DESIGN.md, KUNIGAL.md §2). The category's own `icon` is the
-- final fallback. Later, upload real photos to a Storage bucket and paste the
-- public URL into image_url; a real photo always wins over the emoji.
--
-- KANNADA: these names are the shop's own words, not a dictionary translation.
-- "ಟೊಮೆಟೊ", "ಟೀ ಪುಡಿ", "ಮೊಸರು" — the words a Kunigal shopkeeper says out loud.

-- -----------------------------------------------------------------------------
-- The shop
-- -----------------------------------------------------------------------------
insert into public.stores (id, name, slug, phone, address_line, city, is_active)
values (
  '00000000-0000-4000-8000-000000000001',
  'Kunigal Fresh Mart',
  'kunigal-fresh-mart',
  '+919845612345',
  'Main Road, near Bus Stand',
  'Kunigal',
  true
)
on conflict (id) do update set
  name         = excluded.name,
  phone        = excluded.phone,
  address_line = excluded.address_line,
  city         = excluded.city;

-- -----------------------------------------------------------------------------
-- Shop settings: min order Rs 100, delivery fee Rs 25, free above Rs 500,
-- open 6am to 10pm.
-- -----------------------------------------------------------------------------
insert into public.store_settings (
  id,
  store_id,
  min_order_value_paise,
  delivery_fee_paise,
  free_delivery_above_paise,
  open_time,
  close_time,
  is_open,
  support_phone
)
values (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  10000,
  2500,
  50000,
  '06:00',
  '22:00',
  true,
  '+919845612345'
)
on conflict (id) do update set
  min_order_value_paise     = excluded.min_order_value_paise,
  delivery_fee_paise        = excluded.delivery_fee_paise,
  free_delivery_above_paise = excluded.free_delivery_above_paise,
  open_time                 = excluded.open_time,
  close_time                = excluded.close_time,
  is_open                   = excluded.is_open;

-- -----------------------------------------------------------------------------
-- Delivery zones
--
-- 572130 is Kunigal's REAL postcode (KUNIGAL.md §1) and is the zone the town
-- itself falls in. The other three are example zones so the checkout has more
-- than one fee to show; replace them with the pincodes you actually serve.
-- -----------------------------------------------------------------------------
insert into public.delivery_zones (
  id, store_id, pincode, area_name_en, area_name_kn, delivery_fee_paise, eta_minutes, is_active
)
values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '572130',
   'Kunigal Town', 'ಕುಣಿಗಲ್ ಪಟ್ಟಣ', 1500, 10, true),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '571916',
   'Kunigal East', 'ಕುಣಿಗಲ್ ಪೂರ್ವ', 2500, 20, true),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '571917',
   'Kunigal West', 'ಕುಣಿಗಲ್ ಪಶ್ಚಿಮ', 2500, 20, true),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '572111',
   'Huliyurdurga Road', 'ಹುಲಿಯೂರುದುರ್ಗ ರಸ್ತೆ', 3500, 30, true)
on conflict (id) do update set
  pincode            = excluded.pincode,
  area_name_en       = excluded.area_name_en,
  area_name_kn       = excluded.area_name_kn,
  delivery_fee_paise = excluded.delivery_fee_paise,
  eta_minutes        = excluded.eta_minutes,
  is_active          = excluded.is_active;

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
insert into public.categories (id, store_id, name_en, name_kn, icon, sort_order, is_active)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'Fruits & Vegetables', 'ಹಣ್ಣು ಮತ್ತು ತರಕಾರಿ', '🥬', 1, true),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
   'Dairy & Milk', 'ಹಾಲು ಮತ್ತು ಡೈರಿ', '🥛', 2, true),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
   'Rice, Grains & Pulses', 'ಅಕ್ಕಿ, ಧಾನ್ಯ ಮತ್ತು ಬೇಳೆ', '🌾', 3, true),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001',
   'Cooking Oil & Spices', 'ಎಣ್ಣೆ ಮತ್ತು ಮಸಾಲೆ', '🫙', 4, true),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001',
   'Snacks & Namkeen', 'ತಿಂಡಿ ಮತ್ತು ಖಾರಾ', '🍪', 5, true),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001',
   'Tea, Coffee & Drinks', 'ಟೀ, ಕಾಫಿ ಮತ್ತು ಪಾನೀಯ', '☕', 6, true),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001',
   'Bakery & Breakfast', 'ಬ್ರೆಡ್ ಮತ್ತು ಉಪಾಹಾರ', '🍞', 7, true),
  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001',
   'Household & Personal Care', 'ಮನೆ ಮತ್ತು ವೈಯಕ್ತಿಕ ಸಾಮಗ್ರಿ', '🧴', 8, true)
on conflict (id) do update set
  name_en    = excluded.name_en,
  name_kn    = excluded.name_kn,
  icon       = excluded.icon,
  sort_order = excluded.sort_order,
  is_active  = excluded.is_active;

-- -----------------------------------------------------------------------------
-- Products:  name_en | name_kn | unit | price_paise | mrp_paise | stock_qty | emoji
-- -----------------------------------------------------------------------------

-- Fruits & Vegetables -------------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Tomato', 'ಟೊಮೆಟೊ', 1800, 2400, '500 g', 40, '🍅', 1),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Onion', 'ಈರುಳ್ಳಿ', 2600, 3200, '1 kg', 60, '🧅', 2),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Potato', 'ಆಲೂಗಡ್ಡೆ', 2200, 2800, '1 kg', 55, '🥔', 3),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Banana', 'ಬಾಳೆಹಣ್ಣು', 2400, 3000, '500 g', 25, '🍌', 4),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Green Chilli', 'ಹಸಿಮೆಣಸಿನಕಾಯಿ', 900, 1200, '100 g', 30, '🌶️', 5)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Dairy & Milk --------------------------------------------------------------
-- Paneer is seeded with stock 0 on purpose, so you can see the "Out of stock"
-- state on the Home screen.
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   'Full Cream Milk', 'ಪೂರ್ಣ ಕ್ರೀಮ್ ಹಾಲು', 2700, 3000, '500 ml', 48, '🥛', 1),
  ('20000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   'Curd', 'ಮೊಸರು', 2200, 2600, '400 g', 20, '🍶', 2),
  ('20000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   'Paneer', 'ಪನೀರ್', 8000, 8500, '200 g', 0, '🧀', 3),
  ('20000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   'Butter', 'ಬೆಣ್ಣೆ', 5400, 5800, '500 g', 12, '🧈', 4)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Rice, Grains & Pulses ----------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
   'Sona Masoori Rice', 'ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ', 6500, 7500, '5 kg', 35, '🌾', 1),
  ('20000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
   'Basmati Rice', 'ಬಾಸ್ಮತಿ ಅಕ್ಕಿ', 9500, 12000, '1 kg', 22, '🍚', 2),
  ('20000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
   'Wheat Flour', 'ಗೋಧಿ ಹಿಟ್ಟು', 3200, 3600, '5 kg', 30, '🌾', 3),
  ('20000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
   'Toor Dal', 'ತೊಗರಿ ಬೇಳೆ', 13500, 15000, '1 kg', 18, '🫘', 4),
  ('20000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003',
   'Sugar', 'ಸಕ್ಕರೆ', 4500, 4800, '1 kg', 40, '🍬', 5)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Cooking Oil & Spices ------------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004',
   'Sunflower Oil', 'ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ', 14500, 16000, '1 L', 26, '🌻', 1),
  ('20000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004',
   'Mustard Oil', 'ಸಾಸಿವೆ ಎಣ್ಣೆ', 17500, 19000, '1 L', 14, '🫙', 2),
  ('20000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004',
   'Turmeric Powder', 'ಅರಿಶಿನ ಪುಡಿ', 2600, 3000, '200 g', 32, '🟡', 3),
  ('20000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004',
   'Chilli Powder', 'ಮೆಣಸಿನ ಪುಡಿ', 3000, 3400, '200 g', 28, '🌶️', 4),
  ('20000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004',
   'Iodised Salt', 'ಅಯೊಡೀನ್ ಉಪ್ಪು', 1400, 1700, '1 kg', 45, '🧂', 5)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Snacks & Namkeen ---------------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
   'Potato Chips', 'ಆಲೂಗಡ್ಡೆ ಚಿಪ್ಸ್', 2000, null, '52 g', 60, '🍟', 1),
  ('20000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
   'Mixture Namkeen', 'ಮಿಶ್ರಣ ನಮ್ಕೀನ್', 3000, 3500, '200 g', 35, '🥜', 2),
  ('20000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
   'Biscuits', 'ಬಿಸ್ಕತ್ತು', 1500, 1700, '250 g', 50, '🍪', 3),
  ('20000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005',
   'Roasted Peanuts', 'ಹುರಿದ ಕಡಲೆಕಾಯಿ', 3200, 3600, '500 g', 24, '🥜', 4)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Tea, Coffee & Drinks ------------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006',
   'Tea Powder', 'ಟೀ ಪುಡಿ', 2600, 2900, '250 g', 40, '🍵', 1),
  ('20000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006',
   'Coffee Powder', 'ಕಾಫಿ ಪುಡಿ', 4500, 5200, '500 g', 16, '☕', 2),
  ('20000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006',
   'Soft Drink', 'ಕೂಲ್ ಡ್ರಿಂಕ್', 2000, null, '750 ml', 36, '🥤', 3),
  ('20000000-0000-4000-8000-000000000027', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006',
   'Drinking Chocolate', 'ಡ್ರಿಂಕಿಂಗ್ ಚಾಕೊಲೇಟ್', 1800, 2000, '200 ml', 30, '🍫', 4)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Bakery & Breakfast -------------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000028', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007',
   'Wheat Bread', 'ಗೋಧಿ ಬ್ರೆಡ್', 2800, 3200, '400 g', 20, '🍞', 1),
  ('20000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007',
   'Rusk', 'ರಸ್ಕ್', 1500, 1700, '300 g', 22, '🥖', 2),
  ('20000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007',
   'Cream Crackers', 'ಕ್ರೀಮ್ ಕ್ರ್ಯಾಕರ್ಸ್', 1600, 1800, '200 g', 26, '🍘', 3)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- Household & Personal Care -------------------------------------------------
insert into public.products
  (id, store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit, stock_qty, emoji, sort_order)
values
  ('20000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008',
   'Dishwash Bar', 'ಪಾತ್ರೆ ತೊಳೆಯುವ ಸಾಬೂನು', 1500, 1700, '200 g', 34, '🧼', 1),
  ('20000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008',
   'Detergent Powder', 'ಡಿಟರ್ಜೆಂಟ್ ಪುಡಿ', 2600, 2900, '1 kg', 27, '🧴', 2),
  ('20000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008',
   'Bathing Soap', 'ಸ್ನಾನದ ಸಾಬೂನು', 2400, 2700, '4 x 100 g', 30, '🧼', 3),
  ('20000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000008',
   'Toothpaste', 'ಟೂತ್‌ಪೇಸ್ಟ್', 1900, 2100, '200 g', 38, '🪥', 4)
on conflict (id) do update set
  name_en     = excluded.name_en,
  name_kn     = excluded.name_kn,
  price_paise = excluded.price_paise,
  mrp_paise   = excluded.mrp_paise,
  unit        = excluded.unit,
  stock_qty   = excluded.stock_qty,
  emoji       = excluded.emoji,
  sort_order  = excluded.sort_order;

-- =============================================================================
-- Making yourself an admin (do this once, from the SQL Editor)
-- -----------------------------------------------------------------------------
-- 1. Sign up in the mobile app (or Supabase dashboard -> Authentication -> Users).
-- 2. Copy that user's UUID.
-- 3. Run:
--
--      update public.profiles set role = 'admin' where id = '<paste-uuid-here>';
--
-- The profiles_guard_role trigger allows this because the SQL Editor has no
-- signed-in user, while still blocking the same trick from inside the app.
-- =============================================================================
