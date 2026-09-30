-- =============================================================================
-- 19 · The owner's day: what the shop actually took
--
-- WHY THIS EXISTS
--
-- Until now the owner had no totals screen. The board shows a list of orders and
-- three counts (live, waiting, delivered today), but not one rupee figure. In a
-- cash shop that is the whole question at closing time: "how much came in, how
-- much is still in a rider's pocket, and what did we give away in delivery
-- charges?" (register H3). Without it the pilot's daily reconciliation is a
-- paper exercise and the owner cannot tell whether the app is worth keeping.
--
-- WHY THIS IS A FUNCTION AND NOT A QUERY IN THE APP
--
-- Rule 9.1: money is computed in the database, never in the client. Two reasons
-- make that concrete here, not just a principle:
--
--   1. The board fetches at most 100 orders. Summing those in the app would
--      produce a confident, wrong "today" the moment the shop does more than
--      100 orders in a day — and it would look right.
--   2. A cancelled order must not count as takings, a failed one must not count
--      as cash collected, and a COD order that has not been delivered yet is
--      money that has not arrived. Those are accounting rules, and they belong
--      in one place, next to the ledger.
--
-- WHY security definer
--
-- The answer is a shop-wide aggregate. The `orders` policy shows a customer only
-- their own rows, so an invoker-rights function would silently sum just the
-- caller's orders and report a small, plausible, entirely false total — the
-- worst possible failure mode for a money screen. The function is therefore
-- SECURITY DEFINER, and its FIRST act is to refuse anyone who is not staff. The
-- grant is explicit and narrow; `anon` gets nothing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The shape of the answer
-- -----------------------------------------------------------------------------
-- A decimal is used for nothing. Every money figure is integer paise, so the
-- result can be added, compared and formatted with the same helpers as every
-- other amount in the app (AGENTS.md Rule 1).
drop type if exists public.shop_day_totals cascade;
create type public.shop_day_totals as (
  /** The day this describes, in the shop's own timezone (Asia/Kolkata). */
  the_day            date,
  /** Orders placed today that are a sale (not cancelled, failed or returned). */
  orders_placed      integer,
  orders_delivered   integer,
  orders_cancelled   integer,
  orders_failed      integer,
  /** Value of the orders placed today that are a sale, in flight included. */
  gross_paise        bigint,
  /** Value of the orders that actually reached the customer today. */
  delivered_paise    bigint,
  /** What the shop gave away in delivery charges today. */
  delivery_fee_paise bigint,
  /** What coupons cost the shop today. */
  discount_paise     bigint,
  /** Cash the riders are carrying right now: COD, delivered, not yet paid. */
  cash_in_hand_paise bigint,
  /** Cash already collected for those orders (a rider marked them paid). */
  cash_collected_paise bigint,
  /**
   * Money the shop is holding that it must give back: an order that was paid
   * online but never delivered (failed or returned), or a cancelled order that
   * was already paid. This is a liability, not takings, and it is deliberately
   * NOT part of gross_paise — the shop has the customer's money and owes it.
   */
  refund_due_paise   bigint
);

comment on type public.shop_day_totals is
  'One day of the shop''s takings, in integer paise. Every figure is computed '
  'server-side — never summed from what the app happened to fetch.';

-- -----------------------------------------------------------------------------
-- The function
-- -----------------------------------------------------------------------------
-- Defaults to "today" in the shop's timezone. A date may be passed so the owner
-- can look back at yesterday, which is the second thing anyone asks.
--
-- `Asia/Kolkata` is hard-coded rather than read from a setting on purpose: this
-- is a one-shop app for one town, the shop's day is the Indian day, and a
-- timezone the owner cannot misconfigure cannot go wrong. If a second shop ever
-- appears in another zone, this becomes a column on `stores`.
create or replace function public.shop_day_totals(p_day date default null)
returns public.shop_day_totals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day    date;
  v_result public.shop_day_totals;
  -- The day as a half-open interval [start, end) in the shop's timezone. A
  -- half-open interval is the only correct way to bucket by day: `between` with
  -- 23:59:59 silently drops anything in the last second, and that second is
  -- where a late-night order lives.
  v_start  timestamptz;
  v_end    timestamptz;
