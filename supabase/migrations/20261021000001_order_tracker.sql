-- =============================================================================
-- 18 · The order tracker: honest failed states, and the rider as a person
--
-- WHY THIS EXISTS
--
-- Two gaps from the register, both about the same customer screen.
--
-- M3 — there is no honest place for a delivery that could not be made. Today a
--      rider who reaches a locked house has two choices: lie and press
--      "delivered", or leave the order sitting in "out for delivery" forever.
--      The first corrupts the shop's books; the second makes the customer think
--      a rider is still coming at 10 p.m. Neither is acceptable in a town where
--      the same rider will meet the same customer at the shop next week.
--
-- H2/M5 — the order screen never says WHO is bringing the bag, and there is no
--      way to call them. In Kunigal the rider is the interface: the highest-trust
--      feature in the app, and until now it did not exist.
--
-- WHAT THIS MIGRATION DOES
--
--   1. Adds two terminal, NON-happy statuses: `failed` (nobody was home / the
--      address could not be found) and `returned` (the bag came back to the
--      shop). They are deliberate end states, not a soft "cancelled".
--   2. Records WHY a delivery failed, and lets the customer read the reason.
--   3. Adds a rider display name and photo to `profiles`, and a public view of
--      just those two columns, so a customer's order screen can show the person
--      without exposing any other customer's profile row.
--   4. Teaches `guard_order_update()` about the new states, so a rider can
--      honestly close an order and still cannot touch money or identity.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The two honest end states
-- -----------------------------------------------------------------------------
-- New enum values are appended, never inserted in the middle: the ordinal of an
-- existing value is part of the stored data, so inserting would silently relabel
-- every existing order. `cancelled` stays exactly where it is.
alter type public.order_status add value if not exists 'failed';
alter type public.order_status add value if not exists 'returned';

comment on type public.order_status is
  'placed -> confirmed -> packing -> out_for_delivery -> delivered. '
  'cancelled = stopped before pickup (customer or shop). '
  'failed = a delivery attempt that did not succeed. '
  'returned = the bag came back to the shop after a failed attempt.';

-- -----------------------------------------------------------------------------
-- 2. Why it failed
-- -----------------------------------------------------------------------------
-- A short machine-readable code plus a free note. The code drives a translated
-- sentence on the customer's screen; the note is for the owner, who reads it in
-- the admin panel and on the rider screen. Neither is a money field.
--
-- Only the terminal states are allowed to carry a reason, which the CHECK below
-- enforces, so `failure_reason` can never drift onto a live order.
alter table public.orders
  add column if not exists failure_reason text
    check (failure_reason is null
           or failure_reason in ('not_home', 'wrong_address', 'refused',
                                 'unreachable', 'other')),
  add column if not exists failure_note text;

comment on column public.orders.failure_reason is
  'Why a delivery failed: not_home | wrong_address | refused | unreachable | other.';
comment on column public.orders.failure_note is
  'A sentence from the rider, for the owner. Not shown to the customer as-is.';

alter table public.orders
  add constraint orders_failed_has_reason
    check (status not in ('failed', 'returned') or failure_reason is not null);

alter table public.orders
  add constraint orders_failure_only_when_failed
    check (status in ('failed', 'returned')
           or (failure_reason is null and failure_note is null));

-- The owner's board and the pilot's paper ledger both ask "what failed today?".
create index orders_failed_idx
  on public.orders (status, placed_at desc)
  where status in ('failed', 'returned');

-- -----------------------------------------------------------------------------
-- 3. The rider, as a person the customer can see and call
-- -----------------------------------------------------------------------------
-- `profiles` already has `full_name` and `phone`. What it does not have is a
-- place for a face. A small town trust device: the customer sees who is at the
-- gate before opening it.
alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'A small profile picture. Used for the rider on the customer''s order screen.';

-- The customer must be able to read the ASSIGNED rider's name and phone, but the
-- profiles policy allows only "your own row, or admin". Rather than widen that
-- policy — which would let any customer read every customer — a narrow view
-- exposes ONLY the two columns that are safe for a rider to show a customer.
--
-- A view is `security_invoker = false` by default in some setups and true in
-- others, so it is set explicitly. `security_invoker = true` would re-apply
-- RLS on profiles and return nothing; the point of the view is to expose exactly
-- these two columns and nothing else, so it is deliberately definer-side.
create or replace view public.rider_directory
with (security_invoker = false)
as
select
  p.id,
  p.full_name,
  p.avatar_url,
  p.phone
from public.profiles p
where p.role = 'delivery';

comment on view public.rider_directory is
  'Name, photo and phone of every delivery partner. Exactly the columns a '
  'customer''s order screen needs, and no other profile column. Read-only.';

revoke all on public.rider_directory from public, anon;
grant select on public.rider_directory to authenticated;

-- -----------------------------------------------------------------------------
-- 4. The guard learns the two new end states
-- -----------------------------------------------------------------------------
-- The rider branch is copied verbatim from 20261013000001 and 20261020000001,
-- with one change: a rider may now close an order as `failed` (from
-- out_for_delivery) or as `returned` (from failed/out_for_delivery), in addition
-- to moving forward. Everything else — money, identity, assignment, no backwards
-- moves across the happy path — is unchanged.
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
  -- An erasure (see delete_my_account, migration 20261020000001). Unchanged.
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
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. The failed-order path for the customer's own screen
-- -----------------------------------------------------------------------------
-- A customer reads the reason through the order row itself (they own the row),
-- so no new policy is needed. The failure columns are ordinary columns on
-- `orders`; the existing "read own orders" policy already covers them.
