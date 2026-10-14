-- =============================================================================
-- Rider assignment — who is bringing this bag?
-- =============================================================================
-- Before this file an order had a status but nobody owned it: every rider saw
-- every order and any rider could move any order. That is fine for zero riders
-- and wrong the moment there are five.
--
-- This adds two columns and teaches the existing guard trigger two new rules:
--
--   1. A rider may CLAIM an order that nobody owns yet
--      (assigned_to NULL -> themselves), and in the same tap may move it
--      forward.
--   2. A rider may only ever touch an order that is assigned to THEM. They
--      cannot reassign it, cannot unassign it, and cannot touch somebody
--      else's.
--
-- The owner (admin) is unchanged: full control, including reassigning riders.
--
-- Why a trigger and not just RLS? A row policy can express "which rows", but not
-- "this column may move forward and that one may not". The assignment rule is a
-- rule about HOW a row changes, so it lives with the other order guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema: who is carrying the order.
-- -----------------------------------------------------------------------------

alter table public.orders
  add column assigned_to uuid references public.profiles (id) on delete set null,
  add column assigned_at timestamptz;

comment on column public.orders.assigned_to is
  'The rider who claimed (or was given) this order. NULL means nobody yet.';
comment on column public.orders.assigned_at is
  'When the order was claimed or assigned. Set together with assigned_to.';

-- A rider may claim an order and it must be a person, never a half-state.
alter table public.orders
  add constraint orders_assigned_pair
    check ((assigned_to is null) = (assigned_at is null));

-- -----------------------------------------------------------------------------
-- Indexes for the two questions the rider/admin screens ask constantly:
--   * "what is waiting for a rider?"  -> assigned_to IS NULL
--   * "what is mine right now?"       -> assigned_to = me
-- A partial index keeps the waiting list tiny even after a year of history.
-- -----------------------------------------------------------------------------

create index orders_waiting_idx
  on public.orders (placed_at)
  where assigned_to is null and status in ('placed', 'confirmed');

create index orders_assigned_idx
  on public.orders (assigned_to, status, placed_at desc)
  where assigned_to is not null;

-- The admin board reads every active order newest-first.
create index orders_status_placed_idx
  on public.orders (status, placed_at desc);

-- -----------------------------------------------------------------------------
-- The guard, replaced.
--
-- The delivery branch is rewritten. The admin and customer branches keep the
-- exact behaviour they had in 20261002000005_orders.sql, so the existing tests
-- (01, 02, 03) keep passing for the same reasons.
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
  -- Delivery partner
  -- ---------------------------------------------------------------------------
  if public.current_user_role() = 'delivery' then
    -- Fields a rider may never change, whatever else they do. This is the same
    -- list migration 05 protected, plus idempotency_key and assigned_at.
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
      -- Not a claim: the order must already be assigned to this rider.
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'This order is not assigned to you.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at then
        raise exception 'A rider cannot change when an order was claimed.'
          using errcode = '42501';
      end if;
    end if;

    -- Status may only move FORWARD, never back, and never to cancelled.
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        raise exception 'A rider cannot cancel an order.'
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

    -- delivered_at is set when (and only when) the order is delivered.
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
  -- Customer: may cancel, but only while the order is still unconfirmed, and
  -- may not touch any money, identity or assignment field while doing it.
  -- (Unchanged from migration 05, plus assigned_to/assigned_at must stay put.)
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
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

-- The trigger itself already exists (created in migration 05) and now calls the
-- replaced function. Nothing to re-create.

-- -----------------------------------------------------------------------------
-- Keep assigned_at honest: nobody should set assigned_to by hand without a time.
-- The CHECK constraint above enforces the pair; this simply fills in the clock
-- when an admin assigns a rider and forgets to set the time.
-- -----------------------------------------------------------------------------

create or replace function public.set_assigned_at()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      new.assigned_at := null;
    elsif new.assigned_at is null or new.assigned_at is distinct from old.assigned_at then
      new.assigned_at := coalesce(new.assigned_at, now());
    end if;
  end if;

  return new;
end;
$$;

-- Runs BEFORE the guard + set_updated_at, so the pair is complete by the time
-- the CHECK constraint and any test look at it.
drop trigger if exists orders_set_assigned_at on public.orders;
create trigger orders_set_assigned_at
  before update on public.orders
  for each row execute function public.set_assigned_at();