begin
  -- The door. Checked before anything is read, so a non-staff caller learns
  -- nothing — not even an empty row — from calling this.
  if not public.is_staff() then
    raise exception 'Only the shop can read the day''s takings.'
      using errcode = '42501';
  end if;

  v_day := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  v_start := (v_day::timestamp at time zone 'Asia/Kolkata');
  v_end   := ((v_day + 1)::timestamp at time zone 'Asia/Kolkata');

  select
    v_day,

    -- Counts. An order is counted as "placed" when it is a sale: see the note on
    -- v_sale below. Cancelled, failed and returned orders get their own columns
    -- so the owner can still see them — they are real events, they just are not
    -- takings.
    count(*) filter (where o.status not in ('cancelled', 'failed', 'returned'))::integer,
    count(*) filter (where o.status = 'delivered')::integer,
    count(*) filter (where o.status = 'cancelled')::integer,
    count(*) filter (where o.status in ('failed', 'returned'))::integer,

    -- Gross: what the day is worth. An order counts only if it is a SALE — not
    -- cancelled, not failed, not returned. A failed delivery is not a sale: the
    -- rider came back with the bag, no money changed hands, and counting it would
    -- overstate the day by exactly the orders that went wrong. Orders still in
    -- flight DO count: the customer has committed and the shop is holding stock
    -- for them. This is therefore "what the day has earned so far", and it is
    -- deliberately not the same as cash received.
    coalesce(sum(o.total_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,

    -- Delivered: what actually reached a home. A failed or returned order never
    -- lands here, which is the whole point of the honest states (M3).
    coalesce(sum(o.total_paise) filter (where o.status = 'delivered'), 0)::bigint,

    -- Delivery charges and coupons, summed over sales only: an order that never
    -- happened cost the shop nothing in either.
    coalesce(sum(o.delivery_fee_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,
    coalesce(sum(o.discount_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,

    -- Cash in hand: COD orders that have been delivered but whose payment_status
    -- has not moved to 'paid'. This is the number that must match the money in
    -- the riders' pockets at closing time. Online orders are excluded: that money
    -- never passed through a rider.
    coalesce(sum(o.total_paise) filter (
      where o.status = 'delivered'
        and o.payment_method = 'cod'
        and o.payment_status <> 'paid'
    ), 0)::bigint,

    coalesce(sum(o.total_paise) filter (
      where o.status = 'delivered'
        and o.payment_method = 'cod'
        and o.payment_status = 'paid'
    ), 0)::bigint,

    -- Refund due: money the shop holds but must return. Two ways that happens —
    -- an order paid online that never arrived (failed or returned), or a
    -- cancelled order that was already paid. COD is excluded: a failed COD
    -- delivery means the cash was never collected, so there is nothing to refund.
    coalesce(sum(o.total_paise) filter (
      where o.payment_method = 'online'
        and o.payment_status = 'paid'
        and o.status in ('cancelled', 'failed', 'returned')
    ), 0)::bigint

  into v_result
  from public.orders o
  where o.store_id in (select id from public.stores where is_active)
    -- `placed_at` is when the customer's order entered the shop's day. Using
    -- delivered_at here would drop every order still in flight.
    and o.placed_at >= v_start
    and o.placed_at <  v_end;

  return v_result;
end;
$$;

comment on function public.shop_day_totals(date) is
  'The shop''s takings for one day (default today, Asia/Kolkata), in integer '
  'paise. Staff only. See register H3.';

-- -----------------------------------------------------------------------------
-- Who may call it
-- -----------------------------------------------------------------------------
-- Explicit, and re-stated on every run so a later migration cannot quietly widen
-- it. `anon` and `public` are revoked: a signed-out phone must not be able to
-- ask what the shop took today.
revoke all on function public.shop_day_totals(date) from public, anon;
grant execute on function public.shop_day_totals(date) to authenticated;

-- -----------------------------------------------------------------------------
-- A per-rider breakdown, so cash can be chased one pocket at a time
-- -----------------------------------------------------------------------------
-- "Cash in hand" is useful; "this rider is holding ₹340" is actionable. Same
-- rules, same door.
drop type if exists public.rider_day_total cascade;
create type public.rider_day_total as (
  rider_id           uuid,
  rider_name         text,
  orders_delivered   integer,
  cash_to_collect_paise bigint,
  cash_collected_paise  bigint
);

comment on type public.rider_day_total is
  'One rider''s share of a day: what they delivered and the cash they are '
  'carrying. Staff only.';

create or replace function public.shop_day_by_rider(p_day date default null)
returns setof public.rider_day_total
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day   date;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Only the shop can read the day''s takings.'
      using errcode = '42501';
  end if;

  v_day := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  v_start := (v_day::timestamp at time zone 'Asia/Kolkata');
  v_end   := ((v_day + 1)::timestamp at time zone 'Asia/Kolkata');

  return query
  select
    o.assigned_to,
    -- A name is whoever we can actually name. The tombstone profile has no name
    -- and no phone, so it falls back to a short id rather than showing blank.
    coalesce(nullif(trim(p.full_name), ''), p.phone, left(o.assigned_to::text, 8)),
    count(*) filter (where o.status = 'delivered')::integer,
    coalesce(sum(o.total_paise) filter (
      where o.status = 'delivered'
        and o.payment_method = 'cod'
        and o.payment_status <> 'paid'
    ), 0)::bigint,
    coalesce(sum(o.total_paise) filter (
      where o.status = 'delivered'
        and o.payment_method = 'cod'
        and o.payment_status = 'paid'
    ), 0)::bigint
  from public.orders o
  left join public.profiles p on p.id = o.assigned_to
  where o.store_id in (select id from public.stores where is_active)
    and o.placed_at >= v_start
    and o.placed_at <  v_end
    and o.assigned_to is not null
  group by o.assigned_to, p.full_name, p.phone
  -- Biggest pocket first: the one to chase is the one at the top.
  order by 4 desc, 1;
end;
$$;

comment on function public.shop_day_by_rider(date) is
  'One row per rider for a day: deliveries and cash in hand. Staff only.';

revoke all on function public.shop_day_by_rider(date) from public, anon;
grant execute on function public.shop_day_by_rider(date) to authenticated;

-- -----------------------------------------------------------------------------
-- The index the day query needs
-- -----------------------------------------------------------------------------
-- Every figure above is filtered by `store_id` and a `placed_at` range. Existing
-- indexes cover status and status+placed_at, but not this pair, and the board's
-- 60-second poll hits it repeatedly.
create index if not exists orders_store_placed_idx
  on public.orders (store_id, placed_at desc);
