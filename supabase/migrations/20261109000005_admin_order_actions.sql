-- =============================================================================
-- 37 · The shop closes an order on the customer's behalf, and completes one
-- =============================================================================
-- Two things the owner needs and has never had, both of which exist as rider
-- actions but not as owner actions:
--
--   * **Cancel on the customer's behalf.** The customer asks by phone ("my
--     brother already brought milk"), and today the owner has to ask that person
--     to open the app and tap cancel. If they cannot reach them, the order stays
--     live, the stock stays held and the shelf lies to everyone else.
--   * **Complete an order.** A rider's phone dies mid-delivery and the order
--     never reaches `delivered`. The customer has the bag, the books say they
--     do not, and the day's takings are short.
--
-- WHY NEW FUNCTIONS AND NOT A PLAIN UPDATE
--
-- Same rule as `set_shop_open()` and the money desk: a non-admin's direct UPDATE
-- is filtered by RLS to ZERO rows and raises NOTHING, so a button built on it
-- would report success while changing nothing. These raise `42501` instead and
-- return the row as STORED.
--
-- WHAT THIS FILE DOES NOT DECIDE
--
--   * It does not invent a refund. `orders.refund_due_paise` is a GENERATED
--     column (migration 20261106000002) whose rule is "online money still marked
--     paid on a cancelled/failed/returned order": cancelling an online-paid order
--     here makes the customer's refund card appear by itself, with no second
--     implementation of the rule to get wrong. Settling that money is the money
--     desk's job (`mark_refund_paid()`, migration 20261109000003).
--   * It does not release the coupon's global use, exactly like
--     `cancel_order()`. The per-customer count (migration 20261109000004) already
--     ignores cancelled orders, so a customer who cancels is not locked out; the
--     shop-wide `used_count` is a separate counter with a separate meaning
--     ("this code was redeemed"), and changing it here would need its own
--     decision and its own test.
--   * It does not set `payment_status`. Force-completing a COD order leaves the
--     money `pending`, which is the truth until the cash is handed over and the
--     money desk records it. Marking a payment `paid` because a status changed
--     would be the shop's books claiming cash nobody counted.
--
-- STOCK
--
-- `admin_cancel_order()` puts the stock back, because an order in `placed`,
-- `confirmed`, `packing` or `out_for_delivery` has never been handed to anybody.
-- `admin_force_complete()` does NOT touch stock: the goods left the shop when
-- `place_order()` decremented it, and putting them back now would resurrect
-- units the customer already has.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Why the owner cancelled. Nullable, and never overwritten by anything else.
--
--    `notes` is the customer's own instruction to the shop, so it is NOT reused
--    for this. A separate column means the owner's reason and the customer's
--    "please call at the back door" cannot overwrite each other.
-- -----------------------------------------------------------------------------
alter table public.orders add column cancellation_reason text;

comment on column public.orders.cancellation_reason is
  'Why the shop cancelled this order on the customer''s behalf. NULL for every '
  'order cancelled by the customer themselves. Never changed once written.';

-- -----------------------------------------------------------------------------
-- 2. Cancel on behalf
-- -----------------------------------------------------------------------------
create or replace function public.admin_cancel_order(
  p_order_id uuid,
  p_reason   text default null
)
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_item  public.order_items%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can cancel an order for a customer.'
      using errcode = '42501';
  end if;

  -- Lock the row first, so two owners tapping at once cannot both put the stock
  -- back. This is the exact shape of the race test 04 already catches for
  -- `place_order()`.
  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'That order does not exist.'
      using errcode = 'P0002';
  end if;

  -- Only live orders. A delivered bag is not cancelled whatever the button
  -- says, and a failed or returned order already had its stock decision made.
  if v_order.status in ('delivered', 'cancelled', 'failed', 'returned') then
    raise exception 'This order is %, so it cannot be cancelled.', v_order.status
      using errcode = 'P0001';
  end if;

  -- The reason travels with the order. Blank becomes NULL, not an empty string,
  -- so "no reason given" is one state rather than two.
  update public.orders
     set status = 'cancelled',
         cancellation_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_order_id
  returning * into v_order;

  -- Stock back, exactly once per line, in the same transaction.
  perform set_config('kunigal.moving_stock', 'on', true);

  for v_item in
    select oi.*
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    order by oi.product_id
  loop
    update public.products
      set stock_qty = stock_qty + v_item.quantity
    where id = v_item.product_id;
  end loop;

  perform set_config('kunigal.moving_stock', 'off', true);

  return v_order;
end;
$$;

comment on function public.admin_cancel_order(uuid, text) is
  'The shop cancels a live order for a customer and puts the stock back. '
  'Admin-only (42501), refuses a terminal order (P0001), refuses an unknown '
  'order (P0002), and returns the stored row.';

