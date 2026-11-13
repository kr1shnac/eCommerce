-- =============================================================================
-- 44 · The customer is told what changed, and the shop records what it owes
-- =============================================================================
-- THE TWO GAPS THIS CLOSES
-- ------------------------
-- (a) THE CUSTOMER SAW NOTHING. `admin_adjust_order_item()` lowered the bag
--     and recomputed the books, and the customer's order screen simply showed
--     a different total with no sentence about why. A bag that arrives smaller
--     than the receipt said, with no word from the shop, reads as theft even
--     when it was a shortage honestly settled over the phone. The order now
--     carries `shortage_adjusted_at` — stamped on the first real adjustment —
--     and the order screen says, in the customer's own language, that the
--     shelf could not give everything and the total was corrected.
--
-- (b) THE SHOP'S OWED MONEY HAD NO RECORD. An online-paid order (UPI today,
--     Razorpay later) whose total drops from T0 to T1 leaves Δ = T0 − T1 in
--     the shop's hands. Until now that number existed nowhere: the order's
--     `total_paise` moved to T1, the customer paid T0, and the difference was
--     a conversation. Online payments are still OFF — which is exactly why
--     the record must be built NOW, before the first real online rupee:
--     `shortage_refund_paise` accrues at adjustment time, when the memory and
--     the intent are fresh, not later from arithmetic somebody has to reverse.
--
-- THE MONEY RULES
-- ---------------
-- * WHO OWES: the accrual fires when `payment_status = 'paid'` and the method
--   is not cash. A COD order's smaller bag is simply paid for in cash at the
--   door — the customer hands over the NEW total, nothing is owed, nothing is
--   recorded. A UPI/card order that is still `pending` has paid nothing yet;
--   the customer will pay the new total at settlement, nothing is owed.
-- * THE AMOUNT: only a real drop accrues, and only the drop
--   (`old_total − new_total`). Lines only ever go down, so every adjustment
--   after the first adds its own drop; the column is the running sum of what
--   the shelf could not give, in integer paise, `check (>= 0)`.
-- * THE LEDGER STAYS SPLIT: `refund_due_paise` (the generated column) keeps
--   its rule — the money on a TERMINAL order. `shortage_refund_paise` is the
--   money on a delivery that went ahead smaller, or the part of a cancelled
--   order's paid amount beyond its reduced total. They are disjoint by
--   construction (T1 and T0 − T1), so summing them double-counts nothing —
--   the owner's Today tab carries both halves of one truth.
-- * TWO DOORS, ONE LIABILITY EACH: `mark_refund_paid()` settles a terminal
--   order's money back (and now stamps the shortage half settled in the same
--   breath — the owner paying T0 back has settled T1 + Δ). The new
--   `mark_shortage_refund_paid()` settles ONLY the shortage amount, on any
--   status, because a delivered-but-smaller bag is still owed its difference
--   after a perfectly good delivery. Neither touches what the other owns.
-- * THE RECORD OUTLIVES THE PAYMENT: settlement stamps
--   `shortage_refund_paid_at`; it never erases the amount. A liability that
--   vanishes when it is paid is a liability somebody can quietly forget — a
--   record that stays is an audit trail.
--
-- Rule 9.7: `supabase/tests/45_shortage_notice_refund_test.sql` proves the
-- stamp, the accrual and its refusals, both settle doors, and the day's
-- liability sum.
-- =============================================================================

alter table public.orders
  add column if not exists shortage_adjusted_at timestamptz,
  add column if not exists shortage_refund_paise bigint not null default 0
    check (shortage_refund_paise >= 0),
  add column if not exists shortage_refund_paid_at timestamptz;

comment on column public.orders.shortage_adjusted_at is
  'When the shop last shortened a line of this order (admin_adjust_order_item). '
  'Null means the bag was never changed. The customer''s order screen reads '
  'this to say why the receipt is smaller than the basket was.';
comment on column public.orders.shortage_refund_paise is
  'The money the shop owes back for a SHORTER bag on a paid non-cash order: '
  'the running sum of every drop in total_paise that the customer had already '
  'paid for. Zero for cash — the smaller bag is paid for in cash at the door. '
  'Recorded at adjustment time, and kept after settlement.';
