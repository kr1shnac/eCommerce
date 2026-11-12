-- =============================================================================
-- 34 · The shop's own door: open or closed, from the owner's phone
-- =============================================================================
-- `store_settings.is_open` has existed since migration 05, and `place_order()`
-- has refused a closed shop since migration 08 ("store_closed"). But nothing in
-- the app could WRITE it: the only doors were the web panel (a desk tool) and
-- raw SQL. The owner runs the shop standing up, and "we are closed" is the most
-- time-critical thing they ever say — a customer who orders into a closed shop
-- gets a failed delivery and a refund, which is worse than a closed sign.
--
-- WHY AN RPC AND NOT A PLAIN UPDATE
--
-- Same reason as `update_product_from_shop()`: a non-admin's direct UPDATE is
-- filtered by RLS to ZERO rows and raises NOTHING. A button built on it would
-- report "Shop closed" while the shop stayed open. This function raises 42501
-- instead, and returns the row as the database now holds it, so the screen can
-- show the stored truth rather than the intended one.
--
-- NOT `security definer`: it must run as the caller, so RLS remains the thing
-- that decides whether the row may be written. The explicit `is_admin()` check
-- is there to turn a silent no-op into an error, not to replace RLS.
-- =============================================================================

create or replace function public.set_shop_open(p_is_open boolean)
returns public.store_settings
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_settings public.store_settings;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can open or close it.'
      using errcode = '42501';
  end if;

  -- A boolean with no value is a client bug, not a request to toggle. Refuse it
  -- rather than reading NULL as false and silently closing the shop.
  if p_is_open is null then
    raise exception 'Say whether the shop is open: true or false.'
      using errcode = '22004';
  end if;

  -- The active shop, picked server-side. The client never names a store, so it
  -- cannot close somebody else's.
  update public.store_settings s
     set is_open = p_is_open
   where s.store_id = (
           select st.id
             from public.stores st
            where st.is_active
            order by st.created_at
            limit 1
         )
  returning * into v_settings;

  if not found then
    raise exception 'This shop has no settings row yet.'
      using errcode = 'P0002';
  end if;

  return v_settings;
end;
$$;

comment on function public.set_shop_open(boolean) is
  'Opens or closes the active shop. Returns the stored settings row. Refuses a '
  'non-admin with 42501 instead of a silent no-op, and refuses NULL with 22004.';

revoke all on function public.set_shop_open(boolean) from public, anon;
grant execute on function public.set_shop_open(boolean) to authenticated;
