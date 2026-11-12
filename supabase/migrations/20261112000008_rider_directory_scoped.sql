-- =============================================================================
-- 40 · The rider directory is per-order, not everybody's phone book
-- =============================================================================
-- THE BUG
-- -------
-- `rider_directory` (migration 20261021000001) was built to answer one question:
-- may a customer read the NAME, PHOTO and PHONE of the rider carrying their bag?
-- It answered it by exposing the four safe columns of every rider, to every
-- signed-in user:
--
--   create view public.rider_directory with (security_invoker = false) as
--     select id, full_name, avatar_url, phone from public.profiles
--      where p.role = 'delivery';
--
--   grant select on public.rider_directory to authenticated;
--
-- A definer-side view bypasses RLS on `profiles`, and the only filter was the
-- role. So ANY signed-in customer — someone who has never placed an order — can
-- run `select * from rider_directory` and receive every rider's real name, real
-- photograph and real phone number. That is a directory of the shop's staff,
-- handed to the public. A rider's phone number is not shop data: it is the
-- number a customer can call at 9 pm to ask where the bag is, and the number a
-- stranger can call for any other reason.
--
-- The app never asked for more than one rider at a time — `useRider(riderId)`
-- selects the view filtered `.eq('id', riderId)` — so the leak is invisible in
-- normal use and total in practice. This is the failure mode RLS exists for:
-- the surface exposed is wider than the surface needed.
--
-- THE FIX
-- --------
-- Same shape, narrower contents: the view now returns a rider ONLY when that
-- rider is the ASSIGNED rider on an order the caller may see — their own order,
-- or any order for a shop owner (`is_admin()`, which is how the owner's board
-- reads the rider card). A rider with no order the caller can see returns no
-- row at all, rather than a row the caller must not have.
--
-- Why `security_invoker = false` stays: with it true, RLS on `profiles` applies
-- and the customer gets nothing back, which is how `rider_directory` came to be
-- definer-side in the first place. The permission now lives in the view's own
-- WHERE clause, evaluated per request — the same mechanism
-- `order_rider_position` (migration 20261026000001) already proves works, where
-- `auth.uid()` inside a definer-side view correctly filters to the caller.
--
-- Why `exists` and not a `join`: a join would return one row per matching
-- ORDER, so a customer who ordered twice from the same rider would get two
-- identical rows and `maybeSingle()` — which the order screen uses — would fail
-- on a repeat customer. `exists` returns exactly one row per rider.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
-- --------------------------------------
--   * The four columns. `id, full_name, avatar_url, phone` — nothing else, so a
--     rider's rate, shift or address is still unreachable.
--   * The grants. Still `authenticated` only, never `anon`.
--   * The app. `useRider()` already asks for one rider by id; the order screen
--     keeps working with no TypeScript change.
--   * Riders reading their own card: nobody ever needed it, and it stays out.
--
-- Rule 9.7: `supabase/tests/40_rider_directory_scope_test.sql` proves the
-- forbidden case — a customer reading a rider who is not on their order —
-- returns nothing.
-- =============================================================================

create or replace view public.rider_directory
with (security_invoker = false)
as
select
  p.id,
  p.full_name,
  p.avatar_url,
  p.phone
from public.profiles p
where p.role = 'delivery'
  -- The caller may see this rider only through an order they may see. Their own
  -- order, or the shop owner's board. `exists`, not a join: one row per rider,
  -- never one row per order, so a repeat customer cannot break `maybeSingle()`.
  and exists (
    select 1
      from public.orders o
     where o.assigned_to = p.id
       and (o.user_id = auth.uid() or public.is_admin())
  );

comment on view public.rider_directory is
  'Name, photo and phone of ONE rider: the rider assigned to an order the caller '
  'may see. Not a directory of the shop''s staff — a rider with no order the '
  'caller can see returns no row. Read-only, four columns, authenticated only.';

revoke all on public.rider_directory from public, anon;
grant select on public.rider_directory to authenticated;