comment on column public.orders.shortage_refund_paid_at is
  'When the recorded shortage refund actually went back to the customer '
  '(mark_shortage_refund_paid, or the full refund path of mark_refund_paid). '
  'Null means still owed. The amount stays recorded after settlement.';

-- -----------------------------------------------------------------------------
-- 1. The one write path, with the stamp and the accrual. The body is the
--    deployed function (migration 20261112000009) with the two writes added —
--    every refusal unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.admin_adjust_order_item(
  p_order_id uuid,
  p_item_id  uuid,
  p_quantity integer
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order      public.orders;
  v_item       public.order_items%rowtype;
  v_line_count integer;
  v_subtotal   bigint;
  v_total      bigint;
  v_old_total  bigint;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can change what an order holds.'
      using errcode = '42501';
  end if;

  if p_quantity is null or p_quantity < 0 or p_quantity > 99 then
    raise exception 'A line holds between 1 and 99 packs; 0 takes the line off.'
      using errcode = 'P0001';
  end if;

  -- Lock the order, so two owners tapping at once cannot both move stock.
  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'That order does not exist.'
      using errcode = 'P0002';
  end if;

  -- A bag that has left the shop is a fact, not a proposal.
  if v_order.status not in ('placed', 'confirmed', 'packing') then
    raise exception 'This order is %, so its lines cannot be changed.',
      v_order.status
      using errcode = 'P0001';
  end if;

  select * into v_item
    from public.order_items
   where id = p_item_id and order_id = p_order_id;

  if not found then
    raise exception 'That line is not on this order.'
      using errcode = 'P0002';
  end if;

  -- Nothing to do is not an error: a retry after a dropped response returns
  -- the order as it stands (rule 9.4).
  if p_quantity = v_item.quantity then
    return v_order;
  end if;

  -- A shortage means LESS. Giving a customer more than they ordered is a
  -- different conversation and a new order, not an edit of this one — and it
  -- would take stock the shelf never agreed to give.
  if p_quantity > v_item.quantity then
    raise exception 'A shortage can only lower a line — this line holds %.',
      v_item.quantity
      using errcode = 'P0001';
  end if;

  -- Taking the LAST line off empties the order; that is a cancellation, and
  -- `admin_cancel_order()` already does that honestly (stock, reason, status).
  if p_quantity = 0 then
    select count(*) into v_line_count
      from public.order_items
     where order_id = p_order_id;

    if v_line_count <= 1 then
      raise exception 'That is the only line on the order — cancel the order instead.'
        using errcode = 'P0001';
    end if;
  end if;

  v_old_total := v_order.total_paise;

  -- The units this order stops claiming go back on the shelf's book, inside
  -- the same transaction-local window every stock move uses.
  perform set_config('kunigal.moving_stock', 'on', true);

  if v_item.product_id is not null then
    update public.products
      set stock_qty = stock_qty + (v_item.quantity - p_quantity)
    where id = v_item.product_id;
  end if;

  if p_quantity = 0 then
    delete from public.order_items where id = v_item.id;
  else
    update public.order_items
      set quantity = p_quantity
     where id = v_item.id;
  end if;

  perform set_config('kunigal.moving_stock', 'off', true);

  -- The books follow the lines, in the same transaction. Fee and discount are
  -- carried as stored (see the header): this is arithmetic on facts, not a
  -- second pricing engine.
  select coalesce(sum(line_total_paise), 0) into v_subtotal
    from public.order_items
   where order_id = p_order_id;

  v_total := v_subtotal + v_order.delivery_fee_paise - v_order.discount_paise;

  if v_total < 0 then
    raise exception 'The coupon is now larger than the basket — cancel the order instead.'
      using errcode = 'P0001';
  end if;

  -- 2. The record the customer reads, and the money the shop owes back.
  --
  --    The stamp is written on every real adjustment (the notice is about the
  --    BAG). The accrual is about the MONEY: the customer already paid for the
  --    packs this adjustment releases, and cash will not pass hands again —
  --    the smaller bag is simply paid for at the door. A paid non-cash order
  --    is owed the drop, and the drop is recorded NOW, while the reason is
  --    standing in the shop. Lines only go down, so v_old_total >= v_total
  --    always holds here; the guard keeps the check constraint honest even
  --    if a future change breaks that invariant.
  update public.orders
     set subtotal_paise         = v_subtotal,
         total_paise            = v_total,
         shortage_adjusted_at   = now(),
         shortage_refund_paise  = shortage_refund_paise
           + case
               when v_order.payment_status = 'paid'
                    and v_order.payment_method <> 'cod'
                    and v_old_total > v_total
                 then v_old_total - v_total
               else 0
             end
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.admin_adjust_order_item(uuid, uuid, integer) is
  'The shop settles a shortage: one line goes down or off, the released units '
  'go back to stock, and the order''s subtotal and total are recomputed from '
  'the remaining lines. Admin-only (42501), refuses a bag that has left '
  '(P0001), refuses unknown rows (P0002), refuses an increase (a shortage '
  'means less), refuses to empty the order (cancel it instead), and returns '
  'the stored row. Every real adjustment stamps shortage_adjusted_at (the '
  'customer''s notice) and accrues shortage_refund_paise when the customer '
  'already paid online for the packs that will not come. The delivery fee and '
  'the coupon discount are carried as stored — pricing stays in place_order().';

revoke all on function public.admin_adjust_order_item(uuid, uuid, integer) from public, anon;
grant execute on function public.admin_adjust_order_item(uuid, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. The shortage door. Separate from mark_refund_paid on purpose: a delivered
--    order whose bag came smaller is owed its difference even though the
--    delivery itself was perfectly good, and mark_refund_paid refuses
--    non-terminal orders by design. One liability, one door, one stamp.
-- -----------------------------------------------------------------------------
create or replace function public.mark_shortage_refund_paid(p_order_id uuid)
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

  if v_order.shortage_refund_paise = 0 then
    raise exception 'Nothing is recorded as owed for a shorter bag on this order.'
      using errcode = 'P0001';
  end if;

  -- Already settled is not an error: a retry after a dropped response returns
  -- the row as it stands (rule 9.4).
  if v_order.shortage_refund_paid_at is not null then
    return v_order;
  end if;

  update public.orders
     set shortage_refund_paid_at = now()
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.mark_shortage_refund_paid(uuid) is
  'The owner records that the money owed for a SHORTER bag actually went back '
  'to the customer. Stamps shortage_refund_paid_at; the recorded amount stays. '
  'Admin-only (42501), unknown order P0002, nothing recorded P0001, a repeat '
  'call returns the row unchanged. Works on any status — the liability is '
  'about the money, not about how the delivery ended.';

revoke all on function public.mark_shortage_refund_paid(uuid) from public, anon;
grant execute on function public.mark_shortage_refund_paid(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. The full-refund door also settles the shortage half: paying a cancelled
--    order's paid amount back means paying T1 and Δ in one motion. The guards
--    are exactly the deployed ones (migration 20261112000007); only the final
--    update grew.
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
     set payment_status         = 'refunded',
         shortage_refund_paid_at = case
           when shortage_refund_paise > 0 then now()
           else shortage_refund_paid_at
         end
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.mark_refund_paid(uuid) is
  'The owner records that the money was actually returned for a non-cash order '
  'that was cancelled, failed or returned. Clears refund_due_paise, and stamps '
  'the recorded shortage refund settled too — the full amount went back in one '
  'motion. A repeat call returns the row unchanged; a wrong state raises.';

revoke all on function public.mark_refund_paid(uuid) from public, anon;
grant execute on function public.mark_refund_paid(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The day's liability carries both halves. The rest of the function is the
--    deployed one (migration 20261112000007), untouched.
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

    -- Refund due: the order's own generated answer, summed — plus the money
    -- recorded for shorter bags that has not gone back yet. The two are
    -- disjoint by construction (the reduced total, and the drop beyond it),
    -- so one order can never be counted twice.
    (
      coalesce(sum(o.refund_due_paise), 0)
      + coalesce(sum(o.shortage_refund_paise) filter (
          where o.shortage_refund_paid_at is null
        ), 0)
    )::bigint

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
  'generated refund_due_paise plus the unsettled part of its recorded '
  'shortage refund. See register H3.';
