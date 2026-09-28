-- =============================================================================
-- 17 · Shop identity and statutory display
--
-- WHY THIS EXISTS
--
-- An FSSAI licence number must be displayed — including on the e-commerce
-- transaction document — by anyone selling food online in India, and a Legal
-- Metrology declaration (the manufacturer/packer, the quantity, the price) is
-- required on packaged commodities. Until this migration the shop had nowhere to
-- record any of it, so there was nothing to display (register H6/H7).
--
-- WHAT THIS DOES AND DOES NOT DO
--
-- It adds the FIELDS, and the constraints that stop them being nonsense. It does
-- NOT invent a licence number: every column is nullable, and the app shows a
-- row only when it is filled in. A placeholder FSSAI number in a shipped app is
-- worse than an absent one — it is a false statutory claim, visible to a
-- customer, on a screen that says "this is who we are".
--
-- The accountant decides the actual numbers (PRODUCTION.md §14). This migration
-- gives the shop a place to put them and the app a place to read them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stores: who the shop is, in law
-- -----------------------------------------------------------------------------

alter table public.stores
  add column if not exists fssai_number text
    check (fssai_number is null or fssai_number ~ '^[0-9]{14}$');

alter table public.stores
  add column if not exists gstin text
    check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$');

-- Where a customer's complaint reaches a human, as opposed to the shop's phone
-- which is answered while the shop is open. Often the same number.
alter table public.stores
  add column if not exists grievance_phone text;

comment on column public.stores.fssai_number is
  '14-digit FSSAI licence number. Null until the shop gives us the real one; never a placeholder.';
comment on column public.stores.gstin is
  '15-character GSTIN, when the shop is registered. Null for a composition/nil dealer.';
comment on column public.stores.grievance_phone is
  'Where a customer complaint reaches a person. Defaults to the shop phone when null.';

-- -----------------------------------------------------------------------------
-- The Legal Metrology declaration, per product
-- -----------------------------------------------------------------------------
-- Rule 6 of the Legal Metrology (Packaged Commodities) Rules requires the name
-- and address of the manufacturer/packer/importer on a packaged commodity. For a
-- single-shop grocery the packer is nearly always the shop itself, so the
-- sensible default is "the shop", with a per-product override for the goods the
-- shop merely resells.
--
-- `net_quantity` is a free-text declaration ("1 kg", "500 g") because that is
-- what the package literally says, and the unit column on products is the app's
-- own vocabulary, which is narrower.
alter table public.products
  add column if not exists packer_name text;

alter table public.products
  add column if not exists net_quantity text;

comment on column public.products.packer_name is
  'Who packed this. Null means the shop itself (the common case for loose goods).';
comment on column public.products.net_quantity is
  'The declaration as printed on the pack, e.g. "1 kg". Null means fall back to unit.';

-- -----------------------------------------------------------------------------
-- RLS: these are public facts about the shop, like its phone number
-- -----------------------------------------------------------------------------
-- No new policies. `stores` is already readable by anon (the app shows the name
-- and phone), and `products` is already readable for active rows. Adding columns
-- does not widen any policy: RLS is per-row, and both tables keep the policies
-- they had. Nothing here is customer personal data.

-- -----------------------------------------------------------------------------
-- store_settings: the transaction document footer
-- -----------------------------------------------------------------------------
-- The cash memo is the "e-commerce transaction document" the FSSAI and GST
-- rules talk about. Its wording is shop-specific, so it is data, not code.
alter table public.store_settings
  add column if not exists receipt_footer text;

comment on column public.store_settings.receipt_footer is
  'The line printed at the bottom of a cash memo. Null means the app prints its own.';
