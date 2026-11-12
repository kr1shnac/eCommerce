-- =============================================================================
-- 41 · A shortage is settled by one function, and the books cannot be edited by hand
-- =============================================================================
-- THE SCENARIO
-- ------------
-- The stock book said 10, the shelf holds 6, and a customer has already paid
-- for 10. The owner phones them, they agree the bag ships with 6, and the
-- ORDER must now say 6 — because the owner's Today tab, the customer's order
-- screen and the day's takings all read `orders.total_paise`. An order that
-- says 10 while the shop sells 6 is a lie in three places at once.
--
-- THE HOLES THIS CLOSES
-- ---------------------
-- Until now `order_items` carried two policies with no column guard:
--
--   create policy "admins update order items" ... using (public.is_admin());
--   create policy "admins delete order items" ... using (public.is_admin());
--
-- An admin session (the owner's own phone, a buggy future screen, a stolen
-- admin login) could UPDATE any column of any line — quantity, the PRICE
-- SNAPSHOT, even `order_id`, which moves a line onto somebody else's order —
-- or DELETE a line outright. `order_items.line_total_paise` would follow
-- (it is generated), but `orders.subtotal_paise` and `orders.total_paise`
-- would NOT: the totals CHECK was satisfied when the order was written and is
-- never re-evaluated by somebody else's edit. So the most likely mistake —
-- "the shelf only has 6, let me change the 10 to a 6 on the line" — is a
-- silent desync: the line says 6, the order total still says 10, the shop's
-- takings for the day are wrong, and nothing anywhere raises.
--
-- The customer-facing paths were already closed (migration 08 dropped the
-- customer INSERT policy and `place_order()` became the only writer). What
-- remained open was exactly the admin's own door.
--
-- THE FIX
-- -------
-- One definer function, `admin_adjust_order_item()`, in the shape the owner's
-- other buttons already use (`admin_cancel_order`, `set_shop_open`): admin-only
-- (42501), locks the order row, refuses terminal states (P0001), refuses
-- unknown rows (P0002), returns the STORED row — and it is the only code in
-- the system that may change a line after `place_order()`:
--
--   * Only `placed`, `confirmed` and `packing` are adjustable. Once the bag is
--     `out_for_delivery` the rider has counted it; after `delivered` the bag
--     exists as history; cancelled, failed and returned orders had their
--     stock decision made.
--   * `p_quantity` may only be LOWER than the line, or 0 to take the line off
--     entirely. A shortage means less. Giving a customer MORE than they
--     ordered is a different conversation and a new order, not an edit.
--   * The units the order no longer claims go BACK to stock, inside the
--     `kunigal.moving_stock` window with the same "stock_qty may differ"
--     shape `place_order()` and `cancel_order()` use — the guard
--     `guard_product_update()` accepts exactly that and nothing else. (If the
--     returned units are physically phantom — the book was wrong and the
--     shelf never had them — the owner corrects the stock row itself from the
--     Shelf tab; that is a count, not a sale.)
--   * `subtotal_paise` and `total_paise` are RECOMPUTED from the remaining
--     lines in the same transaction, so the books and the lines can never
--     disagree again.
--
-- WHAT THIS DELIBERATELY DOES NOT RE-DERIVE
-- ----------------------------------------
--   * The delivery fee stays as stored. Whether the (smaller) basket now
--     qualifies for free delivery cannot be answered honestly here: express
--     and the zone fee were merged into `delivery_fee_paise` at checkout, and
--     un-merging them is a guess. The owner who thinks the fee no longer fits
--     cancels and re-places the order — the customer re-taps a basket that
--     prices itself correctly. Same for the express units cap.
--   * The coupon discount stays as stored. The code was redeemed; the
--     per-customer count ignores cancelled orders, so the customer is not
--     locked out if the shop has to cancel. If the discount would now exceed
--     the basket, the totals CHECK would refuse — this function raises that
--     case FIRST, with a sentence that says what to do instead.
--   * `min_order_value_paise` is not re-enforced. It is the smallest basket a
--     NEW order may have, not a rule for un-selling part of one already paid.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The one write path
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
  v_order     public.orders;
  v_item      public.order_items%rowtype;
  v_line_count integer;
  v_subtotal  bigint;
  v_total     bigint;
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

  update public.orders
     set subtotal_paise = v_subtotal,
         total_paise    = v_total
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
  'the stored row. The delivery fee and the coupon discount are carried as '
  'stored — pricing stays in place_order().';

revoke all on function public.admin_adjust_order_item(uuid, uuid, integer) from public, anon;
grant execute on function public.admin_adjust_order_item(uuid, uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Close the direct doors
--
-- After this, no client of ANY role can UPDATE or DELETE a line. RLS filters
-- an UPDATE to zero rows and raises nothing — which is why the function above
-- raises instead. The SELECT policy stays: the owner's board and the
-- customer's order screen both embed the lines. The guard trigger
-- `order_items_guard_insert` stays too, as the second line of defence for the
-- definer writers.
-- -----------------------------------------------------------------------------
drop policy "admins update order items" on public.order_items;
drop policy "admins delete order items" on public.order_items;

comment on table public.order_items is
  'One line of one order. Written only by place_order() and '
  'admin_adjust_order_item(); every client, admins included, reads it and '
  'cannot change it. Quantities drop only, and only while the bag has not '
  'left the shop.';
