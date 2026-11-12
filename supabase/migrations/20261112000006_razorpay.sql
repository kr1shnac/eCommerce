-- =============================================================================
-- 39 · Razorpay: one payable object per basket, and one way to settle it
--
-- Until now `online_payments_enabled` was the whole story: with it false,
-- `place_order()` refused a non-cash method, and the owner settled a UPI
-- transfer by hand with `mark_online_payment_paid()`. That was honest, but it
-- could not be what the owner asked for — every method selectable, confirmed
-- automatically, the way Blinkit and Zepto do it.
--
-- This migration adds the two facts a gateway needs, and nothing else:
--
--   * `payment_provider` / `payment_provider_order_id` — WHICH payable object
--     belongs to this order. Razorpay creates an `order_XXX` server-side for the
--     exact amount, and the app opens checkout against it. Storing the id means
--     a second tap cannot start a second payment for the same basket.
--   * `settle_online_payment()` — the ONLY door that turns money into
--     `payment_status = 'paid'` for a gateway payment. It is service_role only,
--     because it is called by an Edge Function that has already verified
--     Razorpay's signature. A customer cannot reach it.
--
-- WHY THE GUARD TRIGGER NEEDS TWO NEW BRANCHES
--
-- `orders_guard_update` is what stops a customer writing `paid` on their own
-- order. Both functions below are SECURITY DEFINER but the trigger still fires
-- with the CALLER's `auth.uid()`, so a customer calling
-- `set_order_payment_intent()` would otherwise be refused by the customer
-- branch ("may only cancel"). Each write therefore raises a transaction-local
-- flag AND is shape-checked: a flag alone would be a hole, because `set_config`
-- is executable by any role. The same argument, and the same pattern, as
-- `kunigal.moving_stock` in the product guard (migration 20261021000003).
--
-- The settlement branch additionally requires `service_role` or an admin, so
-- even someone who could set the flag cannot mark their own order paid.
-- =============================================================================

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_provider_order_id text;

comment on column public.orders.payment_provider is
  'Which gateway holds the money for this order: NULL (none / cash) or '
  'razorpay. Never set by the app; written by set_order_payment_intent().';

comment on column public.orders.payment_provider_order_id is
  'The gateway''s own order id (razorpay order_XXX) for THIS order. One per '
  'order: a second, different id would mean two payable objects for one basket.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'orders_payment_provider_check'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_provider_check
      check (payment_provider is null or payment_provider in ('razorpay'));
  end if;
end;
$$;

-- The webhook looks an order up by the gateway's id, with no customer session.
create index if not exists orders_payment_provider_order_idx
  on public.orders (payment_provider_order_id)
  where payment_provider_order_id is not null;

-- -----------------------------------------------------------------------------
-- Recording the intent.
--
-- Called by the app after the Edge Function created the Razorpay order. The
-- customer owns the order, it is still `placed` and still unpaid, and there is
-- exactly one intent. A repeat with the SAME id is the same fact and returns the
-- stored row (rule 9.4); a repeat with a DIFFERENT id is refused, because two
-- payable objects for one basket is how somebody gets charged twice.
-- -----------------------------------------------------------------------------

