-- =============================================================================
-- 35 · The money desk: settle the two numbers Today reports
-- =============================================================================
-- `shop_day_totals()` has reported `cash_in_hand_paise` and `refund_due_paise`
-- since migration 20261021000002, and the customer has seen `refund_due_paise`
-- since 20261106000002. But nothing in the app could SETTLE either one:
--
--   * a rider hands the owner a bundle of cash, and the order stayed
--     `payment_status = 'pending'` forever, so the day's books kept saying the
--     money was "in a rider's pocket" after it was in the drawer;
--   * the owner paid a refund by UPI, and the order stayed `paid`, so the shop
--     kept reporting a liability it no longer had.
--
-- Both are money facts, so both go through a function that checks the state
-- first and returns the row as stored. A plain `.update()` by a non-admin is
-- filtered to zero rows and raises nothing; these raise 42501 instead.
--
-- WHY THE STATE CHECKS ARE THIS STRICT
--
--   * Cash can only be collected on a DELIVERED COD order. Marking a live order
--     would claim money for food that has not arrived.
--   * A refund can only be paid on a CANCELLED, FAILED or RETURNED online order
--     that is still `paid`. That is exactly the set `refund_due_paise` counts, so
--     the button and the number can never disagree.
--   * A second tap is not an error: it returns the row unchanged. Rule 9.4 —
--     a retried request must be safe.
--
-- Both functions run as the CALLER, not `security definer`: RLS stays the thing
-- that decides who may write, and `is_admin()` turns the silent no-op into an
-- error rather than replacing the policy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cash handed over by a rider.
-- -----------------------------------------------------------------------------

create or replace function public.mark_cod_collected(p_order_id uuid)
returns public.orders
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can mark cash as collected.'
      using errcode = '42501';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id;

  if not found then
    raise exception 'That order does not exist.'
      using errcode = 'P0002';
  end if;

  if v_order.payment_method <> 'cod' then
    raise exception 'This order was paid online; there is no cash to collect.'
      using errcode = 'P0001';
  end if;

  if v_order.status <> 'delivered' then
    raise exception 'Cash is collected only after the order is delivered.'
      using errcode = 'P0001';
  end if;

  -- Already recorded. A double tap, or a retry after a dropped response, must
  -- not be an error and must not move any number twice.
  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order is marked %, not pending cash.', v_order.payment_status
      using errcode = 'P0001';
  end if;

  update public.orders
     set payment_status = 'paid'
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.mark_cod_collected(uuid) is
  'The owner confirms a rider handed over the cash for a delivered COD order. '
  'Moves the money from cash_in_hand_paise to cash_collected_paise. A repeat '
  'call returns the row unchanged; a wrong state raises.';

revoke all on function public.mark_cod_collected(uuid) from public, anon;
grant execute on function public.mark_cod_collected(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A refund actually paid back.
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

  if v_order.payment_method <> 'online' then
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
  'The owner records that the money was actually returned for an online-paid '
  'order that was cancelled, failed or returned. Clears refund_due_paise. A '
  'repeat call returns the row unchanged; a wrong state raises.';

revoke all on function public.mark_refund_paid(uuid) from public, anon;
grant execute on function public.mark_refund_paid(uuid) to authenticated;
