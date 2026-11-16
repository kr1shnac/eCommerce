-- =============================================================================
-- 20261113000005 · The refund line is a running balance, not a day's figure
-- =============================================================================
-- Owner directive (2026-11-13): "Confirm whether the Today 'refund due' is now
-- a running balance independent of placement day; if not, fix it with a test."
--
-- IT WAS NOT. `shop_day_totals()` filtered EVERY figure by `placed_at` inside
-- the requested day. That is right for takings - sales belong to the day they
-- were taken - but wrong for a liability: an order placed last Tuesday and
-- cancelled this morning is money the shop owes THIS MORNING, and the owner's
-- Today tab said zero. The one number whose whole job is "what must I pay
-- back" was invisible on the day it mattered.
--
-- WHAT CHANGES
-- The other figures stay exactly as they were, day-scoped. The refund line is
-- computed separately, over every order of an active shop, with NO date
-- filter:
--
--     sum(refund_due_paise)                      -- terminal half
--   + sum(shortage_refund_paise) where unsettled -- the shorter-bag half
--
-- The two are disjoint by construction (the reduced total, and the drop beyond
-- it), so one order can never be counted twice. A settled shortage leaves the
-- balance the moment `shortage_refund_paid_at` is stamped; a full refund
-- (`payment_status = 'refunded'`) clears the generated half.
--
-- This is the same rule the customer's own card reads per order - the balance
-- is the sum of those rows, computed in Postgres, never in the app.
-- =============================================================================

create or replace function public.shop_day_totals(p_day date default null)
returns public.shop_day_totals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day    date;
  v_result public.shop_day_totals;
  v_start  timestamptz;
  v_end    timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Only the shop can read the day''s takings.'
      using errcode = '42501';
  end if;

  v_day := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
  v_start := (v_day::timestamp at time zone 'Asia/Kolkata');
  v_end   := ((v_day + 1)::timestamp at time zone 'Asia/Kolkata');

  select
    v_day,

    count(*) filter (where o.status not in ('cancelled', 'failed', 'returned'))::integer,
    count(*) filter (where o.status = 'delivered')::integer,
    count(*) filter (where o.status = 'cancelled')::integer,
    count(*) filter (where o.status in ('failed', 'returned'))::integer,

    coalesce(sum(o.total_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,

    coalesce(sum(o.total_paise) filter (where o.status = 'delivered'), 0)::bigint,

    coalesce(sum(o.delivery_fee_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,
    coalesce(sum(o.discount_paise) filter (
      where o.status not in ('cancelled', 'failed', 'returned')
    ), 0)::bigint,

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

    -- Placeholder; the running balance is computed below, without a date
    -- filter. Every other figure in this row is the requested day's.
    0::bigint

  into v_result
  from public.orders o
  where o.store_id in (select id from public.stores where is_active)
    and o.placed_at >= v_start
    and o.placed_at <  v_end;

  -- THE REFUND LINE IS A RUNNING BALANCE, NOT A DAY FIGURE.
  -- An order placed last week and cancelled today is money the shop owes
  -- TODAY; filtering by `placed_at` hid exactly the liability the owner must
  -- act on. The two halves are disjoint by construction, so no order is
  -- counted twice, and a settled shortage leaves the moment it is stamped.
  select
    coalesce(sum(o.refund_due_paise), 0)
    + coalesce(sum(o.shortage_refund_paise) filter (
        where o.shortage_refund_paid_at is null
      ), 0)
  into v_result.refund_due_paise
  from public.orders o
  where o.store_id in (select id from public.stores where is_active);

  return v_result;
end;
$$;

comment on function public.shop_day_totals(date) is
  'The shop''s takings for one day (default today, Asia/Kolkata), in integer paise, staff only. Every figure is day-scoped EXCEPT refund_due_paise, which is the shop''s outstanding refund liability as of now - the sum of each order''s generated refund_due_paise plus the unsettled part of its recorded shortage refund, across every day. See register H3 and migration 20261113000005.';

comment on column public.shop_day_totals.refund_due_paise is
  'Money the shop is holding and must give back, as of now - not limited to the requested day. Terminal online payments not yet refunded, plus unsettled shorter-bag refunds.';

revoke all on function public.shop_day_totals(date) from public, anon;
grant execute on function public.shop_day_totals(date) to authenticated;