create or replace function public.set_order_payment_intent(
  p_order_id          uuid,
  p_provider_order_id text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_id    text := nullif(trim(coalesce(p_provider_order_id, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in before paying.' using errcode = '42501';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;

  if v_order.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'That is not your order.' using errcode = '42501';
  end if;

  if v_order.payment_method = 'cod' then
    raise exception 'A cash order has no online payment.' using errcode = '22023';
  end if;

  if v_order.status <> 'placed' then
    raise exception 'This order can no longer be paid online.' using errcode = '22023';
  end if;

  if v_order.payment_status <> 'pending' then
    raise exception 'This order is already %.', v_order.payment_status
      using errcode = '22023';
  end if;

  -- The gateway's ids are `order_` + base62. Checking the shape here means a
  -- typo or a client inventing an id is refused before it is stored, rather
  -- than discovered when the webhook cannot find the order.
  if v_id is null or v_id !~ '^order_[A-Za-z0-9]+$' then
    raise exception 'A Razorpay order id is required.' using errcode = '22023';
  end if;

  if v_order.payment_provider_order_id = v_id then
    return v_order;
  end if;

  if v_order.payment_provider_order_id is not null then
    raise exception 'A payment is already started for this order.'
      using errcode = '23505';
  end if;

  perform set_config('kunigal.payment_intent', 'on', true);

  update public.orders
     set payment_provider          = 'razorpay',
         payment_provider_order_id = v_id,
         updated_at                = now()
   where id = p_order_id
  returning * into v_order;

  perform set_config('kunigal.payment_intent', 'off', true);

  return v_order;
end;
$$;

comment on function public.set_order_payment_intent(uuid, text) is
  'The order''s own customer records which gateway order will be paid for this '
  'basket. One per order; the same id twice is a safe retry, a different id is '
  'refused. Never sets payment_status.';

revoke execute on function public.set_order_payment_intent(uuid, text)
  from public, anon;
grant execute on function public.set_order_payment_intent(uuid, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Settling it.
--
-- service_role ONLY: the caller is an Edge Function that has already checked
-- Razorpay's HMAC signature against the key secret, which never leaves the
-- server. An admin may also call it, for the day a payment lands in the
-- dashboard but the webhook did not.
--
-- The strict state checks are the point:
--   * a cash order is settled by `mark_cod_collected()`, a different fact;
--   * a cancelled / failed / returned order IS settled, because the gateway is
--     the authority on whether money moved. Refusing here would leave the shop
--     holding a customer's money with no refund liability on the books; the
--     generated `refund_due_paise` column turns it into exactly that liability.
--     (`mark_online_payment_paid()` still refuses a closed order, because there
--     the owner is recording a memory, not a verified capture.)
--   * paying twice with the SAME reference returns the stored row;
--   * paying twice with a DIFFERENT reference raises, because that is a second
--     charge and somebody has to look at it.
-- -----------------------------------------------------------------------------

create or replace function public.settle_online_payment(
  p_order_id   uuid,
  p_payment_id text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_ref   text := nullif(trim(coalesce(p_payment_id, '')), '');
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'Only the payment gateway can settle a payment.'
      using errcode = '42501';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;

  if v_order.payment_method = 'cod' then
    raise exception 'This is a cash order. Use mark_cod_collected().'
      using errcode = '22023';
  end if;

  if v_order.payment_status = 'paid' then
    if v_order.payment_reference is not distinct from v_ref then
      return v_order;
    end if;
    raise exception 'This order was already paid with another reference.'
      using errcode = '23505';
  end if;

  if v_order.payment_status = 'refunded' then
    raise exception 'This payment was already refunded.' using errcode = '22023';
  end if;

  if v_ref is null or v_ref !~ '^pay_[A-Za-z0-9]+$' then
    raise exception 'A Razorpay payment id is required.' using errcode = '22023';
  end if;

  perform set_config('kunigal.settling_payment', 'on', true);

  update public.orders
     set payment_status    = 'paid',
         payment_reference = v_ref,
         updated_at        = now()
   where id = p_order_id
  returning * into v_order;

  perform set_config('kunigal.settling_payment', 'off', true);

  return v_order;
end;
$$;

comment on function public.settle_online_payment(uuid, text) is
  'Service-role only: the gateway has verified the payment, so record it. '
  'Refuses cash orders, records a capture on a closed order as a refund '
  'liability, returns the stored row on a retry with the same reference, and '
  'raises on a second, different charge.';

revoke execute on function public.settle_online_payment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_online_payment(uuid, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- The guard: the same body as migration 20261109000005, plus two branches.
--
-- Everything below the new branches is byte-for-byte the previous behaviour
-- (admin passes; erasure shapes; rider ladder; customer cancel). They are
-- reproduced rather than referenced because Postgres has no way to wrap a
-- trigger function.
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
  -- A payment intent (set_order_payment_intent, migration 20261112000006).
  --
  -- The flag says the write came from that function; the shape says the provider
  -- is razorpay, an id is present, and NOTHING else moved. A customer who could
  -- set the flag — they cannot through PostgREST — still could not change a
  -- status, a total or the payment status here.
  -- ---------------------------------------------------------------------------
  if current_setting('kunigal.payment_intent', true) = 'on' then
    if new.payment_provider = 'razorpay'
       and new.payment_provider_order_id is not null
       and new.status is not distinct from old.status
       and new.payment_status is not distinct from old.payment_status
       and new.payment_reference is not distinct from old.payment_reference
       and new.payment_method is not distinct from old.payment_method
       and new.user_id is not distinct from old.user_id
       and new.store_id is not distinct from old.store_id
       and new.address_id is not distinct from old.address_id
       and new.delivery_address is not distinct from old.delivery_address
       and new.subtotal_paise is not distinct from old.subtotal_paise
       and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
       and new.discount_paise is not distinct from old.discount_paise
       and new.total_paise is not distinct from old.total_paise
       and new.notes is not distinct from old.notes
       and new.placed_at is not distinct from old.placed_at
       and new.delivered_at is not distinct from old.delivered_at
       and new.assigned_to is not distinct from old.assigned_to
       and new.assigned_at is not distinct from old.assigned_at
       and new.cancellation_reason is not distinct from old.cancellation_reason
       and new.coupon_code is not distinct from old.coupon_code
       and new.failure_reason is not distinct from old.failure_reason
       and new.failure_note is not distinct from old.failure_note
       and new.invoice_number is not distinct from old.invoice_number
       and new.place_of_supply_state_code is not distinct from old.place_of_supply_state_code
       and new.is_intra_state is not distinct from old.is_intra_state
       and new.is_express is not distinct from old.is_express
       and new.eta_minutes is not distinct from old.eta_minutes
       and new.created_at is not distinct from old.created_at
       and new.idempotency_key is not distinct from old.idempotency_key then
      return new;
    end if;
    raise exception 'A payment intent may only set the provider and its order id.'
      using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------------------
  -- A gateway settlement (settle_online_payment). service_role or admin ONLY,
  -- so even a forged flag cannot mark a customer's own order paid.
  -- ---------------------------------------------------------------------------
  if current_setting('kunigal.settling_payment', true) = 'on' then
    if (auth.role() = 'service_role' or public.is_admin())
       and new.payment_status = 'paid'
       and new.payment_reference is not null
       and new.status is not distinct from old.status
       and new.payment_provider is not distinct from old.payment_provider
       and new.payment_provider_order_id is not distinct from old.payment_provider_order_id
       and new.payment_method is not distinct from old.payment_method
       and new.user_id is not distinct from old.user_id
       and new.store_id is not distinct from old.store_id
       and new.address_id is not distinct from old.address_id
       and new.delivery_address is not distinct from old.delivery_address
       and new.subtotal_paise is not distinct from old.subtotal_paise
       and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
       and new.discount_paise is not distinct from old.discount_paise
       and new.total_paise is not distinct from old.total_paise
       and new.notes is not distinct from old.notes
       and new.placed_at is not distinct from old.placed_at
       and new.delivered_at is not distinct from old.delivered_at
       and new.assigned_to is not distinct from old.assigned_to
       and new.assigned_at is not distinct from old.assigned_at
       and new.cancellation_reason is not distinct from old.cancellation_reason
       and new.coupon_code is not distinct from old.coupon_code
       and new.failure_reason is not distinct from old.failure_reason
       and new.failure_note is not distinct from old.failure_note
       and new.invoice_number is not distinct from old.invoice_number
       and new.place_of_supply_state_code is not distinct from old.place_of_supply_state_code
       and new.is_intra_state is not distinct from old.is_intra_state
       and new.is_express is not distinct from old.is_express
       and new.eta_minutes is not distinct from old.eta_minutes
       and new.created_at is not distinct from old.created_at
       and new.idempotency_key is not distinct from old.idempotency_key then
      return new;
    end if;
    raise exception 'A settlement may only set payment_status and the reference.'
      using errcode = '42501';
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
  -- dropped.
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
     and new.cancellation_reason is not distinct from old.cancellation_reason
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

comment on function public.guard_order_update() is
  'Who may change what on an order. Admins pass. A gateway settlement may only '
  'set payment_status and the reference, and only for service_role. A payment '
  'intent may only set the provider columns. Riders move status only. Customers '
  'cancel their own placed order.';
