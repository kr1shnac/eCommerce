-- =============================================================================
-- 20261113000004 · The door-pin gate ships ON
-- =============================================================================
-- Owner directive (2026-11-13): "Make the address-pin gate default ON
-- (auto-active when the shop pin is set; owner can disable consciously)."
--
-- WHY A DEFAULT, NOT A SECOND RULE
-- --------------------------------
-- The gate itself already lives in `place_order()` (migration
-- 20261113000002): it refuses a pinless address only when the shop has a
-- usable pin of its own, so a shop that has not stood in its doorway yet is
-- never locked out. What changes here is only the SWITCH: the column now
-- defaults to true, and the existing row is turned on, because a pilot whose
-- first hundred orders arrive without a pin teaches the riders nothing.
--
-- The owner can still turn it off - `update_delivery_settings(
-- p_address_pin_required => false)` - and that choice is stored. This
-- migration re-enables it once, for the shop as it stands today (one row,
-- never toggled); it never runs again.
--
-- The gate still WAITS for the shop's own pin. Until the owner stands in the
-- doorway and taps "Use my current location", this switch changes nothing a
-- customer sees - which is exactly why turning it on now is safe.
-- =============================================================================

alter table public.store_settings
  alter column address_pin_required set default true;

update public.store_settings
   set address_pin_required = true
 where address_pin_required = false;

comment on column public.store_settings.address_pin_required is
  'When true (the default), place_order() refuses a pinless address while the '
  'shop has a usable pin of its own. The owner may switch it off consciously; '
  'a shop without its own pin is never gated.';