revoke all on function public.admin_cancel_order(uuid, text) from public, anon;
grant execute on function public.admin_cancel_order(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Force-complete: the bag arrived, the tracker never heard about it
-- -----------------------------------------------------------------------------
create or replace function public.admin_force_complete(p_order_id uuid)
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can mark an order delivered.'
      using errcode = '42501';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'That order does not exist.'
      using errcode = 'P0002';
  end if;

  -- Already at a final answer, or beyond help: refuse rather than re-stamp a
  -- time the shop cannot prove. `failed` can never be reopened as `delivered`
  -- (migration 20261021000001), and this must not become a back door for it.
  --
  -- An order that is ALREADY delivered is the exception: the action has already
  -- succeeded, so a retry after a dropped response returns the row unchanged
  -- rather than an error. That is rule 9.4, and it is the same shape the money
  -- desk uses. A cancelled, failed or returned order is NOT that case: those
  -- are states that must never become delivered, whatever the button says.
  if v_order.status = 'delivered' then
    return v_order;
  end if;

  if v_order.status in ('cancelled', 'failed', 'returned') then
    raise exception 'This order is %, so it cannot be marked delivered.',
      v_order.status
      using errcode = 'P0001';
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = coalesce(v_order.delivered_at, now())
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.admin_force_complete(uuid) is
  'The shop marks a live order delivered, for the case where the rider''s phone '
  'never reported back. Admin-only (42501), refuses a terminal order (P0001), '
  'never rewrites an existing delivered_at, and returns the stored row. Money is '
  'left alone: settling cash is the money desk''s job.';

revoke all on function public.admin_force_complete(uuid) from public, anon;
grant execute on function public.admin_force_complete(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Freeze the shop's reason against a rider.
--
--    `guard_order_update()` was LAST written by 20261109000001_rider_erasure.sql
--    (the body in 20261021000001 predates the rider-hand-back erasure shape).
--    That file's body is copied here byte-for-byte, with exactly two additions,
--    both marked with a "NEW" comment: the rider's "cannot change the details"
--    list gains `cancellation_reason`, and the customer's cancel shape gains the
--    matching `is not distinct from` line so a customer's own cancel leaves it
--    NULL.
--
--    Nothing else changes. The two erasure shapes, the assignment rules, the
--    never-backwards status ladder, the `delivered_at` rule and the customer's
--    placed-only cancel are all identical. This was verified the hard way: an
--    earlier draft copied the OLD body from 20261021000001 and test 30 (rider
--    erasure) failed in five places, because the hand-back shape had vanished.
-- -----------------------------------------------------------------------------

create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
declare
  v_old_rank integer;
  v_new_rank integer;
begin
  -- Admin: full control, nothing to check.
  if public.is_admin() then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- An erasure (see delete_my_account, migration 20261020000001).
  --
  -- Shape 1: the erasee's OWN orders become the tombstone. Unchanged.
  -- ---------------------------------------------------------------------------
  if public.erasure_in_progress()
     and new.user_id = public.deleted_customer_id()
     and new.address_id is null
     and (new.delivery_address ->> 'erased') = 'true'
     and new.notes is null
     and new.order_number is not distinct from old.order_number
     and new.store_id is not distinct from old.store_id
     and new.status is not distinct from old.status
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- An erasure, shape 2: the rider hands back an order (migration
  -- 20261109000001). The order stays somebody else's — only the assignment is
  -- dropped. `old.assigned_to = auth.uid()` is the load-bearing condition: it
  -- means the person being erased is the assignee, which is the only way this
  -- row can change, because a live rider reaches the delivery branch below and
  -- is refused there.
  -- ---------------------------------------------------------------------------
  if public.erasure_in_progress()
     and old.assigned_to = auth.uid()
     and new.assigned_to is null
     and new.assigned_at is null
     and new.user_id is not distinct from old.user_id
     and new.store_id is not distinct from old.store_id
     and new.address_id is not distinct from old.address_id
     and new.delivery_address is not distinct from old.delivery_address
     and new.status is not distinct from old.status
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.notes is not distinct from old.notes
     and new.order_number is not distinct from old.order_number
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at
     and new.failure_reason is not distinct from old.failure_reason
     and new.failure_note is not distinct from old.failure_note
     and new.idempotency_key is not distinct from old.idempotency_key then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Delivery partner
  -- ---------------------------------------------------------------------------
  if public.current_user_role() = 'delivery' then
    if new.order_number  is distinct from old.order_number
       or new.user_id        is distinct from old.user_id
       or new.store_id       is distinct from old.store_id
       or new.address_id     is distinct from old.address_id
       or new.delivery_address is distinct from old.delivery_address
       or new.payment_method is distinct from old.payment_method
       or new.subtotal_paise is distinct from old.subtotal_paise
       or new.delivery_fee_paise is distinct from old.delivery_fee_paise
       or new.discount_paise is distinct from old.discount_paise
       or new.total_paise    is distinct from old.total_paise
       or new.notes          is distinct from old.notes
       or new.placed_at      is distinct from old.placed_at
       -- NEW (20261109000005): the shop's cancellation reason is the shop's, so
       -- a rider cannot rewrite why the owner cancelled an order.
       or new.cancellation_reason is distinct from old.cancellation_reason
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'A delivery partner cannot change the details of an order.'
        using errcode = '42501';
    end if;

    -- Assignment. Either this is a claim (unassigned -> me) or the order was
    -- already mine and must stay mine.
    if new.assigned_to is distinct from old.assigned_to then
      if old.assigned_to is not null then
        raise exception 'This order is already assigned to a rider.'
          using errcode = '42501';
      end if;
      if new.assigned_to is distinct from auth.uid() then
        raise exception 'A rider may only claim an order for themselves.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at
         and new.assigned_at is null then
        raise exception 'Claiming an order must record the time.'
          using errcode = '42501';
      end if;
    else
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'This order is not assigned to you.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at then
        raise exception 'A rider cannot change when an order was claimed.'
          using errcode = '42501';
      end if;
    end if;

    -- Status.
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        raise exception 'A rider cannot cancel an order.'
          using errcode = '42501';
      end if;

      -- The honest end states. A rider may only reach them from a state that
      -- means the bag is physically with them, and `returned` requires that the
      -- attempt has already been recorded as failed.
      if new.status = 'failed' then
        if old.status not in ('out_for_delivery', 'failed') then
          raise exception 'A delivery can only fail once it is out for delivery.'
            using errcode = '42501';
        end if;
      elsif new.status = 'returned' then
        if old.status not in ('failed', 'out_for_delivery', 'returned') then
          raise exception 'Only an out-for-delivery or failed order can be returned.'
            using errcode = '42501';
        end if;
      else
        -- The happy path moves forward exactly one step, never back.
        --
        -- `failed` and `returned` are TERMINAL: their rank is deliberately
        -- absent from the table below, so they resolve to 0 and can never move
        -- on to a happy-path status. Without that, `failed -> delivered` would
        -- compare 0 against 5, pass the "forward" test, and quietly reopen a
        -- delivery the rider honestly closed — which is exactly the kind of
        -- dishonest state this migration exists to prevent.
        if old.status in ('failed', 'returned') then
          raise exception 'A failed or returned order cannot be reopened.'
            using errcode = '42501';
        end if;

        v_old_rank := case old.status
                        when 'placed'           then 1
                        when 'confirmed'        then 2
                        when 'packing'          then 3
                        when 'out_for_delivery' then 4
                        when 'delivered'        then 5
                        else 0
                      end;
        v_new_rank := case new.status
                        when 'placed'           then 1
                        when 'confirmed'        then 2
                        when 'packing'          then 3
                        when 'out_for_delivery' then 4
                        when 'delivered'        then 5
                        else 0
                      end;

        if v_new_rank <= v_old_rank then
          raise exception 'An order moves forward one step at a time.'
            using errcode = '42501';
        end if;
      end if;
    end if;

    -- delivered_at is set when (and only when) the order is delivered. A failed
    -- or returned order never carries a delivery time.
    if new.status = 'delivered' then
      if new.delivered_at is null then
        raise exception 'Record the delivery time when marking an order delivered.'
          using errcode = '42501';
      end if;
    elsif new.delivered_at is distinct from old.delivered_at then
      raise exception 'Only a delivered order may record a delivery time.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Customer: may cancel, but only while the order is still unconfirmed.
  -- Unchanged from migration 05 / 20261013000001 / 20261020000001.
  -- ---------------------------------------------------------------------------
  if old.status = 'placed'
     and new.status = 'cancelled'
     and new.user_id is not distinct from old.user_id
     and new.store_id is not distinct from old.store_id
     and new.address_id is not distinct from old.address_id
     and new.delivery_address is not distinct from old.delivery_address
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.notes is not distinct from old.notes
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at
     and new.assigned_to is not distinct from old.assigned_to
     -- NEW (20261109000005): a customer's own cancel leaves the shop's reason
     -- NULL. A shop reason belongs to a shop cancellation, never to the
     -- customer's own.
     and new.cancellation_reason is not distinct from old.cancellation_reason
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

comment on function public.guard_order_update() is
  'Who may change what on an order. Admins pass. Riders move status only. '
  'Customers cancel their own placed order. The shop''s cancellation reason is '
  'frozen against riders (migration 20261109000005).';