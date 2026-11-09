-- -----------------------------------------------------------------------------
-- 20261109000001_rider_erasure.sql — a rider with a delivery in hand can now
--                                      erase their account.
--
-- THE BUG (found 2026-11-06 while proving the feedback cascade, recorded in
-- HANDOFF.md §6.3 and left unfixed because it needed its own shape):
--
--   A rider assigned to an order could not delete their account at all.
--   `delete_my_account()` ends by deleting the `auth.users` row, which cascades
--   to the profile row, which makes `orders.assigned_to` (`on delete set null`)
--   fire Postgres' own UPDATE on every order that rider was carrying.
--   `guard_order_update()` sees that UPDATE *after* the caller's profile row is
--   gone: `current_user_role()` no longer reads 'delivery', the erasure flag has
--   already been switched off, and the row falls through to the customer branch,
--   which refuses everything except a cancel. The whole deletion rolled back.
--   Customers were never affected — a customer cannot be assigned to an order.
--
-- THE FIX FOLLOWS THE PATTERN THIS FILE'S ANCESTOR ALREADY ESTABLISHED.
-- Migration 20261020000001 handles exactly this hazard for `addresses`, and
-- says so in a comment: `orders.address_id` is `on delete set null`, so the
-- erasure nulls the column itself *first* ("the cascade later has nothing to
-- change"). `assigned_to` was never given the same treatment. It is now.
--
-- WHAT IS ADDED, AND WHAT IS DELIBERATELY NOT WIDENED
--
--   1. `delete_my_account()` gains step 4b: before the profile row goes, the
--      rider hands back the orders they are carrying (`assigned_to = null`,
--      `assigned_at = null`) with the erasure flag on. Nothing else about those
--      orders changes — they belong to a *customer*, and an erasure must never
--      rewrite another person's order history.
--
--   2. `guard_order_update()` gains a second, narrower erasure shape. The first
--      shape rewrites the erasee's OWN orders to the tombstone; this one is the
--      hand-back. Both are gated by the transaction-local flag that only
--      `delete_my_account()` can raise, and both must match exactly: the flag on
--      its own unlocks nothing, because the shape list is the whole permission.
--
-- THE KNOWN TRADE-OFF, STATED RATHER THAN DISCOVERED LATER
--
--   `shop_day_by_rider()` attributes past days by joining `orders.assigned_to`.
--   After a rider erases themselves, the orders they carried keep every paise
--   and every status but lose WHO carried them. That is the correct direction:
--   the alternative — pointing a finished order at a "deleted rider" stand-in —
--   would keep the ledger tidy by putting a stranger's name on a customer's
--   order screen, which is the exact thing `rider_directory` exists to avoid.
--   The takings themselves (`shop_day_totals()`) aggregate orders regardless of
--   rider, so no money ever moves.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- guard_order_update() — the current body (migration 20261021000001) plus the
-- hand-back shape. Copied in full because `create or replace` replaces the whole
-- function, and a partial copy would silently drop the tracker's rules.
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
-- delete_my_account() — the body from migration 20261020000001, plus step 4b.
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_tombstone  uuid := public.deleted_customer_id();
  v_addresses  integer := 0;
  v_orders     integer := 0;
  v_role       public.user_role;
  v_auth_users integer := 0;
begin
  -- 1. You must be signed in, and you can only ever delete yourself. There is no
  --    parameter, so there is nothing to forge.
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if v_user = v_tombstone then
    raise exception 'the deleted-customer tombstone cannot delete itself'
      using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_user;
  if v_role is null then
    raise exception 'no profile for this account' using errcode = 'no_data_found';
  end if;

  -- 2. An admin deleting the only admin would lock the shop out of its own
  --    panel. A second admin must exist first (register H9 — the same gap, seen
  --    from the other side).
  if v_role = 'admin' then
    if (select count(*) from public.profiles p where p.role = 'admin') < 2 then
      raise exception
        'this is the only admin: add a second admin before deleting this account'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- 3. Make sure the tombstone exists. It needs an auth.users row because
  --    profiles.id references it. The row has no confirmed identity of any kind
  --    and no way to be signed into.
  --
  --    The column list is built from the catalogue rather than written out,
  --    because Supabase's real `auth.users` has `instance_id`, `aud`, `role` and
  --    `updated_at` while the local test stub deliberately has only the columns
  --    the migrations need. Writing them out would make this migration
  --    untestable, and an untestable deletion routine is the last thing that
  --    should exist (rule 9.7).
  declare
    v_cols text[] := array['id'];
    v_vals text[] := array[quote_literal(v_tombstone::text)];
  begin
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'instance_id') then
      v_cols := v_cols || 'instance_id';
      v_vals := v_vals || quote_literal('00000000-0000-0000-0000-000000000000');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'aud') then
      v_cols := v_cols || 'aud';
      v_vals := v_vals || quote_literal('authenticated');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'role') then
      v_cols := v_cols || 'role';
      v_vals := v_vals || quote_literal('authenticated');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'updated_at') then
      v_cols := v_cols || 'updated_at';
      v_vals := v_vals || 'now()';
    end if;

    execute format(
      'insert into auth.users (%s) values (%s) on conflict (id) do nothing',
      array_to_string(v_cols, ', '),
      array_to_string(v_vals, ', ')
    );
  end;

  insert into public.profiles (id, full_name, phone, role, preferred_language)
  values (v_tombstone, null, null, 'customer', 'en')
  on conflict (id) do nothing;

  -- 4. Keep the orders, strip the person out of them. The address snapshot is
  --    the only place the delivery details survive, so it is rewritten in place;
  --    the money, items and timestamps are untouched and the books still balance.
  --
  --    The flag tells `guard_order_update()` that this update is an erasure. It
  --    is transaction-local, so it is gone before this function returns.
  --
  --    THIS MUST RUN BEFORE THE ADDRESSES ARE DELETED. `orders.address_id` is
  --    `on delete set null`, so removing an address makes Postgres issue its own
  --    UPDATE on the order — an UPDATE the guard sees, and refuses, because it
  --    is not the erasure shape. Setting `address_id = null` here first means the
  --    cascade later has nothing to change.
  perform set_config('kunigal.erasing_account', 'on', true);

  update public.orders o
     set user_id = v_tombstone,
         address_id = null,
         delivery_address = jsonb_build_object(
           'erased', true,
           'full_name', 'Deleted customer',
           'phone',    '',
           'line1',    '',
           'line2',    '',
           'landmark', '',
           'city',     coalesce(o.delivery_address ->> 'city', 'Kunigal'),
           'state',    coalesce(o.delivery_address ->> 'state', 'Karnataka'),
           'pincode',  coalesce(o.delivery_address ->> 'pincode', '')
         ),
         notes = null
   where o.user_id = v_user;
  get diagnostics v_orders = row_count;

  perform set_config('kunigal.erasing_account', 'off', true);

  -- 4b. A rider hands back the orders they are carrying. Same cascade hazard as
  --     `address_id`, one paragraph up: `orders.assigned_to` is `on delete set
  --     null`, so deleting the profile row would make Postgres issue its own
  --     UPDATE — and by then the caller is no longer a rider, so the guard would
  --     refuse it and the whole erasure would roll back. Doing it here, while
  --     the caller is still the rider and the flag is on, means the cascade
  --     later has nothing to change.
  --
  --     The order keeps its customer, its money and its status. This is a
  --     hand-back, not an edit: `assigned_at` goes too, because a claim time
  --     with nobody attached to it is a lie the shop would read as evidence.
  if v_role = 'delivery' then
    perform set_config('kunigal.erasing_account', 'on', true);

    update public.orders o
       set assigned_to = null,
           assigned_at = null
     where o.assigned_to = v_user;

    perform set_config('kunigal.erasing_account', 'off', true);
  end if;

  -- 5. Erase the addresses. They are personal data and nothing else, and the
  --    orders no longer point at any of them, so no cascade can fire here.
  delete from public.addresses a where a.user_id = v_user;
  get diagnostics v_addresses = row_count;

  -- 6. The auth user. Cascades to favourites and to the profile row. Must be
  --    last: steps 4 and 5 need `v_user` to still be a real profile.
  delete from auth.users u where u.id = v_user;
  get diagnostics v_auth_users = row_count;

  return jsonb_build_object(
    'addresses_erased', v_addresses,
    'orders_anonymised', v_orders,
    'accounts_erased', v_auth_users
  );
end;
$$;

comment on function public.delete_my_account() is
  'Erases the calling user: addresses deleted, orders anonymised to the '
  'tombstone, any assigned delivery handed back, auth user removed. Keeps the '
  'shop''s books. One transaction.';

-- Only signed-in people may even reach it, and it can only act on itself.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
