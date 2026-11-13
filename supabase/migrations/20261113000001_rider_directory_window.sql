-- =============================================================================
-- 42 · A rider's phone number is contact for the errand, not forever
-- =============================================================================
-- THE CHANGE
-- ----------
-- `rider_directory` (migration 20261112000008) answers one question: may this
-- caller read the name, photo and phone of the rider on THIS order? Its scope
-- followed the order's visibility — a customer could read their rider on an
-- order delivered three months ago. A rider's phone number is contact for the
-- errand: while the bag is being assembled, while it is on the road, and for a
-- short while after it lands. It is not a permanent listing.
--
-- THE WINDOW (proposed): 24 HOURS AFTER DELIVERY
-- ----------------------------------------------
-- * `placed`, `confirmed`, `packing`, `out_for_delivery` — visible for as long
--   as the caller may see the order. This is the errand in progress.
-- * `delivered` — visible until `delivered_at + 24 hours`. The delivery
--   evening is when a customer still needs the rider: the bag is at the
--   neighbour's, one packet is crushed, the change was short. The next
--   morning the shop's own phone is the right door — the feedback card on the
--   order records what went wrong, and the shop settles it.
-- * `cancelled`, `failed`, `returned` — never. The rider never handed the bag
--   over, so the customer's contact for these is the shop, not the rider who
--   turned back. The order keeps its rider for the shop's own books; only the
--   customer-facing phone view narrows.
--
-- The owner keeps every rider always: `is_admin()` callers read the view for
-- the board and the money desk, where a rider's phone is a work tool on a
-- closed order as much as on a live one.
--
-- The anchor is `coalesce(delivered_at, placed_at)`: a `delivered` order
-- always has a `delivered_at` (every completion path sets it once), so the
-- coalesce is only belt-and-braces against a row written by hand.
--
-- Rule 9.7: `supabase/tests/43_rider_directory_window_test.sql` proves the
-- visible and the hidden cases, the 24-hour boundary, and that the owner's
-- view does not narrow.
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
  -- The caller may see this rider only through an order they may see. The
  -- owner's work view is UNWINDOWED — the money desk and the board need a
  -- rider's phone on a closed order as much as on a live one. A customer's
  -- window is their own order, live or delivered inside the last day.
  -- `exists`, not a join: one row per rider, never one row per order, so a
  -- repeat customer cannot break `maybeSingle()`.
  and exists (
    select 1
      from public.orders o
     where o.assigned_to = p.id
       and (
         public.is_admin()
         or (
           o.user_id = auth.uid()
           and (
             o.status in ('placed', 'confirmed', 'packing', 'out_for_delivery')
             or (
               o.status = 'delivered'
               and coalesce(o.delivered_at, o.placed_at) > now() - interval '24 hours'
             )
           )
         )
       )
  );

comment on view public.rider_directory is
  'Name, photo and phone of ONE rider: the rider assigned to an order the '
  'caller may see, while the errand is live — the order is in progress, or it '
  'was delivered inside the last 24 hours. Cancelled, failed and returned '
  'orders expose no rider: the shop is the contact for those. The owner sees '
  'every assigned rider always. Read-only, four columns, authenticated only.';

revoke all on public.rider_directory from public, anon;
grant select on public.rider_directory to authenticated;
