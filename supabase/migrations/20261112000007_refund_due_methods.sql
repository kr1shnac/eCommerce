-- =============================================================================
-- 39b · A refund is owed for every method that is not cash
--
-- `refund_due_paise` was written when `payment_method` had exactly two values,
-- `cod` and `online`, so its rule said `payment_method = 'online'`. Migration
-- 20261112000002 then added `upi`, `card`, `netbanking` and `wallet` — the four
-- methods a real gateway settles — and the rule silently stopped covering them.
--
-- The failure was quiet and expensive: a customer who paid by UPI, whose order
-- the shop then cancelled, would see NO refund owed on their order screen, and
-- the owner's Today tab would report a smaller liability than the shop holds.
-- Nothing errored; the numbers were simply wrong for the new methods. Test 26
-- could not see it because both sides of its "do these agree?" assertion used
-- the same stale expression.
--
-- The fix has two parts, and the second is the important one:
--
--   1. The generated column now says `payment_method <> 'cod'`. Cash is the
--      only method where a failed delivery means no money was ever taken, so
--      "not cash" is the honest rule and it covers a future method without
--      another migration.
--   2. `shop_day_totals()` stops re-deriving the rule and SUMS THE GENERATED
--      COLUMN. The old body duplicated the expression, which is how the two
--      could drift apart in the first place. One rule, one place.
--
-- Postgres cannot alter a generated expression in place, so the column is
-- dropped and re-added; every existing row is recomputed from its own facts.
-- =============================================================================

alter table public.orders drop column if exists refund_due_paise;

alter table public.orders
  add column refund_due_paise integer
    generated always as (
      case
        when payment_method <> 'cod'
         and payment_status = 'paid'
         and status in ('cancelled', 'failed', 'returned')
        then total_paise
        else 0
      end
    ) stored;

comment on column public.orders.refund_due_paise is
  'Money the shop still owes on this order: total_paise when a non-cash '
  'payment is still paid on a cancelled/failed/returned order, else 0. '
  'Generated — the app never writes it, and marking payment_status = refunded '
  'clears it. Covers upi/card/netbanking/wallet as well as the legacy online.';

-- -----------------------------------------------------------------------------
-- The day's ledger, unchanged except for the refund line.
--
-- Everything above the refund expression is byte-for-byte migration
-- 20261021000002: the day boundary, the sale rule, the cash columns and the
-- staff door are all deliberate and are not being revisited here.
-- -----------------------------------------------------------------------------

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

    -- Refund due: the order's own generated answer, summed. The rule (which
    -- methods count, which states, which payment status) lives on the column
    -- and nowhere else, so the customer's card and the owner's ledger cannot
    -- disagree by construction.
    coalesce(sum(o.refund_due_paise), 0)::bigint

  into v_result
  from public.orders o
  where o.store_id in (select id from public.stores where is_active)
    and o.placed_at >= v_start
    and o.placed_at <  v_end;

  return v_result;
end;
$$;

comment on function public.shop_day_totals(date) is
  'The shop''s takings for one day (default today, Asia/Kolkata), in integer '
  'paise. Staff only. The refund liability is the sum of each order''s own '
  'generated refund_due_paise. See register H3.';

-- -----------------------------------------------------------------------------
-- 3. The door the owner actually uses to clear the liability.
--
-- `mark_refund_paid()` had the same stale test: it refused every method except
-- the literal 'online', so on a UPI or card order it raised "this order was cash
-- on delivery" — a sentence that was both false and unactionable, on the exact
-- screen where the owner was trying to pay somebody back. Only cash is excluded
-- now. Everything else in the function is unchanged.
-- -----------------------------------------------------------------------------

create or replace function public.mark_refund_paid(p_order_id uuid)
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can record a refund.'
      using errcode = '42501';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'That order does not exist.'
      using errcode = 'P0002';
  end if;

  if v_order.payment_method = 'cod' then
    raise exception 'This order was cash on delivery; there is nothing to refund.'
      using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'refunded' then
    return v_order;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'No money was taken for this order, so there is nothing to refund.'
      using errcode = 'P0001';
  end if;

  if v_order.status not in ('cancelled', 'failed', 'returned') then
    raise exception 'Only a cancelled, failed or returned order is owed a refund.'
      using errcode = 'P0001';
  end if;

  update public.orders
     set payment_status = 'refunded'
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.mark_refund_paid(uuid) is
  'The owner records that the money was actually returned for a non-cash order '
  'that was cancelled, failed or returned. Clears refund_due_paise. A repeat '
  'call returns the row unchanged; a wrong state raises.';
